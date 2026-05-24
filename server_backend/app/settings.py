import os
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()

METRICS_TOKEN = os.getenv("METRICS_TOKEN", "demo-secret-token")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "admin-demo-token")


def get_database_url() -> str:
    direct = os.getenv("DATABASE_URL")
    if direct:
        return direct

    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "metrics_central")
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "postgres")
    return f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{db}"
