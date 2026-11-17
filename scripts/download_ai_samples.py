"""Restore public AI-generated fixtures without overwriting unrelated samples."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen


def workspace_root() -> Path:
    repo = Path(__file__).resolve().parents[1]
    for candidate in (repo.parent, repo.parent.parent, repo):
        if (candidate / ".local").exists() or (candidate / ".cache").exists() or (candidate / "data").exists():
            return candidate
    return repo.parent


parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=workspace_root() / "data/india-samples")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
manifest = json.loads(Path(__file__).with_name("ai_samples.json").read_text())
for item in manifest:
    target = args.output / item["filename"]
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError(f"Existing file differs; left untouched: {target}")
        continue
    with urlopen(item["source"], timeout=60) as response:
        payload = response.read()
    if hashlib.sha256(payload).hexdigest() != item["sha256"]:
        raise RuntimeError(f"Downloaded hash mismatch: {item['filename']}")
    with target.open("xb") as output:
        output.write(payload)
print(f"{len(manifest)} verified AI-generated samples ready in {args.output}")
