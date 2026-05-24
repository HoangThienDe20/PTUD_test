from fastapi import Header, HTTPException

from config import SECRET_KEY


def verify_service_token(x_model_token: str | None = Header(default=None)):
    if not SECRET_KEY:
        return
    if x_model_token != SECRET_KEY:
        raise HTTPException(status_code=401, detail="Invalid model backend token")
