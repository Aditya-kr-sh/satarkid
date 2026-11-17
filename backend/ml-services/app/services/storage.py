"""Normalize uploads to JPEG and save them in private local storage."""
import asyncio
import io
import os
import uuid
from pathlib import Path
from PIL import Image, ImageOps
from app.core.config import settings

def _save(image_bytes: bytes) -> str:
    if not settings.LOCAL_UPLOAD_DIR or not settings.PUBLIC_UPLOAD_URL:
        raise RuntimeError("Local storage is not configured")
    directory = Path(settings.LOCAL_UPLOAD_DIR)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = f"{uuid.uuid4()}.jpg"
    with Image.open(io.BytesIO(image_bytes)) as image:
        normalized = ImageOps.exif_transpose(image).convert("RGB")
        fd = os.open(directory / filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as target:
            normalized.save(target, format="JPEG", quality=95)
    return f"{settings.PUBLIC_UPLOAD_URL.rstrip('/')}/{filename}"

async def upload_image(image_bytes: bytes) -> str:
    return await asyncio.to_thread(_save, image_bytes)
