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
parser.add_argument("--liveness-video-left", type=Path)
parser.add_argument("--liveness-video-right", type=Path)
parser.add_argument("--expect-no-ocr", action="store_true")
parser.add_argument("--expect-no-ai", action="store_true")
args = parser.parse_args()
if bool(args.liveness_video_left) != bool(args.liveness_video_right):
    parser.error("provide both --liveness-video-left and --liveness-video-right")
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
        selfie = None
        if args.liveness_video_left and args.liveness_video_right:
            challenge_response = client.post(f"/api/v1/onboarding/session/{data['sessionId']}/liveness-challenge")
            challenge_response.raise_for_status()
            challenge = challenge_response.json()["challenge"]
            liveness_path = args.liveness_video_left if challenge == "turn_left" else args.liveness_video_right
            mime_by_suffix = {".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime"}
            video_type = mime_by_suffix.get(liveness_path.suffix.lower())
            if not video_type:
                parser.error("liveness videos must be WebM, MP4, or MOV files")
            portrait_bytes = (args.samples / args.portrait).read_bytes()
            response = client.put(f"/api/v1/onboarding/session/{data['sessionId']}/selfie", files={
                "selfie_front": ("portrait.png", portrait_bytes, "image/png"),
                "portrait_image": ("analysis-portrait.png", portrait_bytes, "image/png"),
                "liveness_video": (liveness_path.name, liveness_path.read_bytes(), video_type),
            })
            result["portrait_status"] = response.status_code
            response.raise_for_status()
            selfie = response.json()
            result.update(outcome=selfie["outcome"], face_similarity=selfie.get("faceSimilarity"),
                          liveness_confirmed=selfie["livenessConfirmed"])
        else:
            result.update(portrait_status="skipped_no_liveness_videos", liveness_confirmed=None)
        response = client.get(f"/api/v1/onboarding/session/{data['sessionId']}/analysis")
        response.raise_for_status()
        analysis = response.json()["analysis"]
        result.update(analysis_status=response.status_code, saved_status=analysis["status"],
                      saved_ocr_status=analysis["ocr"]["status"])
        assert result["ocr_provider"] == "paddleocr"
        assert result["face_extracted"] == (kind == "Aadhaar")
        if selfie:
            assert result["outcome"] == "pending" and result["liveness_confirmed"] is True
            assert analysis["livenessStatus"] == "confirmed"
        else:
            assert analysis["livenessStatus"] == "not_recorded"
        assert result["saved_status"] == ("submitted" if selfie else "step_2_complete")
        assert result["checks"]["authority_verified"] is False
        assert analysis["faceMatchThreshold"] == 0.5
        assert "address" not in analysis["fields"] and "father_name" not in analysis["fields"]
        assert "address" not in data["prefill"] and "postalCode" not in data["prefill"]
        assert "rawText" not in analysis["ocr"]
        if analysis["faceSimilarity"] is not None:
            assert analysis["faceIsMatch"] == (analysis["faceSimilarity"] >= 0.5)
        result["face_match_at_50_percent"] = analysis["faceIsMatch"]
        result["ai_scores"] = {}
        targets = ("document", "portrait") if selfie else ("document",)
        for target in targets:
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
        for url in [data.get("documentUrl"), data.get("documentBackUrl"), data.get("documentFaceUrl"),
                    selfie.get("selfieUrl") if selfie else None,
                    analysis.get("aiImageAnalysis", {}).get("portrait", {}).get("image_url") if selfie else None]:
            if url: client.get(url).raise_for_status()
        results.append(result)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2))
        print(json.dumps(result), flush=True)
print(f"PASS: {len(results)} complete sample flows.")
