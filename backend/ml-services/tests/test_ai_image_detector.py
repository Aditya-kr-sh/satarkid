import io
import unittest
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
    async def test_document_uses_highest_of_five_overlapping_views(self):
        image = Image.new("RGB", (1000, 600), "white")
        output = io.BytesIO()
        image.save(output, format="PNG")
        scores = [3.5, 71.0, 12.0, 2.0, 1.0]
        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(ai, "_predict", side_effect=scores) as predict:
            result = await ai.analyze_images([output.getvalue()], document_pages=True)

        self.assertEqual(predict.call_count, 5)
        self.assertEqual(result["images"][0]["ai_score"], 71.0)
        self.assertEqual(result["images"][0]["view_scores"][1]["view"], "top_left")
        self.assertEqual(result["score_kind"], "highest across up to five overlapping document-view sigmoid scores; not calibrated probability")

    async def test_unavailable_detector_never_becomes_zero_score(self):
        with patch.object(ai, "_predict", side_effect=RuntimeError("internal details")):
            result = await ai.analyze_images([b"image"])
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["images"][0]["ai_score"])
        self.assertNotIn("internal details", str(result))

    async def test_one_page_failure_does_not_hide_another_score(self):
        with patch.object(settings, "AI_DETECTION_ENABLED", True), patch.object(ai, "_predict", side_effect=[12.5, ValueError()]):
            result = await ai.analyze_images([b"page1", b"page2"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["images"][0]["ai_score"], 12.5)
        self.assertIsNone(result["images"][1]["ai_score"])

    async def test_disabled_detector_does_not_run_inference(self):
        with patch.object(settings, "AI_DETECTION_ENABLED", False), patch.object(ai, "_predict") as predict:
            result = await ai.analyze_images([b"image"])
        predict.assert_not_called()
        self.assertEqual(result["status"], "unavailable")
