"""Run real local sample flows. Writes metadata only; never prints identity text."""
import argparse
import json
from pathlib import Path
import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--samples", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--only", help="Run one named sample")
parser.add_argument("--portrait", default="portrait.png")
parser.add_argument("--expect-no-ocr", action="store_true")
parser.add_argument("--expect-no-ai", action="store_true")
args = parser.parse_args()
cases = [("aadhaar-photo-1.jpg", "Aadhaar", "8875"), ("aadhaar-photo-2.jpg", "Aadhaar", "2164"),
         ("aadhaar-photo-3.jpg", "Aadhaar", "2825"), ("aadhaar-pdf-1.pdf", "Aadhaar", "8020"),
         ("aadhaar-pdf-2.pdf", "Aadhaar", "0334"), ("pan-synthetic.png", "PAN", "234Z")]
if args.only:
    cases = [case for case in cases if case[0] == args.only]
    if not cases: parser.error("Unknown sample name")
results = []
with httpx.Client(base_url="http://127.0.0.1:5001", timeout=180) as client:
    for name, kind, suffix in cases:
        mime = "application/pdf" if name.endswith("pdf") else "image/png" if name.endswith("png") else "image/jpeg"
        response = client.post("/api/v1/onboarding/session/document", data={"documentType": kind},
                               files={"frontImage": (name, (args.samples / name).read_bytes(), mime)})
        response.raise_for_status()
        data = response.json()
        ocr = data["ocrData"]
        fields = ocr["extractedFields"]
        result = {"sample": name, "document_status": response.status_code, "session_id": data["sessionId"],
                  "ocr_status": ocr["status"], "ocr_provider": ocr["provider"],
                  "number_suffix_matches": str(fields.get("document_number") or "").endswith(suffix),
                  "dob_precision": fields["dob_precision"], "face_extracted": bool(data.get("documentFaceUrl")),
                  "checks": ocr["validation"]}
        response = client.put(f"/api/v1/onboarding/session/{data['sessionId']}/personal-info", json=data["prefill"])
        result["review_status"] = response.status_code
        response.raise_for_status()
        response = client.put(f"/api/v1/onboarding/session/{data['sessionId']}/selfie",
                              files={"selfie_front": ("portrait.png", (args.samples / args.portrait).read_bytes(), "image/png")})
        result["portrait_status"] = response.status_code
        response.raise_for_status()
        selfie = response.json()
        result.update(outcome=selfie["outcome"], face_similarity=selfie.get("faceSimilarity"),
                      liveness_not_performed=selfie["riskFlags"].get("liveness_not_performed"))
        response = client.get(f"/api/v1/onboarding/session/{data['sessionId']}/analysis")
        response.raise_for_status()
        analysis = response.json()["analysis"]
        result.update(analysis_status=response.status_code, saved_status=analysis["status"],
                      saved_ocr_status=analysis["ocr"]["status"])
        assert result["ocr_provider"] == "paddleocr"
        assert result["face_extracted"] == (kind == "Aadhaar")
        assert result["outcome"] == "pending" and result["liveness_not_performed"] is True
        assert result["saved_status"] == "submitted" and result["checks"]["authority_verified"] is False
        assert analysis["faceMatchThreshold"] == 0.5
        assert "address" not in analysis["fields"] and "father_name" not in analysis["fields"]
        assert "address" not in data["prefill"] and "postalCode" not in data["prefill"]
        assert "rawText" not in analysis["ocr"]
        if analysis["faceSimilarity"] is not None:
            assert analysis["faceIsMatch"] == (analysis["faceSimilarity"] >= 0.5)
        result["face_match_at_50_percent"] = analysis["faceIsMatch"]
        result["ai_scores"] = {}
        for target in ("document", "portrait"):
            ai = analysis["aiImageAnalysis"][target]
            assert ai["status"] == ("unavailable" if args.expect_no_ai else "complete")
            for image in ai["images"]:
                if args.expect_no_ai: assert image["ai_score"] is None
                else: assert 0 <= image["ai_score"] <= 100
            result["ai_scores"][target] = [image["ai_score"] for image in ai["images"]]
        if args.expect_no_ocr:
            assert result["ocr_status"] == result["saved_ocr_status"] == "unavailable"
            assert not analysis["documentNumber"] and not analysis["fields"]["date_of_birth"]
            assert analysis["findings"]["identity_fields_incomplete"] is True
        else:
            assert result["number_suffix_matches"], name
            if name in ("aadhaar-photo-1.jpg", "aadhaar-pdf-1.pdf"):
                assert result["dob_precision"] == "year" and analysis["fields"]["date_of_birth"] is None
            if kind == "PAN": assert result["checks"]["is_test_document"] is True
        for url in [data.get("documentUrl"), data.get("documentBackUrl"), data.get("documentFaceUrl"), selfie.get("selfieUrl")]:
            if url: client.get(url).raise_for_status()
        results.append(result)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2))
        print(json.dumps(result), flush=True)
print(f"PASS: {len(results)} complete sample flows.")
