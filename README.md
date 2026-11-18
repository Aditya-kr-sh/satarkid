# SatarkID

Local Aadhaar/PAN analysis for a B.Tech digital-arrest prevention project. Upload a document, review its core fields, upload the portrait to score, then complete a live camera check to open the analysis directly.

- PaddleOCR extracts printed English names, identifiers, birth dates/years, gender and the address printed below the Address/पता label on an Aadhaar back page.
- InsightFace extracts document faces independently of OCR; portrait similarity uses a **50% threshold**. A one-time random head-turn challenge checks for centered→turn→center movement in a short live camera clip before accepting the captured portrait.
- Aadhaar checksum/PAN format checks and image heuristics provide review findings.
- Community Forensics scores AI-generation signals for each document page and the separately uploaded portrait, locally through ONNX Runtime. Document pages use up to five overlapping views and report the highest signal; this improves page coverage but can increase false positives. Scores are experimental, not calibrated probabilities, and not proof of authenticity or validated ID-document detection. An unavailable detector returns an unknown score.
- The analysis dashboard highlights OCR text boxes, compares submitted and OCR fields, and reports available face metadata. Its rule-based risk state prioritizes manual review when checks are missing; it does not combine experimental scores into a weighted fraud probability. Image checks display the existing experimental heuristics. A browser-generated PDF summarizes the available results and limitations.

Government issuance is not verified. The active head-turn check is a prototype movement signal, not certified anti-spoof protection or proof of identity; it can be vulnerable to replay and presentation attacks. The short liveness video is analyzed locally and is not saved. The uploaded portrait is retained to display its AI-image result; a separate captured camera portrait is retained for face comparison. This prototype does not independently detect scam calls. It runs on loopback without production authentication. Private documents, models, credentials and uploads stay outside Git.

## Run

Requirements: Python 3.12, uv, Node/npm, PostgreSQL with pgvector, and Poppler. This workspace already has the local PostgreSQL cluster, password and TLS certificate under `.local`; the configuration script reuses them.

```bash
# From the workspace, start PostgreSQL if stopped:
bash setup/run.sh local-db

# From this repository:
python3 scripts/configure_local.py
(cd backend/ml-services && uv sync --frozen --no-dev)
(cd backend/express-app && npm ci)
(cd frontend && npm ci)
backend/ml-services/.venv/bin/python scripts/download_ai_model.py

# Separate terminals:
bash scripts/run-local.sh ml
bash scripts/run-local.sh backend
bash scripts/run-local.sh frontend
```

Open [SatarkID](http://127.0.0.1:3000/onboarding). ML readiness: [port 8000](http://127.0.0.1:8000/api/v1/ready). Model weights download on first setup; cached inference needs no cloud API key.

Configuration is in the ignored `.env`: `DATABASE_URL`, `DATABASE_CA_FILE`, `LOCAL_UPLOAD_DIR`, `PUBLIC_UPLOAD_URL`, `PADDLE_CACHE_DIR`, `AI_MODEL_PATH`. Set `OCR_ENABLED=false` or `AI_DETECTION_ENABLED=false` to test graceful unavailability. Database migration history is retained for existing installations; saved submissions are preserved.

## Samples

Samples live in the workspace's `data/india-samples` folder. Choose `aadhaar-photo-*.jpg` or `aadhaar-pdf-*.pdf` for Aadhaar and `pan-synthetic.png` for PAN. The synthetic PAN has no face. The sample runner checks document and review steps by default; full portrait submission requires local WebM/MP4/MOV clips for both head-turn directions.

For an AI-generation test, use **`ai-generated-portrait.png` as the uploaded portrait** with an Aadhaar sample and the two local liveness clips. The sample runner also uses it as the simulated camera portrait, so a face mismatch is expected. The four other `ai-generated-*.png` files test objects/scenes rather than identity documents; unreadable identity fields can remain blank. Sources and hashes are in `scripts/ai_samples.json`.

```bash
# Restore the five public generated fixtures if needed:
python3 scripts/download_ai_samples.py

# Regression checks:
(cd backend/ml-services && .venv/bin/python -m unittest discover -s tests -v)
(cd backend/express-app && npm test)
(cd frontend && npm run lint && npm run build)
backend/ml-services/.venv/bin/python scripts/validate_samples.py \
  --samples ../../data/india-samples --output ../../logs/satarkid-validation.json
```

The sample runner creates local submissions and checks stored analysis and image URLs. To test portrait/liveness, provide local clips that show the same test participant turning each way, for example `--liveness-video-left ./liveness-left.webm --liveness-video-right ./liveness-right.webm`; it requests a fresh challenge and submits the matching clip. Add `--portrait ai-generated-portrait.png` to test the generated portrait. `--expect-no-ocr` and `--expect-no-ai` verify disabled-model behavior after restarting ML with the corresponding environment setting.

See [third-party notices](THIRD_PARTY_NOTICES.md) for model provenance and licensing. Development history stays on `main`.
