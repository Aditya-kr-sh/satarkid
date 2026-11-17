import unittest
from unittest.mock import patch
from app.services.indian_documents import validate_fields, normalize_date, prepare_images
from fastapi import HTTPException

class IndianDocumentTests(unittest.TestCase):
    def test_year_only_does_not_invent_date(self):
        fields = {"document_type": "aadhaar", "document_number": "XXXX XXXX 1234", "year_of_birth": "1951",
                  "date_of_birth": "1951-01-01", "date_of_birth_printed": "YoB: 1951"}
        checks = validate_fields(fields, "aadhaar")
        self.assertIsNone(fields["date_of_birth"])
        self.assertEqual(fields["dob_precision"], "year")
        self.assertTrue(checks["masked"])
        self.assertIsNone(checks["checksum_valid"])
        self.assertFalse(checks["authority_verified"])

    def test_complete_printed_date_survives(self):
        fields = {"document_type": "pan", "document_number": "AAAPT1234Z", "date_of_birth": "1990-04-15",
                  "date_of_birth_printed": "15/04/1990", "year_of_birth": 1990}
        validate_fields(fields, "pan")
        self.assertEqual(fields["date_of_birth"], "1990-04-15")
        self.assertEqual(fields["dob_precision"], "day")

    def test_long_pdf_is_rejected_before_rendering(self):
        with patch("app.services.indian_documents.pdfinfo_from_bytes", return_value={"Pages": 3}), \
             patch("app.services.indian_documents.convert_from_bytes") as render:
            with self.assertRaises(HTTPException) as result:
                prepare_images(b"%PDF-test")
            self.assertEqual(result.exception.status_code, 422)
            render.assert_not_called()

    def test_pan_format_and_type_mismatch(self):
        checks = validate_fields({"document_type": "pan", "document_number": "AAAPT1234Z"}, "pan")
        self.assertTrue(checks["number_format_valid"])
        self.assertFalse(validate_fields({"document_type": "aadhaar", "document_number": "123"}, "pan")["document_type_matches"])

    def test_invalid_dates_and_files_rejected(self):
        self.assertIsNone(normalize_date("2001-02-30"))
        with self.assertRaises(HTTPException):
            prepare_images(b"not a document")

    def test_aadhaar_checksum_detects_transposition(self):
        from app.services.indian_documents import aadhaar_checksum
        self.assertTrue(aadhaar_checksum("236"))
        self.assertFalse(aadhaar_checksum("263"))
