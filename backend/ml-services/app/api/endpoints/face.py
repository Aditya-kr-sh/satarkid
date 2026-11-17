"""Compare an uploaded portrait with its saved document face."""
import asyncio
import math
from uuid import UUID
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from app.core.config import settings
from app.database import postgres
from app.services import liveness_detector
from app.services.face_extractor import _detect, _to_vector_literal, is_ready

router = APIRouter(prefix="/face", tags=["Face"])

@router.post("/liveness")
async def check_liveness(
    video: UploadFile = File(...),
    challenge: str = Form(..., pattern="^(turn_left|turn_right)$"),
):
    if not liveness_detector.is_ready():
        raise HTTPException(503, "The 3D face landmark model is unavailable.")
    content_type = (video.content_type or "").split(";", 1)[0].lower()
    extensions = {"video/webm": ".webm", "video/mp4": ".mp4", "video/quicktime": ".mov"}
    if content_type not in extensions:
        raise HTTPException(400, "Record a WebM or MP4 liveness video.")
    video_bytes = await video.read(settings.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if not video_bytes or len(video_bytes) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(400, "The liveness video is empty or too large.")
    try:
        return await asyncio.to_thread(
            liveness_detector.verify_video, video_bytes, extensions[content_type], challenge
        )
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/compare")
async def compare_faces(selfie_image: UploadFile = File(...), submission_id: UUID = Form(...),
                        match_threshold: float = Form(default=0.5, gt=0, le=1)):
    if not is_ready():
        raise HTTPException(503, "Face models are still loading.")
    if selfie_image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(400, "Upload a JPEG, PNG or WebP portrait.")
    image_bytes = await selfie_image.read(settings.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if not image_bytes or len(image_bytes) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(400, "Empty or oversized image.")
    try:
        faces, image = await asyncio.to_thread(_detect, image_bytes)
    except Exception as exc:
        raise HTTPException(503, "Face detection is unavailable.") from exc
    if image is None:
        raise HTTPException(400, "The uploaded image could not be decoded.")
    if not faces:
        return {"face_found": False, "similarity_score": None, "is_match": None,
                "threshold": match_threshold, "error": "No face detected in portrait."}
    face = max(faces, key=lambda item: float(item.det_score))
    vector = _to_vector_literal(np.asarray(face.embedding, dtype=np.float32))
    try:
        pool = await postgres.get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""SELECT 1 - (embedding <=> $1::vector) AS similarity
                FROM face_embeddings WHERE submission_id=$2 ORDER BY created_at DESC LIMIT 1""", vector, submission_id)
    except Exception as exc:
        raise HTTPException(503, "Saved face comparison is unavailable.") from exc
    if row is None or not math.isfinite(float(row["similarity"])):
        raise HTTPException(503, "No usable document face embedding was found.")
    score = round(float(row["similarity"]), 4)
    return {"face_found": True, "similarity_score": score, "is_match": score >= match_threshold,
            "threshold": match_threshold, "error": None}
