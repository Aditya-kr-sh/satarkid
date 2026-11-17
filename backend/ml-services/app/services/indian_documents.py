import asyncio
import io
import re
from datetime import date

from PIL import Image, ImageOps
from pdf2image import convert_from_bytes, pdfinfo_from_bytes
from fastapi import HTTPException

from app.core.config import settings
from app.services import local_ocr, ai_image_detector
from app.services.indian_parser import parse_lines
from app.services import storage, face_extractor
from app.services.forgery_detector import analyze_forgery


def normalize_date(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
        return parsed.isoformat() if parsed <= date.today() else None
    except ValueError:
        return None

def aadhaar_checksum(number):
    multiplication = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
    permutation = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
    checksum = 0
    for index, digit in enumerate(reversed(number)):
        checksum = multiplication[checksum][permutation[index % 8][int(digit)]]
    return checksum == 0

def validate_fields(fields, requested_type):
    number = re.sub(r"[\s-]", "", str(fields.get("document_number") or "")).upper()
    masked = bool(re.fullmatch(r"[X*]{8}\d{4}", number))
    checks = {"authority_verified": False, "document_type_matches": fields.get("document_type") == requested_type,
              "is_test_document": fields.get("is_test_document") is True,
              "inconsistent_pages": fields.get("inconsistent_pages") is True}
    if requested_type == "aadhaar":
        checks.update(masked=masked, number_format_valid=masked or bool(re.fullmatch(r"[2-9]\d{11}", number)),
                      checksum_valid=aadhaar_checksum(number) if re.fullmatch(r"[2-9]\d{11}", number) else None)
    else:
        checks.update(masked=False, number_format_valid=bool(re.fullmatch(r"[A-Z]{3}P[A-Z][0-9]{4}[A-Z]", number)))
    fields["document_number"] = ("XXXXXXXX" + number[-4:]) if masked else number
    printed_date = str(fields.get("date_of_birth_printed") or "")
    complete_printed_date = re.search(r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b", printed_date)
    fields["date_of_birth"] = normalize_date(fields.get("date_of_birth")) if complete_printed_date else None
    year = str(fields.get("year_of_birth") or "")
    fields["year_of_birth"] = int(year) if year.isdigit() and 1900 <= int(year) <= date.today().year else None
    fields["dob_precision"] = "day" if fields["date_of_birth"] else "year" if fields["year_of_birth"] else "unknown"
    return checks

def prepare_images(payload):
    if not payload or len(payload) > 10 * 1024 * 1024:
        raise HTTPException(413, "Upload a non-empty file of at most 10 MB.")
    try:
        if payload.startswith(b"%PDF-"):
            info = pdfinfo_from_bytes(payload, timeout=10)
            if info.get("Pages", 0) not in (1, 2):
                raise HTTPException(422, "Use a PDF containing one or two document pages.")
            images = convert_from_bytes(payload, dpi=200, fmt="jpeg", thread_count=1, timeout=30)
        else:
            image = Image.open(io.BytesIO(payload))
            if image.width * image.height > 40_000_000:
                raise HTTPException(413, "Image resolution is too large.")
            images = [ImageOps.exif_transpose(image)]
        results = []
        for image in images:
            image = image.convert("RGB")
            image.thumbnail((2400, 2400))
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=95)
            results.append(output.getvalue())
        return results
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "Cannot read this file. Use a readable image or an unlocked PDF.") from exc

async def _analyze_ocr(images, document_type):
    lines = []
    status = "unavailable"
    message = "Local OCR is unavailable. Enter readable fields manually or leave them blank; face analysis continues."
    fields = parse_lines([], document_type)
    if settings.OCR_ENABLED:
        try:
            lines = await local_ocr.recognize(images)
            fields = parse_lines(lines, document_type)
            status = "complete" if fields.get("full_name") and fields.get("document_number") and fields["document_type"] == document_type else "partial"
            message = "Review the locally extracted fields." if status == "complete" else "Some fields could not be read reliably. Correct them or leave them blank; face analysis continues."
        except Exception:
            # Never expose OCR internals or source identity text in error messages.
            pass
    checks = validate_fields(fields, document_type)
    if not fields.get("document_number"):
        checks["number_format_valid"] = None
    if fields["document_type"] == "unknown":
        checks["document_type_matches"] = None
    return {"document_type": fields["document_type"], "extracted_fields": fields,
            "raw_text": "\n".join(line["text"] for line in lines), "lines": lines,
            "confidence_score": None, "validation": checks, "provider": "paddleocr",
            "status": status, "message": message}


async def _analyze_face(images):
    face = await face_extractor.extract_and_save_face(images[0])
    if not face.face_found and len(images) == 2:
        face = await face_extractor.extract_and_save_face(images[1])
    if not face.success:
        raise HTTPException(503, "Face processing or storage is unavailable. Please retry.")
    return face


async def analyze_document(payload, document_type, back=None):
    images = await asyncio.to_thread(prepare_images, payload)
    if back:
        images.extend(await asyncio.to_thread(prepare_images, back))
    if len(images) > 2:
        raise HTTPException(422, "Upload at most two pages/sides for one document.")
    # Independent branches: OCR errors become explicit partial results, never a
    # gate on face extraction. Persistence/model failures still surface as errors.
    ocr, face, forgery, urls, ai_images = await asyncio.gather(
        _analyze_ocr(images, document_type), _analyze_face(images), analyze_forgery(images[0]),
        asyncio.gather(*[storage.upload_image(img) for img in images]),
        ai_image_detector.analyze_images(images, document_pages=True),
    )
    return {"ocr": ocr, "face": face.model_dump(), "forgery": forgery.model_dump(), "ai_images": ai_images,
            "document_url": urls[0], "document_back_url": urls[1] if len(urls) > 1 else None,
            "page_count": len(images), "source_format": "pdf" if payload.startswith(b"%PDF-") else "image"}
