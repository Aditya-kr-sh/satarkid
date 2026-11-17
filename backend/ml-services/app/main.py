import asyncio
import logging
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from app.core.config import settings
from fastapi.middleware.cors import CORSMiddleware

from app.api.endpoints import health
from app.api.endpoints.face import router as face_router
from app.api.endpoints.indian_documents import router as indian_documents_router
from app.database.postgres import get_db_pool, get_pool
from app.services import face_extractor, local_ocr, ai_image_detector
from app.services import liveness_detector
import app.database.postgres as db_client

logger = logging.getLogger(__name__)

app = FastAPI(title="SatarkID ML Services", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(face_router, prefix="/api/v1", tags=["Face"])
app.include_router(indian_documents_router, prefix="/api/v1")


async def _load_models_background() -> None:
    """Run blocking model load in the default thread-pool executor."""
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, face_extractor.load_models)
    except Exception:
        logger.exception("Background model loading failed")


@app.on_event("startup")
async def startup():
    """Bind DB pool, then load face models in the background."""
    db_client.db_pool = await get_db_pool()
    asyncio.create_task(_load_models_background())
    if settings.OCR_ENABLED:
        asyncio.create_task(asyncio.to_thread(local_ocr.load_models))
    if settings.AI_DETECTION_ENABLED:
        asyncio.create_task(asyncio.to_thread(ai_image_detector.load_model))


@app.on_event("shutdown")
async def shutdown():
    """Close the asyncpg pool on application shutdown."""
    if db_client.db_pool:
        await db_client.db_pool.close()


@app.get("/api/v1/ready")
async def ready():
    """OCR availability is informative; face, liveness and storage readiness gate uploads."""
    database_ready = False
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1 FROM face_embeddings LIMIT 1")
        database_ready = True
    except Exception as exc:
        logger.warning("PostgreSQL readiness check failed: %s", exc)
    from pathlib import Path
    import os
    storage_ready = (bool(settings.LOCAL_UPLOAD_DIR) and Path(settings.LOCAL_UPLOAD_DIR).is_dir()
                     and os.access(settings.LOCAL_UPLOAD_DIR, os.W_OK) and bool(settings.PUBLIC_UPLOAD_URL))
    checks = {"models_ready": face_extractor.is_ready(), "liveness_ready": liveness_detector.is_ready(),
              "database_ready": database_ready,
              "storage_ready": storage_ready}
    ready_now = all(checks.values())
    return JSONResponse(status_code=200 if ready_now else 503, content={
        **checks, "ocr_provider": "paddleocr", "ocr_ready": local_ocr.is_ready(),
        "ai_detector_ready": ai_image_detector.is_ready(),
        "ai_detector": ai_image_detector.model_status(),
        "ocr_enabled": settings.OCR_ENABLED, "status": "ready" if ready_now else "not_ready",
    })


@app.get("/")
async def root():
    return {
        "service": "SatarkID ML Services",
        "version": "1.1.0",
        "status": "operational",
        "models_ready": face_extractor.is_ready(),
        "endpoints": [
            "/api/v1/health",
            "/api/v1/ready",
            "/api/v1/documents/analyze-indian",
            "/api/v1/documents/analyze-ai-image",
            "/api/v1/face/liveness",
            "/api/v1/face/compare",
        ]
    }
