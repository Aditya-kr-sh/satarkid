"""Local face extraction, cropping, duplicate lookup and atomic persistence."""

from __future__ import annotations

import asyncio
import logging
import json
import uuid
from time import perf_counter
from typing import List, Optional, Tuple

import re
import cv2
import numpy as np
from insightface.app import FaceAnalysis

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

from app.core.config import settings
from app.models.face_models import (
    DuplicateMatch,
    FaceExtractionResult,
    FaceRegion,
)
from app.services import storage
from app.database import postgres

logger = logging.getLogger(__name__)

# Singleton — populated lazily via load_models().
face_app: Optional[FaceAnalysis] = None
_models_ready = False
_load_lock = __import__("threading").Lock()

# Pixels of padding added around the detected face before cropping.
_CROP_PADDING = 10


def load_models() -> None:
    """Load InsightFace ONNX models into memory (blocking, thread-safe).

    Called from the FastAPI startup hook inside a thread-pool executor so
    the server binds immediately and this heavy work runs in the background.
    The lock ensures the models are only loaded once even if called from
    multiple threads.
    """
    global face_app, _models_ready
    with _load_lock:
        if _models_ready:
            return
        logger.info("Loading InsightFace models (%s)...", settings.FACE_MODEL_NAME)
        t0 = perf_counter()
        _app = FaceAnalysis(
            name=settings.FACE_MODEL_NAME, providers=["CPUExecutionProvider"]
        )
        _app.prepare(ctx_id=-1, det_size=(640, 640))
        # Assign to global only after fully prepared so _detect never sees
        # a half-initialised object.
        face_app = _app
        _models_ready = True
        logger.info("InsightFace models ready in %.1fs", perf_counter() - t0)


def is_ready() -> bool:
    """Return True once the models have finished loading."""
    return _models_ready


def _detect(img_bytes: bytes) -> Tuple[list, Optional[np.ndarray]]:
    """Decode image bytes and run InsightFace detection (sync, for executor)."""
    if face_app is None:
        raise RuntimeError("Face models are still loading. Please retry in a moment.")
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return [], None
    faces = face_app.get(img)
    return faces, img


def _crop_encode(
    img: np.ndarray, bbox: List[int]
) -> Optional[bytes]:
    """Crop the face region (with padding) and JPEG-encode it (sync).

    Args:
        img: Decoded BGR image.
        bbox: Face bounding box ``[x1, y1, x2, y2]``.

    Returns:
        JPEG-encoded bytes of the cropped face, or ``None`` on failure.
    """
    height, width = img.shape[:2]
    x1 = max(0, bbox[0] - _CROP_PADDING)
    y1 = max(0, bbox[1] - _CROP_PADDING)
    x2 = min(width, bbox[2] + _CROP_PADDING)
    y2 = min(height, bbox[3] + _CROP_PADDING)

    cropped = img[y1:y2, x1:x2]
    if cropped.size == 0:
        return None

    ok, buffer = cv2.imencode(".jpg", cropped)
    if not ok:
        return None
    return buffer.tobytes()


def _to_vector_literal(embedding: np.ndarray) -> str:
    """Format a numpy embedding as a pgvector text literal ``[v1,v2,...]``.

    Used by ``$1::vector`` casts in parameterized SQL.
    """
    return "[" + ",".join(str(float(v)) for v in embedding.tolist()) + "]"


async def _find_duplicate(embedding: np.ndarray, similarity_threshold: float | None = None) -> Optional[DuplicateMatch]:
    """Compare against saved verified faces; pending samples never block uploads."""
    threshold = similarity_threshold if similarity_threshold is not None else settings.DUPLICATE_SIMILARITY_THRESHOLD
    pool = await postgres.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT submission_id, created_at, 1 - (embedding <=> $1::vector) AS similarity
            FROM face_embeddings WHERE is_verified = true
            ORDER BY embedding <=> $1::vector LIMIT 1
        """, _to_vector_literal(embedding))
    if row and float(row["similarity"]) > threshold:
        return DuplicateMatch(matched_submission_id=str(row["submission_id"]),
            similarity_score=round(float(row["similarity"]), 4), matched_at=str(row["created_at"]))
    return None


async def _persist_face(submission_id, embedding, confidence, bbox,
                        duplicate_match, id_image_url, face_image_url):
    """Persist both rows atomically using the same database as onboarding."""
    pool = await postgres.get_pool()
    region = dict(zip(("x1", "y1", "x2", "y2"), map(int, bbox)))
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO kyc_submissions (id, status, risk_score) VALUES ($1, 'pending', 0)",
                uuid.UUID(submission_id),
            )
            await conn.execute(
                """INSERT INTO face_embeddings
                (submission_id, embedding, detection_confidence, face_region,
                 is_duplicate, matched_submission_id, id_image_url, face_image_url)
                VALUES ($1, $2::vector, $3, $4::jsonb, $5, $6, $7, $8)""",
                uuid.UUID(submission_id), _to_vector_literal(embedding), confidence,
                json.dumps(region), duplicate_match is not None,
                uuid.UUID(duplicate_match.matched_submission_id) if duplicate_match else None,
                id_image_url, face_image_url,
            )


async def extract_and_save_face(
    image_bytes: bytes,
    submission_id: str | None = None,
    similarity_threshold: float | None = None,
) -> FaceExtractionResult:
    """Detect, embed, deduplicate and persist a face from an ID image.

    Args:
        image_bytes: Raw bytes of the uploaded ID document image.
        submission_id: Optional caller-provided submission id; generated when
            omitted. Acts as the linking key across all KYC tables.

    Returns:
        A fully populated :class:`FaceExtractionResult`. This coroutine never
        raises: failures are surfaced via the ``success``/``error`` fields.
    """
    start_time = perf_counter()
    # Always generate a fresh UUID when the caller passes nothing, an empty
    # string, or Swagger's default placeholder value "string".
    if not submission_id or not _UUID_RE.match(submission_id):
        submission_id = str(uuid.uuid4())
    loop = asyncio.get_event_loop()

    def _elapsed_ms() -> int:
        return int((perf_counter() - start_time) * 1000)

    try:
        # Step 2: upload original ID image (non-fatal on failure).
        id_image_url: Optional[str] = None
        try:
            id_image_url = await storage.upload_image(image_bytes)
        except Exception:  # noqa: BLE001 - continue without the URL
            logger.exception("Local save of ID image failed")

        # Step 3: detect faces.
        faces, img = await loop.run_in_executor(None, _detect, image_bytes)

        # Step 4: no face found -> early, successful result.
        if not faces or img is None:
            return FaceExtractionResult(
                success=True,
                submission_id=submission_id,
                face_found=False,
                detection_confidence=None,
                face_region=None,
                is_duplicate=False,
                duplicate_match=None,
                id_image_url=id_image_url,
                face_image_url=None,
                embedding_saved=False,
                processing_time_ms=_elapsed_ms(),
                error=None,
            )

        # Step 5: choose the highest-confidence face.
        best_face = max(faces, key=lambda f: float(f.det_score))

        # Step 6: extract bbox, embedding and confidence.
        bbox = [int(v) for v in best_face.bbox.astype(int)]
        embedding = np.asarray(best_face.embedding, dtype=np.float32)
        confidence = float(best_face.det_score)

        face_region = FaceRegion(
            x1=bbox[0],
            y1=bbox[1],
            x2=bbox[2],
            y2=bbox[3],
            width=bbox[2] - bbox[0],
            height=bbox[3] - bbox[1],
        )

        # Steps 7-8: crop face and upload (non-fatal on failure).
        face_image_url: Optional[str] = None
        face_bytes = await loop.run_in_executor(
            None, _crop_encode, img, bbox
        )
        if face_bytes is not None:
            try:
                face_image_url = await storage.upload_image(face_bytes)
            except Exception:  # noqa: BLE001 - continue without the URL
                logger.exception("Local save of face crop failed")

        # Step 9: duplicate detection — verified faces only.
        duplicate_match = await _find_duplicate(embedding, similarity_threshold)

        await _persist_face(submission_id, embedding, confidence, bbox,
                            duplicate_match, id_image_url, face_image_url)
        embedding_saved = True

        # Step 12: full result.
        return FaceExtractionResult(
            success=True,
            submission_id=submission_id,
            face_found=True,
            detection_confidence=confidence,
            face_region=face_region,
            is_duplicate=duplicate_match is not None,
            duplicate_match=duplicate_match,
            id_image_url=id_image_url,
            face_image_url=face_image_url,
            embedding_saved=embedding_saved,
            processing_time_ms=_elapsed_ms(),
            error=None,
        )
    except Exception as exc:  # noqa: BLE001 - never crash the caller
        logger.exception("Unexpected failure during face extraction")
        return FaceExtractionResult(
            success=False,
            submission_id=submission_id,
            face_found=False,
            detection_confidence=None,
            face_region=None,
            is_duplicate=False,
            duplicate_match=None,
            id_image_url=None,
            face_image_url=None,
            embedding_saved=False,
            processing_time_ms=_elapsed_ms(),
            error=str(exc),
        )
