"""Configuration for model backend."""

import os
from urllib.parse import quote_plus


def _load_dotenv():
    here_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(here_dir)
    candidates = [
        os.path.join(root_dir, ".env"),
        os.path.join(here_dir, ".env"),
    ]

    env_path = next((p for p in candidates if os.path.exists(p)), None)
    if not env_path:
        return

    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


_load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
SAVE_PREDICTIONS = os.getenv("SAVE_PREDICTIONS", "true").strip().lower() in {"1", "true", "yes", "on"}


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url

    db_host = os.getenv("DB_HOST")
    db_database = os.getenv("DB_DATABASE")
    db_username = os.getenv("DB_USERNAME")
    db_password = os.getenv("DB_PASSWORD")
    if not all([db_host, db_database, db_username, db_password]):
        raise RuntimeError(
            "Missing PostgreSQL settings. Required: DATABASE_URL or DB_HOST, DB_DATABASE, DB_USERNAME, DB_PASSWORD."
        )

    db_port = os.getenv("DB_PORT", "5432")
    username_enc = quote_plus(db_username)
    password_enc = quote_plus(db_password)
    return f"postgresql+psycopg2://{username_enc}:{password_enc}@{db_host}:{db_port}/{db_database}"
