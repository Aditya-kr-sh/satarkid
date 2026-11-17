"""Experimental local Community Forensics scoring, independent of OCR and faces."""
import asyncio
import io
import hashlib
import logging
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from app.core.config import settings

MODEL_ID = "buildborderless/CommunityForensics-DeepfakeDet-ViT"
REVISION = "ac6ee457bea904a373065754107451793b56db00"
MODEL_URL = f"https://huggingface.co/{MODEL_ID}/tree/{REVISION}"
MODEL_SHA256 = "a42c7d740fbb345ba9a26d469b22f301d73089ce3c6da993877ed2b6965a8ba1"
_session = None
_lock = threading.Lock()
logger = logging.getLogger(__name__)


def is_ready():
    return _session is not None


def load_model():
    global _session
    if not settings.AI_DETECTION_ENABLED:
        return
    try:
        import onnxruntime as ort
        if hashlib.sha256(Path(settings.AI_MODEL_PATH).read_bytes()).hexdigest() != MODEL_SHA256:
            raise ValueError("Model integrity check failed")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        _session = ort.InferenceSession(settings.AI_MODEL_PATH, sess_options=options, providers=["CPUExecutionProvider"])
        if len(_session.get_inputs()[0].shape) != 4 or _session.get_outputs()[0].shape[-1] != 1:
            raise ValueError("Unexpected model signature")
    except Exception:
        _session = None
        logger.warning("AI-image detector unavailable; other analysis remains available.")


def _load_image(payload):
    with Image.open(io.BytesIO(payload)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if image.width * image.height > 40_000_000:
        raise ValueError("Image resolution is too large")
    return image


def _preprocess_image(image):
    # Corrected publisher recipe: aspect-preserving resize, center crop, CLIP normalization.
    width, height = image.size
    scale = 440 / min(width, height)
    image = image.resize((int(width * scale), int(height * scale)), Image.Resampling.BICUBIC)
    left, top = (image.width - 384) // 2, (image.height - 384) // 2
    image = image.crop((left, top, left + 384, top + 384))
    array = np.asarray(image, dtype=np.float32) / 255.0
    mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
    std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
    return np.ascontiguousarray(((array - mean) / std).transpose(2, 0, 1)[None])


def preprocess(payload):
    return _preprocess_image(_load_image(payload))


def score_logit(logit):
    if not np.isfinite(logit):
        raise ValueError("Invalid model output")
    return round(float(100 / (1 + np.exp(-np.clip(logit, -80, 80)))), 2)


def _predict(payload):
    if _session is None:
        raise RuntimeError("Model not ready")
    array = preprocess(payload)
    with _lock:
        result = _session.run(None, {"pixel_values": array})[0]
    return score_logit(float(np.asarray(result).reshape(-1)[0]))


def _document_view_payloads(payload):
    image = _load_image(payload)
    width, height = image.size
    crop_width = max(1, round(width * 0.7))
    crop_height = max(1, round(height * 0.7))
    horizontal = width - crop_width
    vertical = height - crop_height
    positions = [
        ("center", horizontal // 2, vertical // 2),
        ("top_left", 0, 0),
        ("top_right", horizontal, 0),
        ("bottom_left", 0, vertical),
        ("bottom_right", horizontal, vertical),
    ]
    views = []
    seen = set()
    for name, left, top in positions:
        box = (left, top, left + crop_width, top + crop_height)
        if box in seen:
            continue
        seen.add(box)
        output = io.BytesIO()
        image.crop(box).save(output, format="PNG")
        views.append((name, output.getvalue()))
    return views


def _predict_document(payload):
    view_scores = [
        {"view": name, "ai_score": _predict(view_payload)}
        for name, view_payload in _document_view_payloads(payload)
    ]
    return {
        "ai_score": max(view["ai_score"] for view in view_scores),
        "view_scores": view_scores,
    }


async def analyze_images(images, document_pages=False):
    results = []
    for index, payload in enumerate(images):
        if not settings.AI_DETECTION_ENABLED:
            results.append({"image_index": index, "status": "unavailable", "ai_score": None})
            continue
        try:
            timeout_seconds = 60 if document_pages else 30
            if document_pages:
                evidence = await asyncio.wait_for(
                    asyncio.to_thread(_predict_document, payload),
                    timeout=timeout_seconds,
                )
            else:
                evidence = {"ai_score": await asyncio.wait_for(
                    asyncio.to_thread(_predict, payload),
                    timeout=timeout_seconds,
                )}
            results.append({"image_index": index, "status": "complete", **evidence})
        except Exception:
            logger.exception("AI-image detection failed for image %d", index + 1)
            results.append({"image_index": index, "status": "unavailable", "ai_score": None})
    completed = sum(result["status"] == "complete" for result in results)
    return {"status": "complete" if results and completed == len(results) else "partial" if completed else "unavailable",
            "images": results, "model_id": MODEL_ID, "revision": REVISION, "model_url": MODEL_URL,
            "variant": "ONNX FP32",
            "score_kind": "highest across up to five overlapping document-view sigmoid scores; not calibrated probability" if document_pages else "sigmoid model score; not calibrated probability",
            "preprocessing": "Center and up to four 70%-sized corner views; each resized, center-cropped to 384px and CLIP-normalized" if document_pages else "Shortest edge 440px, center crop 384px, CLIP normalization",
            "limitation": "Experimental general-image detector, not validated on Aadhaar/PAN scans. Multiple views improve page coverage but can increase false positives; compression and unseen generators can change scores. A low score does not prove authenticity; no fraud-risk points are added."}
