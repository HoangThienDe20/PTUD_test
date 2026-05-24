"""Application configuration"""

import os
from datetime import timedelta
from urllib.parse import quote_plus


def _load_dotenv():
    here_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(here_dir)
    candidates = [
        os.path.join(here_dir, ".env"),   # app/.env (preferred for local app backend)
        os.path.join(root_dir, ".env"),   # project root .env (fallback)
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
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            os.environ.setdefault(key, value)


_load_dotenv()

# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Remote Metrics Central API configuration
METRICS_CENTRAL_BASE_URL = os.getenv("METRICS_CENTRAL_BASE_URL", "http://localhost:9000")
METRICS_CENTRAL_TOKEN = os.getenv("METRICS_CENTRAL_TOKEN", "demo-secret-token")
METRICS_CENTRAL_ADMIN_TOKEN = os.getenv("METRICS_CENTRAL_ADMIN_TOKEN", "admin-demo-token")

# Notification configuration
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# SMTP configuration for email alerts. Values are read-only from environment.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = os.getenv("SMTP_PORT", "")
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ALERT_FROM_EMAIL = os.getenv("ALERT_FROM_EMAIL", "")

# AI explanation configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

# Model backend integration
MODEL_BACKEND_URL = os.getenv("MODEL_BACKEND_URL", "http://127.0.0.1:8200").rstrip("/")
MODEL_BACKEND_TOKEN = os.getenv("MODEL_BACKEND_TOKEN", "")
MODEL_BACKEND_TIMEOUT = float(os.getenv("MODEL_BACKEND_TIMEOUT", "15"))
IOT_BACKEND_URL = os.getenv("IOT_BACKEND_URL", "http://127.0.0.1:8100").rstrip("/")

# MQTT ingest. Defaults match the documented live IoT stream command so the
# main backend can receive fake and ESP32 metrics without a fourth terminal.
MQTT_HOST = os.getenv("MQTT_HOST", "20.214.247.102")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "sensor_user")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "123456")
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "realtime-app-backend")
MQTT_SENSOR_TOPIC = os.getenv("MQTT_SENSOR_TOPIC", os.getenv("MQTT_TOPIC", "sensors/+/data"))


def get_cors_origins() -> list[str]:
    """Return CORS origins from env. Supports comma-separated values."""
    raw = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    dev_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    return list(dict.fromkeys(origins + dev_origins))


def get_database_url() -> str:
    """Build PostgreSQL database URL from environment variables."""
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
