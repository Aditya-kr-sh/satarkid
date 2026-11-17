import io
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from PIL import Image
from app.core.config import settings
from app.services import ai_image_detector as ai


class ScoreTests(unittest.TestCase):
    def test_binary_output_is_single_logit_sigmoid(self):
        self.assertEqual(ai.score_logit(0), 50)
        self.assertLess(ai.score_logit(-4), 2)
        self.assertGreater(ai.score_logit(4), 98)
        with self.assertRaises(ValueError): ai.score_logit(float("nan"))

    def test_accelerated_provider_is_preferred_when_installed(self):
        self.assertEqual(
            ai._preferred_provider(
                ["AzureExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
            ),
            "DmlExecutionProvider",
        )
        self.assertEqual(
            ai._preferred_provider(["AzureExecutionProvider", "CPUExecutionProvider"]),
            "CPUExecutionProvider",
        )

    def test_decision_band_is_uncertain_without_claiming_real_or_fake(self):
        self.assertEqual(ai._decision_for_score(44.99), "lower_ai_signal")
        self.assertEqual(ai._decision_for_score(45), "uncertain")
        self.assertEqual(ai._decision_for_score(55), "uncertain")
        self.assertEqual(ai._decision_for_score(55.01), "higher_ai_signal")

    def test_model_signature_requires_single_rgb_384_input_and_single_logit(self):
        inputs = [SimpleNamespace(name="pixel_values", type="tensor(float)",
                                  shape=["batch_size", "num_channels", "height", "width"])]
        outputs = [SimpleNamespace(name="logits", type="tensor(float)",
                                   shape=["batch_size", 1])]
        self.assertEqual(ai._validate_model_signature(SimpleNamespace(
            get_inputs=lambda: inputs, get_outputs=lambda: outputs)), ("pixel_values", "logits"))
        with self.assertRaises(ai.ModelSignatureError):
            ai._validate_model_signature(SimpleNamespace(
                get_inputs=lambda: inputs, get_outputs=lambda: [
                    SimpleNamespace(name="logits", type="tensor(float)", shape=["batch_size", 2])
                ]))

    def test_raw_inference_preserves_logit_and_checks_tensor_output(self):
        session = SimpleNamespace(run=lambda names, feed: [np.array([[1.25]], dtype=np.float32)])
        with patch.object(ai, "_session", session), patch.object(
            ai, "preprocess", return_value=np.zeros((1, 3, 384, 384), dtype=np.float32)
        ):
            self.assertEqual(ai._predict_raw(b"image"), 1.25)

    def test_preprocessing_preserves_center_and_rgb_normalization(self):
        image = Image.new("RGB", (1200, 600), "red")
        image.paste("white", (300, 0, 900, 600))
        output = io.BytesIO(); image.save(output, format="PNG")
        array = ai.preprocess(output.getvalue())
        self.assertEqual(array.shape, (1, 3, 384, 384))
        self.assertEqual(array.dtype, np.float32)
        np.testing.assert_allclose(array[0, :, 192, 192],
            (1 - np.array([0.48145466, 0.4578275, 0.40821073])) / np.array([0.26862954, 0.26130258, 0.27577711]), rtol=1e-5)


class FailureTests(unittest.IsolatedAsyncioTestCase):
    def test_missing_model_file_is_reported_as_a_load_error(self):
        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(
            ai.Path, "is_file", return_value=False
        ):
            ai.load_model()
        status = ai.model_status()
        self.assertEqual(status["state"], "error")
        self.assertEqual(status["error_code"], "model_file_missing")
        self.assertIn("model file is missing", status["message"])

    async def test_document_uses_highest_of_five_overlapping_views(self):
        image = Image.new("RGB", (1000, 600), "white")
        output = io.BytesIO()
        image.save(output, format="PNG")
        evidence = [
            {"raw_logit": -3.2, "ai_score": 3.5, "decision": "lower_ai_signal", "inference_ms": 10},
            {"raw_logit": 0.9, "ai_score": 71.0, "decision": "higher_ai_signal", "inference_ms": 11},
            {"raw_logit": -2.0, "ai_score": 12.0, "decision": "lower_ai_signal", "inference_ms": 12},
            {"raw_logit": -3.8, "ai_score": 2.0, "decision": "lower_ai_signal", "inference_ms": 13},
            {"raw_logit": -4.5, "ai_score": 1.0, "decision": "lower_ai_signal", "inference_ms": 14},
        ]
        ready_status = {"state": "ready", "ready": True, "model_id": ai.MODEL_ID,
                        "revision": ai.REVISION, "variant": "ONNX FP32"}
        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(
            ai, "model_status", return_value=ready_status
        ), patch.object(ai, "_execution_provider", "DmlExecutionProvider"), patch.object(
            ai, "_predict_image_with_metadata", side_effect=evidence
        ) as predict:
            result = await ai.analyze_images([output.getvalue()], document_pages=True)

        self.assertEqual(predict.call_count, 5)
        self.assertEqual(result["images"][0]["ai_score"], 71.0)
        self.assertEqual(result["images"][0]["raw_logit"], 0.9)
        self.assertGreater(result["images"][0]["inference_ms"], 0)
        self.assertEqual(result["images"][0]["view_scores"][1]["view"], "top_left")
        self.assertEqual(result["score_kind"], "highest across up to five overlapping document-view sigmoid scores; not calibrated probability")

    async def test_cpu_document_views_run_concurrently(self):
        image = Image.new("RGB", (1000, 600), "white")
        output = io.BytesIO()
        image.save(output, format="PNG")
        ready_status = {"state": "ready", "ready": True, "model_id": ai.MODEL_ID,
                        "revision": ai.REVISION, "variant": "ONNX FP32"}
        active = 0
        maximum_active = 0
        active_lock = threading.Lock()

        def predict(_payload):
            nonlocal active, maximum_active
            with active_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.03)
            with active_lock:
                active -= 1
            return {"raw_logit": -1.0, "ai_score": 26.89,
                    "decision": "lower_ai_signal", "inference_ms": 30}

        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(
            ai, "model_status", return_value=ready_status
        ), patch.object(ai, "_execution_provider", "CPUExecutionProvider"), patch.object(
            ai, "_predict_image_with_metadata", side_effect=predict
        ):
            result = await ai.analyze_images([output.getvalue()], document_pages=True)

        self.assertEqual(result["status"], "complete")
        self.assertGreaterEqual(maximum_active, 2)

    async def test_unavailable_detector_never_becomes_zero_score(self):
        ready_status = {"state": "ready", "ready": True, "model_id": ai.MODEL_ID,
                        "revision": ai.REVISION, "variant": "ONNX FP32"}
        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(
            ai, "model_status", return_value=ready_status
        ), patch.object(ai, "_predict_with_metadata", side_effect=RuntimeError("internal details")):
            result = await ai.analyze_images([b"image"])
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["images"][0]["ai_score"])
        self.assertEqual(result["images"][0]["error_code"], "inference_failed")
        self.assertNotIn("internal details", str(result))

    async def test_one_page_failure_does_not_hide_another_score(self):
        ready_status = {"state": "ready", "ready": True, "model_id": ai.MODEL_ID,
                        "revision": ai.REVISION, "variant": "ONNX FP32"}
        evidence = {"raw_logit": -2.0, "ai_score": 12.5, "decision": "lower_ai_signal", "inference_ms": 10}

        def predict(payload):
            if payload == b"page1":
                return evidence
            raise ValueError()

        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(
            ai, "model_status", return_value=ready_status
        ), patch.object(ai, "_predict_with_metadata", side_effect=predict):
            result = await ai.analyze_images([b"page1", b"page2"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["images"][0]["ai_score"], 12.5)
        self.assertIsNone(result["images"][1]["ai_score"])

    async def test_model_load_failure_is_reported_without_running_inference(self):
        failed_status = {"state": "error", "ready": False, "error_code": "model_integrity_check_failed",
                         "message": "The AI-image detector model failed its integrity check."}
        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(
            ai, "model_status", return_value=failed_status
        ), patch.object(ai, "_predict_with_metadata") as predict:
            result = await ai.analyze_images([b"image"])
        predict.assert_not_called()
        self.assertEqual(result["images"][0]["error_code"], "model_integrity_check_failed")
        self.assertEqual(result["images"][0]["error_message"], failed_status["message"])

    async def test_disabled_detector_does_not_run_inference(self):
        with patch.object(settings, "AI_DETECTION_ENABLED", False), patch.object(
            ai, "_predict_with_metadata"
        ) as predict:
            result = await ai.analyze_images([b"image"])
        predict.assert_not_called()
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["images"][0]["error_code"], "detection_disabled")
