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


def page_lines(page, *texts):
    return [{"text": text, "confidence": 0.99, "page": page, "box": [0, i * 30, 400, i * 30 + 20]} for i, text in enumerate(texts)]


class ParserTests(unittest.TestCase):
    def test_aadhaar_back_page_address_is_read_once_in_english(self):
        address = "C/o SAMPLE FATHER, Plot No-679, Near Savodaya City, Adampur, Patna, Bihar - 801105"
        parsed = parse_lines([
            *page_lines(0, "AADHAAR", "SAMPLE PERSON", "DOB: 01/01/1990", "MALE", "1234 5678 9012"),
            *page_lines(1, "पता:", "नाम / Name:", "सी/ओ सैंपल, प्लॉट नं-679, पटना, बिहार - 801105",
                         "Address:", address, "Bihar - 801105"),
        ], "aadhaar")
        self.assertEqual(parsed["address"], address)
        self.assertEqual(parsed["full_name"], "SAMPLE PERSON")

    def test_missing_address_label_does_not_invent_an_address(self):
        parsed = parse_lines(lines("INCOME TAX DEPARTMENT", "SAMPLE PERSON", "ABCDE1234F", "01/01/1990"), "pan")
        self.assertIsNone(parsed["address"])

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
        # PAN cards print no address; the key stays empty instead of guessing one.
        self.assertIsNone(parsed["address"])
        self.assertEqual(parsed["date_of_birth"], "1990-04-15")
        self.assertTrue(parsed["is_test_document"])

    def test_bilingual_pan_name_label_uses_the_nearby_value(self):
        parsed = parse_lines(lines("FEHTST", "INCOME TAX DEPARTMENT", "Permanent Account Number Card",
                                   "BFAPL9762A", "नाम / Name", "JOHN SAMPLE",
                                   "पिता का नाम / Father's Name", "PARENT SAMPLE", "DOB: 10/09/2001"), "pan")
        self.assertEqual(parsed["full_name"], "JOHN SAMPLE")

    def test_pan_header_fragment_is_not_guessed_as_a_name(self):
        parsed = parse_lines(lines("FEHTST", "INCOME TAX DEPARTMENT", "Permanent Account Number Card",
                                   "BFAPL9762A", "DOB: 10/09/2001"), "pan")
        self.assertIsNone(parsed["full_name"])

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
