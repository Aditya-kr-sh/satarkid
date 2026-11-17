"""Download pinned model data only; no uploaded samples or remote Python code."""
import argparse
import hashlib
from pathlib import Path
import time
import httpx

MODEL = "buildborderless/CommunityForensics-DeepfakeDet-ViT"
REVISION = "ac6ee457bea904a373065754107451793b56db00"
SHA256 = "a42c7d740fbb345ba9a26d469b22f301d73089ce3c6da993877ed2b6965a8ba1"


def workspace_root() -> Path:
    repo = Path(__file__).resolve().parents[1]
    for candidate in (repo.parent, repo.parent.parent, repo):
        if (candidate / ".local").exists() or (candidate / ".cache").exists() or (candidate / "data").exists():
            return candidate
    return repo.parent


parser = argparse.ArgumentParser()
parser.add_argument("--cache", type=Path, default=workspace_root() / ".cache/community-forensics")
args = parser.parse_args()
args.cache.mkdir(parents=True, exist_ok=True)
with httpx.Client(follow_redirects=True, timeout=120) as client:
    for name in ["onnx/model.onnx", "config.json", "preprocessor_config.json", "README.md", "LICENSE"]:
        target = args.cache / Path(name).name
        if name == "onnx/model.onnx" and target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
            continue
        temporary = target.with_suffix(target.suffix + ".download")
        url = f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
        for attempt in range(5):
            try:
                offset = temporary.stat().st_size if temporary.exists() else 0
                headers = {"Range": f"bytes={offset}-"} if offset else {}
                with client.stream("GET", url, headers=headers) as response:
                    response.raise_for_status()
                    append = offset > 0 and response.status_code == 206
                    with temporary.open("ab" if append else "wb") as output:
                        for chunk in response.iter_bytes():
                            output.write(chunk)
                break
            except httpx.HTTPError:
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)
        if name == "onnx/model.onnx" and hashlib.sha256(temporary.read_bytes()).hexdigest() != SHA256:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("Model hash mismatch; downloaded file was not activated.")
        temporary.replace(target)
print("Pinned Community Forensics model is ready. Set AI_MODEL_PATH to the cached model.onnx.")
