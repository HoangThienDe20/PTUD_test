"""Proxy routes from CK_full app to model_backend service."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.routes_auth import get_current_user
from app.database import get_db
from app.models import IoTDevice, User
from app.services.model_client import ModelClientError, model_client


router = APIRouter(prefix="/api/model", tags=["model-proxy"])
dashboard_router = APIRouter(prefix="/api/dashboard", tags=["model-proxy"])
IOT_TYPES = {"temperature", "humidity", "soil_moisture", "light_intensity", "pressure"}


def _raise_model_error(exc: ModelClientError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail={"message": exc.detail, "upstream_status": exc.upstream_status},
    ) from exc


def _is_admin(user: User) -> bool:
    return (user.role or "").strip().lower() == "admin"


def _device_for_user_or_404(db: Session, user: User, device_id: int) -> IoTDevice:
    query = db.query(IoTDevice).filter(IoTDevice.id == device_id)
    if not _is_admin(user):
        query = query.filter(IoTDevice.user_id == user.id)
    device = query.first()
    if not device:
        raise HTTPException(status_code=404, detail="IoT device not found")
    return device


def _source_allowed(db: Session, user: User, source: str) -> bool:
    query = db.query(IoTDevice).filter(IoTDevice.source == source)
    if not _is_admin(user):
        query = query.filter(IoTDevice.user_id == user.id)
    return query.first() is not None


@router.get("/health")
def model_health(
    current_user: User = Depends(get_current_user),
):
    try:
        return model_client.health()
    except ModelClientError as exc:
        _raise_model_error(exc)


@router.get("/metrics/predict")
def proxy_predict_metrics(
    source: str = Query(...),
    metric_type: str = Query(...),
    horizon_minutes: int = Query(30, ge=5, le=180),
    step_minutes: int = Query(5, ge=1, le=30),
    history_days: int = Query(14, ge=1, le=60),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if metric_type not in IOT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid metric_type. Must be one of {IOT_TYPES}")
    if not _source_allowed(db, current_user, source):
        raise HTTPException(status_code=403, detail="You do not have access to this source")
    try:
        return model_client.predict_metrics(
            source=source,
            metric_type=metric_type,
            horizon_minutes=horizon_minutes,
            step_minutes=step_minutes,
            history_days=history_days,
        )
    except ModelClientError as exc:
        _raise_model_error(exc)


@router.get("/dashboard/forecast")
def proxy_dashboard_forecast(
    device_id: int = Query(...),
    horizon_days: int = Query(3, ge=1, le=14),
    history_days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _device_for_user_or_404(db, current_user, device_id)
    try:
        return model_client.dashboard_forecast(
            device_id=device_id,
            horizon_days=horizon_days,
            history_days=history_days,
        )
    except ModelClientError as exc:
        _raise_model_error(exc)


@dashboard_router.get("/forecast")
def proxy_dashboard_forecast_alias(
    device_id: int = Query(...),
    horizon_days: int = Query(3, ge=1, le=14),
    history_days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return proxy_dashboard_forecast(
        device_id=device_id,
        horizon_days=horizon_days,
        history_days=history_days,
        current_user=current_user,
        db=db,
    )


@router.post("/metrics/train-xgboost")
def proxy_train_xgboost(
    source: str = Query(...),
    metric_type: str = Query(...),
    history_days: int = Query(60, ge=1, le=365),
    step_minutes: int = Query(5, ge=1, le=30),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin role required")
    if metric_type not in IOT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid metric_type. Must be one of {IOT_TYPES}")
    if not _source_allowed(db, current_user, source):
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        return model_client.train_xgboost(
            source=source,
            metric_type=metric_type,
            history_days=history_days,
            step_minutes=step_minutes,
        )
    except ModelClientError as exc:
        _raise_model_error(exc)


@router.get("/tft-training/devices/{device_id}/status")
def proxy_tft_status(
    device_id: int,
    target_column: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _device_for_user_or_404(db, current_user, device_id)
    try:
        return model_client.tft_training_status(device_id=device_id, target_column=target_column)
    except ModelClientError as exc:
        _raise_model_error(exc)


@router.post("/tft-training/devices/{device_id}/train")
def proxy_tft_train(
    device_id: int,
    target_column: Optional[str] = Query(None),
    horizon_hours: int = Query(72, ge=24, le=24 * 14),
    encoder_hours: int = Query(168, ge=12, le=24 * 30),
    max_epochs: int = Query(40, ge=1, le=200),
    batch_size: int = Query(32, ge=1, le=512),
    learning_rate: float = Query(0.01, gt=0.0, le=1.0),
    hidden_size: int = Query(32, ge=4, le=512),
    attention_head_size: int = Query(4, ge=1, le=16),
    min_rows: int = Query(96, ge=24, le=20000),
    early_stopping_patience: int = Query(8, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _device_for_user_or_404(db, current_user, device_id)
    try:
        return model_client.tft_train(
            device_id=device_id,
            target_column=target_column,
            horizon_hours=horizon_hours,
            encoder_hours=encoder_hours,
            max_epochs=max_epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            hidden_size=hidden_size,
            attention_head_size=attention_head_size,
            min_rows=min_rows,
            early_stopping_patience=early_stopping_patience,
        )
    except ModelClientError as exc:
        _raise_model_error(exc)


@router.post("/weather-pipeline/devices/{device_id}/sync")
def proxy_weather_pipeline_sync(
    device_id: int,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _device_for_user_or_404(db, current_user, device_id)
    try:
        return model_client.weather_pipeline_sync(
            device_id=device_id,
            start_date=start_date,
            end_date=end_date,
        )
    except ModelClientError as exc:
        _raise_model_error(exc)
