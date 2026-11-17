from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from app.services.indian_documents import analyze_document
from app.services import ai_image_detector

router = APIRouter(prefix="/documents", tags=["Indian documents"])

@router.post("/analyze-indian")
async def analyze_indian(front_image: UploadFile = File(...), document_type: str = Form(...), back_image: UploadFile | None = File(None)):
    document_type = document_type.lower()
    if document_type not in {"aadhaar", "pan"}:
        raise HTTPException(400, "Select Aadhaar or PAN.")
    front = await front_image.read(10 * 1024 * 1024 + 1)
    back = await back_image.read(10 * 1024 * 1024 + 1) if back_image else None
    return await analyze_document(front, document_type, back)


@router.post("/analyze-ai-image")
async def analyze_ai_image(image: UploadFile = File(...)):
    payload = await image.read(10 * 1024 * 1024 + 1)
    if not payload or len(payload) > 10 * 1024 * 1024:
        raise HTTPException(413, "Upload an image of at most 10 MB.")
    return await ai_image_detector.analyze_images([payload])
