"""Configure this checkout against its local PostgreSQL cluster when it exists."""
from pathlib import Path
import os
import subprocess
from urllib.parse import quote

repo = Path(__file__).resolve().parents[1]


def workspace_root() -> Path:
    for candidate in (repo.parent, repo.parent.parent, repo):
        if (candidate / ".local").exists() or (candidate / ".cache").exists() or (candidate / "data").exists():
            return candidate
    return repo.parent

root = workspace_root()
repo_env = repo / ".env"
frontend_env = repo / "frontend" / ".env.local"


def update_env(path: Path, values):
    lines = path.read_text().splitlines() if path.exists() else []
    lines = [line for line in lines if line.partition("=")[0] not in values]
    lines.extend(f"{key}={value}" for key, value in values.items())
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)


password_path = root / ".local" / "postgres-password"
local_db_dir = root / ".local"
if password_path.exists():
    password = password_path.read_text().strip()
    env = {**os.environ, "PGPASSWORD": password}
    psql = ["/opt/homebrew/bin/psql", "-h", "127.0.0.1", "-p", "55432", "-U", "digital_fraud", "-v", "ON_ERROR_STOP=1"]

    def sql(database, query):
        return subprocess.check_output([*psql, "-d", database, "-Atc", query], env=env, text=True).strip()

    if not sql("postgres", "SELECT 1 FROM pg_database WHERE datname = 'kyc'"):
        sql("postgres", "CREATE DATABASE kyc")
    sql("kyc", "CREATE TABLE IF NOT EXISTS local_setup_migrations (name text PRIMARY KEY)")
    migrations = sorted((repo / "backend" / "ml-services" / "app" / "database" / "migrations").glob("*.sql"))
    for migration in migrations:
        name = str(migration.relative_to(repo))
        if not sql("kyc", f"SELECT 1 FROM local_setup_migrations WHERE name = '{name}'"):
            subprocess.run([*psql, "-d", "kyc", "-1", "-f", str(migration), "-c", f"INSERT INTO local_setup_migrations VALUES ('{name}')"], env=env, check=True, stdout=subprocess.DEVNULL)
    sql("kyc", "DROP INDEX IF EXISTS face_embeddings_vector_idx")

    uploads = local_db_dir / "kyc-uploads"
    uploads.mkdir(mode=0o700, parents=True, exist_ok=True)

    update_env(repo_env, {
        "DATABASE_URL": f"postgresql://digital_fraud:{quote(password, safe='')}@localhost:55432/kyc",
        "DATABASE_CA_FILE": str(local_db_dir / "postgres" / "server.crt"),
        "LOCAL_UPLOAD_DIR": str(uploads),
        "PUBLIC_UPLOAD_URL": "http://127.0.0.1:5001/uploads",
        "BACKEND_PORT": "5001",
        "BACKEND_HOST": "127.0.0.1",
        "ML_SERVICE_URL": "http://127.0.0.1:8000",
        "OCR_ENABLED": "true",
        "PADDLE_CACHE_DIR": str(root / ".cache" / "paddlex"),
        "AI_DETECTION_ENABLED": "true",
        "AI_MODEL_PATH": str(root / ".cache" / "community-forensics" / "model.onnx"),
    })
else:
    uploads = local_db_dir / "kyc-uploads"
    uploads.mkdir(mode=0o700, parents=True, exist_ok=True)
    update_env(repo_env, {
        "DATABASE_URL": "",
        "DATABASE_CA_FILE": "",
        "LOCAL_UPLOAD_DIR": str(uploads),
        "PUBLIC_UPLOAD_URL": "http://127.0.0.1:5001/uploads",
        "BACKEND_PORT": "5001",
        "BACKEND_HOST": "127.0.0.1",
        "ML_SERVICE_URL": "http://127.0.0.1:8000",
        "OCR_ENABLED": "true",
        "PADDLE_CACHE_DIR": str(root / ".cache" / "paddlex"),
        "AI_DETECTION_ENABLED": "true",
        "AI_MODEL_PATH": str(root / ".cache" / "community-forensics" / "model.onnx"),
    })
    print("Local PostgreSQL cluster not found; wrote a degraded .env so the services still start without persistent storage.")

update_env(frontend_env, {"BACKEND_URL": "http://127.0.0.1:5001"})
print("Local SatarkID configuration updated. Existing API keys preserved.")
