"""Verify cached PaddleOCR loads and infers while Python network calls are blocked."""
import asyncio
from pathlib import Path
import socket
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend/ml-services"))

def blocked(*args, **kwargs):
    raise AssertionError("Network access attempted during offline OCR check")

socket.socket.connect = blocked
socket.socket.connect_ex = blocked
socket.getaddrinfo = blocked

from app.services import local_ocr
from app.services.indian_documents import prepare_images

local_ocr.load_models()
assert local_ocr.is_ready(), "Cache the official models before the offline check."
lines = asyncio.run(local_ocr.recognize(prepare_images(Path(sys.argv[1]).read_bytes())))
assert lines
print(f"PASS: cached PaddleOCR loaded and recognized {len(lines)} lines with Python network access blocked.")
