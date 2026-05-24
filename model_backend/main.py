from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes_model import router as model_router
from config import CORS_ORIGINS

app = FastAPI(
    title="Model Backend Service",
    description="Standalone prediction backend (XGBoost + TFT)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(model_router)


@app.get("/")
def root():
    return {
        "service": "model-backend",
        "docs": "/docs",
        "health": "/api/model/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8200, reload=True)

