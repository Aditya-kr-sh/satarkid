"""Local, serialized PaddleOCR inference. No cloud provider or API credentials."""
import asyncio
import io
import logging
import os
import threading
from pathlib import Path

import numpy as np
from PIL import Image
from app.core.config import settings

logger = logging.getLogger(__name__)
_engine = None
_load_error = False
_lock = threading.Lock()


def is_ready():
    return _engine is not None


def load_models():
    global _engine, _load_error
    with _lock:
        if _engine is not None:
            return
        cache = Path(settings.PADDLE_CACHE_DIR).expanduser().resolve()
        cache.mkdir(parents=True, exist_ok=True)
        os.environ["PADDLE_PDX_CACHE_HOME"] = str(cache)
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        try:
            from paddleocr import PaddleOCR
            _engine = PaddleOCR(
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                text_detection_model_dir=str(cache / "official_models/PP-OCRv5_mobile_det") if (cache / "official_models/PP-OCRv5_mobile_det/inference.yml").is_file() else None,
                text_recognition_model_dir=str(cache / "official_models/en_PP-OCRv5_mobile_rec") if (cache / "official_models/en_PP-OCRv5_mobile_rec/inference.yml").is_file() else None,
                use_doc_orientation_classify=False, use_doc_unwarping=False,
                use_textline_orientation=False, device="cpu", cpu_threads=4,
                enable_mkldnn=False,
            )
            _load_error = False
        except Exception:
            _load_error = True
            logger.warning("Local OCR model initialization failed; manual review remains available.")


def _recognize(images):
    if _engine is None:
        raise RuntimeError("Local OCR is unavailable" if _load_error else "Local OCR models are still loading")
    lines = []
    with _lock:
        for page, payload in enumerate(images):
            # Paddle's numpy image interface expects BGR.
            img = np.asarray(Image.open(io.BytesIO(payload)).convert("RGB"))[:, :, ::-1].copy()
            for result in _engine.predict(img):
                for text, score, box in zip(result["rec_texts"], result["rec_scores"], result["rec_boxes"]):
                    if str(text).strip():
                        lines.append({"text": str(text).strip(), "confidence": round(float(score), 4),
                                      "box": [int(v) for v in box], "page": page})
    return lines


async def recognize(images):
    return await asyncio.wait_for(asyncio.to_thread(_recognize, images), timeout=90)
