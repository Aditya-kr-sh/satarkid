from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO = Path(__file__).resolve().parents[4]

def _workspace_root() -> Path:
    candidates = [REPO.parent, REPO.parent.parent, REPO]
    for candidate in candidates:
        if (candidate / ".local").exists() or (candidate / ".cache").exists() or (candidate / "data").exists():
            return candidate
    return REPO.parent

WORKSPACE = _workspace_root()


class Settings(BaseSettings):
    OCR_ENABLED: bool = True
    AI_DETECTION_ENABLED: bool = True
    AI_MODEL_PATH: str = str(WORKSPACE / ".cache/community-forensics/model.onnx")
    PADDLE_CACHE_DIR: str = str(WORKSPACE / ".cache/paddlex")
    MAX_UPLOAD_MB: int = 10
    DATABASE_URL: str = ""
    DATABASE_CA_FILE: str = ""
    LOCAL_UPLOAD_DIR: str = ""
    PUBLIC_UPLOAD_URL: str = ""
    DUPLICATE_SIMILARITY_THRESHOLD: float = 0.6
    FACE_MODEL_NAME: str = "buffalo_l"
    model_config = SettingsConfigDict(env_file=REPO / ".env", env_file_encoding="utf-8", case_sensitive=True, extra="ignore")


settings = Settings()
