"""Experimental local Community Forensics scoring, independent of OCR and faces."""
import asyncio
import io
import hashlib
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from app.core.config import settings

MODEL_ID = "buildborderless/CommunityForensics-DeepfakeDet-ViT"
REVISION = "ac6ee457bea904a373065754107451793b56db00"
MODEL_URL = f"https://huggingface.co/{MODEL_ID}/tree/{REVISION}"
MODEL_SHA256 = "a42c7d740fbb345ba9a26d469b22f301d73089ce3c6da993877ed2b6965a8ba1"
UNCERTAIN_SCORE_LOW = 45
UNCERTAIN_SCORE_HIGH = 55
_session = None
_inference_workers = 4
_inference_pool = ThreadPoolExecutor(
    max_workers=_inference_workers,
    thread_name_prefix="ai-image-inference",
)
_run_semaphore = threading.BoundedSemaphore(1)
_status_lock = threading.Lock()
_input_name = "pixel_values"
_output_name = "logits"
_execution_provider = None
_available_providers = []
_provider_fallback = None
_runtime_version = None
_model_state = {"state": "not_loaded", "error_code": None, "message": None}
logger = logging.getLogger(__name__)


def is_ready():
    return _session is not None


def model_status():
    with _status_lock:
        state = dict(_model_state)
    if not settings.AI_DETECTION_ENABLED:
        state.update(
            state="disabled",
            error_code="detection_disabled",
            message="AI-image detection is disabled by configuration.",
        )
    return {
        **state,
        "ready": state["state"] == "ready" and is_ready(),
        "model_id": MODEL_ID,
        "revision": REVISION,
        "variant": "ONNX FP32",
        "execution_provider": _execution_provider,
        "available_providers": list(_available_providers),
        "provider_fallback": _provider_fallback,
        "runtime": "ONNX Runtime",
        "runtime_version": _runtime_version,
    }


class ModelIntegrityError(ValueError):
    pass


class ModelSignatureError(ValueError):
    pass


class InvalidImageError(ValueError):
    pass


def _set_model_state(state, error_code=None, message=None):
    with _status_lock:
        _model_state.update(state=state, error_code=error_code, message=message)


def _validate_model_signature(session):
    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1 or len(outputs) != 1:
        raise ModelSignatureError("Expected one model input and one output")

    model_input = inputs[0]
    model_output = outputs[0]
    input_shape = model_input.shape
    output_shape = model_output.shape
    if (model_input.name != "pixel_values" or model_input.type != "tensor(float)"
            or len(input_shape) != 4):
        raise ModelSignatureError("Unexpected model input")
    for actual, expected in zip(input_shape[1:], (3, 384, 384)):
        if isinstance(actual, int) and actual != expected:
            raise ModelSignatureError("Unexpected model input dimensions")
    if (model_output.name != "logits" or model_output.type != "tensor(float)"
            or len(output_shape) != 2 or output_shape[-1] != 1):
        raise ModelSignatureError("Unexpected model output")
    return model_input.name, model_output.name


def _preferred_provider(available_providers):
    for provider in ("CUDAExecutionProvider", "DmlExecutionProvider"):
        if provider in available_providers:
            return provider
    return "CPUExecutionProvider"


def load_model():
    global _session, _input_name, _output_name, _execution_provider
    global _available_providers, _provider_fallback, _run_semaphore
    global _runtime_version
    _execution_provider = None
    _available_providers = []
    _provider_fallback = None
    _runtime_version = None
    _run_semaphore = threading.BoundedSemaphore(1)
    if not settings.AI_DETECTION_ENABLED:
        _session = None
        _set_model_state("disabled", "detection_disabled", "AI-image detection is disabled by configuration.")
        return
    _session = None
    _set_model_state("loading")
    try:
        import onnxruntime as ort
        _runtime_version = ort.__version__
        model_path = Path(settings.AI_MODEL_PATH)
        if not model_path.is_file():
            raise FileNotFoundError("Pinned AI-image detector model is missing")
        if hashlib.sha256(model_path.read_bytes()).hexdigest() != MODEL_SHA256:
            raise ModelIntegrityError("Model integrity check failed")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        _available_providers = ort.get_available_providers()
        preferred_provider = _preferred_provider(_available_providers)
        if preferred_provider == "DmlExecutionProvider":
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            options.enable_mem_pattern = False
        providers = [preferred_provider]
        if preferred_provider != "CPUExecutionProvider":
            providers.append("CPUExecutionProvider")
        try:
            session = ort.InferenceSession(
                str(model_path), sess_options=options, providers=providers
            )
        except Exception:
            if preferred_provider == "CPUExecutionProvider":
                raise
            _provider_fallback = (
                f"{preferred_provider} failed to initialize; using CPUExecutionProvider."
            )
            logger.warning(_provider_fallback, exc_info=True)
            session = ort.InferenceSession(
                str(model_path), sess_options=options, providers=["CPUExecutionProvider"]
            )
        session_providers = session.get_providers()
        _execution_provider = (
            session_providers[0] if session_providers else "CPUExecutionProvider"
        )
        if _execution_provider == "CPUExecutionProvider":
            _run_semaphore = threading.BoundedSemaphore(_inference_workers)
            if preferred_provider != "CPUExecutionProvider" and _provider_fallback is None:
                _provider_fallback = (
                    f"{preferred_provider} was unavailable for this model; "
                    "using CPUExecutionProvider."
                )
        else:
            _run_semaphore = threading.BoundedSemaphore(1)
        _input_name, _output_name = _validate_model_signature(session)
        _session = session
        _set_model_state("ready")
    except FileNotFoundError:
        _session = None
        _set_model_state("error", "model_file_missing", "The pinned AI-image detector model file is missing.")
        logger.exception("AI-image detector model file is missing.")
    except ModelIntegrityError:
        _session = None
        _set_model_state("error", "model_integrity_check_failed", "The AI-image detector model failed its integrity check.")
        logger.exception("AI-image detector model integrity check failed.")
    except ModelSignatureError:
        _session = None
        _set_model_state("error", "model_signature_invalid", "The AI-image detector model has an unexpected input/output signature.")
        logger.exception("AI-image detector model signature validation failed.")
    except Exception:
        _session = None
        _set_model_state("error", "model_load_failed", "The AI-image detector could not be loaded.")
        logger.exception("AI-image detector unavailable; other analysis remains available.")


def _load_image(payload):
    with Image.open(io.BytesIO(payload)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if image.width * image.height > 40_000_000:
        raise InvalidImageError("Image resolution is too large")
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


def _decision_for_score(score):
    if UNCERTAIN_SCORE_LOW <= score <= UNCERTAIN_SCORE_HIGH:
        return "uncertain"
    return "higher_ai_signal" if score > UNCERTAIN_SCORE_HIGH else "lower_ai_signal"


def _predict_array(array):
    if _session is None:
        raise RuntimeError("Model not ready")
    if array.shape != (1, 3, 384, 384) or array.dtype != np.float32:
        raise ValueError("Unexpected preprocessed input")
    with _run_semaphore:
        outputs = _session.run([_output_name], {_input_name: array})
    if len(outputs) != 1:
        raise ValueError("Unexpected model output count")
    result = np.asarray(outputs[0])
    if result.shape != (1, 1) or result.dtype != np.float32:
        raise ValueError("Unexpected model output tensor")
    logit = float(result[0, 0])
    if not np.isfinite(logit):
        raise ValueError("Invalid model output")
    return logit


def _predict_raw(payload):
    return _predict_array(preprocess(payload))


def _predict_with_metadata(payload):
    started = time.perf_counter()
    logit = _predict_raw(payload)
    score = score_logit(logit)
    return {
        "raw_logit": logit,
        "ai_score": score,
        "decision": _decision_for_score(score),
        "inference_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def _predict_image_with_metadata(image):
    started = time.perf_counter()
    logit = _predict_array(_preprocess_image(image))
    score = score_logit(logit)
    return {
        "raw_logit": logit,
        "ai_score": score,
        "decision": _decision_for_score(score),
        "inference_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def _document_view_images(payload):
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
        views.append((name, image.crop(box)))
    return views


def _predict_document(payload):
    started = time.perf_counter()
    view_scores = []
    views = _document_view_images(payload)
    if _execution_provider == "CPUExecutionProvider" and len(views) > 1:
        futures = [
            _inference_pool.submit(_predict_image_with_metadata, view_image)
            for _, view_image in views
        ]
        predictions = [future.result() for future in futures]
        view_scores = [
            {"view": name, **prediction}
            for (name, _), prediction in zip(views, predictions)
        ]
    else:
        for name, view_image in views:
            view_scores.append({"view": name, **_predict_image_with_metadata(view_image)})
    highest = max(view_scores, key=lambda view: view["ai_score"])
    return {
        **highest,
        "inference_ms": round((time.perf_counter() - started) * 1000, 2),
        "view_scores": view_scores,
    }


def _error_details(error):
    if isinstance(error, asyncio.TimeoutError):
        return "inference_timeout", "AI-image analysis timed out. Please retry."
    if isinstance(error, (InvalidImageError, OSError)):
        return "invalid_image", "The uploaded file could not be decoded as a supported image."
    return "inference_failed", "AI-image analysis failed. Other analysis remains available."


def _model_unavailable_details(status):
    if status["state"] == "loading":
        return "model_loading", "The AI-image detector is still loading. Please retry shortly."
    if status["state"] == "error":
        return status["error_code"] or "model_load_failed", status["message"] or "The AI-image detector could not be loaded."
    return "model_not_ready", "The AI-image detector is not ready."


async def analyze_images(images, document_pages=False):
    detector_status = model_status()
    if not images:
        results = []
    else:
        loop = asyncio.get_running_loop()

        async def analyze_one(index, payload):
            timeout_seconds = 60 if document_pages else 30
            try:
                if not settings.AI_DETECTION_ENABLED:
                    return {
                        "image_index": index,
                        "status": "unavailable",
                        "ai_score": None,
                        "error_code": "detection_disabled",
                        "error_message": "AI-image detection is disabled by configuration.",
                    }
                if not detector_status["ready"]:
                    error_code, error_message = _model_unavailable_details(detector_status)
                    return {
                        "image_index": index,
                        "status": "unavailable",
                        "ai_score": None,
                        "error_code": error_code,
                        "error_message": error_message,
                    }
                if document_pages:
                    future = loop.run_in_executor(None, _predict_document, payload)
                else:
                    future = loop.run_in_executor(
                        _inference_pool, _predict_with_metadata, payload
                    )
                evidence = await asyncio.wait_for(future, timeout=timeout_seconds)
                return {"image_index": index, "status": "complete", **evidence}
            except Exception as error:
                logger.exception("AI-image detection failed for image %d", index + 1)
                error_code, error_message = _error_details(error)
                return {
                    "image_index": index,
                    "status": "unavailable",
                    "ai_score": None,
                    "error_code": error_code,
                    "error_message": error_message,
                }

        request_started = time.perf_counter()
        results = await asyncio.gather(
            *(analyze_one(index, payload) for index, payload in enumerate(images))
        )
        request_inference_ms = round((time.perf_counter() - request_started) * 1000, 2)
    completed = sum(result["status"] == "complete" for result in results)
    return {"status": "complete" if results and completed == len(results) else "partial" if completed else "unavailable",
            "images": results, "model_status": detector_status, "model_id": MODEL_ID, "revision": REVISION,
            "model_version": REVISION, "model_sha256": MODEL_SHA256, "model_url": MODEL_URL,
            "variant": "ONNX FP32", "ai_logit_semantics": "A positive logit is mapped to a higher AI-generation signal; the model has one logit, not separate class indices.",
            "decision_threshold": 50, "uncertain_score_range": [UNCERTAIN_SCORE_LOW, UNCERTAIN_SCORE_HIGH],
            "inference_ms": request_inference_ms if results else 0,
            "score_kind": "highest across up to five overlapping document-view sigmoid scores; not calibrated probability" if document_pages else "sigmoid model score; not calibrated probability",
            "preprocessing": "Center and up to four 70%-sized corner views; each resized, center-cropped to 384px and CLIP-normalized" if document_pages else "Shortest edge 440px, center crop 384px, CLIP normalization",
            "limitation": "Experimental general-image detector, not validated on Aadhaar/PAN scans. Multiple views improve page coverage but can increase false positives; compression and unseen generators can change scores. A low score does not prove authenticity; no fraud-risk points are added."}
