#!/usr/bin/env bash
# Start a SatarkID service using this checkout's ignored local configuration.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unset DATABASE_URL LOCAL_UPLOAD_DIR PUBLIC_UPLOAD_URL DATABASE_CA_FILE PGCONNECT_TIMEOUT
export NEXT_TELEMETRY_DISABLED=1
SERVICE="${1:-}"
if [ "$#" -gt 0 ]; then shift; fi
case "$SERVICE" in
  ml)
    cd "$REPO_DIR/backend/ml-services"
    exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 "$@"
    ;;
  backend)
    cd "$REPO_DIR/backend/express-app"
    exec node server.js "$@"
    ;;
  frontend)
    export BACKEND_URL=http://127.0.0.1:5001
    cd "$REPO_DIR/frontend"
    exec npm run dev -- --hostname 127.0.0.1 --port 3000 "$@"
    ;;
  *)
    printf 'Usage: bash scripts/run-local.sh {ml|backend|frontend}\n' >&2
    exit 2
    ;;
esac
