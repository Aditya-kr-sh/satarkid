import io
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from PIL import Image
from app.services import indian_documents, local_ocr
from app.services.indian_parser import parse_lines
from app.core.config import settings


def lines(*texts):
    return [{"text": text, "confidence": 0.99, "page": 0, "box": [0, i * 20, 200, i * 20 + 15]} for i, text in enumerate(texts)]


class ParserTests(unittest.TestCase):
    def test_vid_is_not_an_aadhaar_number(self):
        parsed = parse_lines(lines("AADHAAR", "SAMPLE PERSON", "YoB: 1990", "XXXX XXXX 1234", "VID : 2345 6789 1234 5678"), "aadhaar")
        self.assertEqual(parsed["document_number"], "XXXXXXXX1234")
        self.assertFalse(parsed["inconsistent_pages"])
        self.assertIsNone(parsed["date_of_birth"])
        self.assertEqual(parsed["year_of_birth"], 1990)

    def test_pan_labels_and_synthetic_warning(self):
        parsed = parse_lines(lines("SYNTHETIC PAN TEST", "Name: SAMPLE TEST", "Father's Name: DEMO TEST", "DOB: 15/04/1990", "AAAPT1234Z"), "pan")
        self.assertEqual(parsed["full_name"], "SAMPLE TEST")
        self.assertNotIn("father_name", parsed)
        self.assertNotIn("address", parsed)
        self.assertEqual(parsed["date_of_birth"], "1990-04-15")
        self.assertTrue(parsed["is_test_document"])

    def test_multiple_numbers_remain_ambiguous(self):
        parsed = parse_lines(lines("AADHAAR", "XXXX XXXX 1234", "XXXX XXXX 5678"), "aadhaar")
        self.assertIsNone(parsed["document_number"])
        self.assertTrue(parsed["inconsistent_pages"])

    def test_unreadable_fields_are_not_invented(self):
        parsed = parse_lines(lines("AADHAAR", "blurred image"), "aadhaar")
        self.assertIsNone(parsed["document_number"])
        self.assertIsNone(parsed["date_of_birth"])


class IndependentAnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_ocr_failure_does_not_block_face_persistence(self):
        output = io.BytesIO()
        Image.new("RGB", (20, 20), "white").save(output, "PNG")
        face = {"success": True, "face_found": True, "embedding_saved": True, "face_image_url": "local-face"}
        with patch.object(settings, "OCR_ENABLED", True), \
             patch.object(local_ocr, "recognize", AsyncMock(side_effect=RuntimeError("private provider internals"))), \
             patch.object(indian_documents, "_analyze_face", AsyncMock(return_value=SimpleNamespace(model_dump=lambda: face))) as extract, \
             patch.object(indian_documents, "analyze_forgery", AsyncMock(return_value=SimpleNamespace(model_dump=lambda: {"decision": "unknown"}))), \
             patch.object(indian_documents.storage, "upload_image", AsyncMock(return_value="local-image")):
            result = await indian_documents.analyze_document(output.getvalue(), "aadhaar")
        self.assertTrue(result["face"]["embedding_saved"])
        extract.assert_awaited_once()
        self.assertEqual(result["ocr"]["status"], "unavailable")
        self.assertIsNone(result["ocr"]["validation"]["number_format_valid"])
        self.assertNotIn("private provider", result["ocr"]["message"])

    async def test_ocr_disabled_never_invokes_recognizer(self):
        with patch.object(settings, "OCR_ENABLED", False), patch.object(local_ocr, "recognize", AsyncMock()) as ocr:
            result = await indian_documents._analyze_ocr([], "pan")
        ocr.assert_not_called()
        self.assertEqual(result["status"], "unavailable")

    async def test_wrong_type_is_a_review_finding_not_a_face_gate(self):
        with patch.object(settings, "OCR_ENABLED", True), patch.object(local_ocr, "recognize", AsyncMock(return_value=lines("Permanent Account Number", "Name: SAMPLE PERSON", "AAAPT1234Z"))):
            result = await indian_documents._analyze_ocr([], "aadhaar")
        self.assertFalse(result["validation"]["document_type_matches"])
        self.assertEqual(result["status"], "partial")
