"""Model prediction routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import IoTDevice
from security import verify_service_token
from services.dashboard_forecast_service import DashboardForecastService
from services.meteostat_pipeline_service import MeteostatPipelineService
from services.prediction_service import PredictionService
from services.prediction_store_service import save_predictions
from services.tft_training_service import TFTTrainingService

router = APIRouter(prefix="/api/model", tags=["model"], dependencies=[Depends(verify_service_token)])

IOT_TYPES = {"temperature", "humidity", "soil_moisture", "light_intensity", "pressure"}


@router.get("/health")
def health():
    return {"status": "healthy", "service": "model_backend"}


@router.get("/metrics/predict")
def predict_metrics(
    source: str = Query(...),
    metric_type: str = Query(...),
    horizon_minutes: int = Query(30, ge=5, le=180),
    step_minutes: int = Query(5, ge=1, le=30),
    history_days: int = Query(14, ge=1, le=60),
    db: Session = Depends(get_db),
):
    if metric_type not in IOT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid metric_type. Must be one of {IOT_TYPES}")

    result = PredictionService.predict(
        db=db,
        source=source,
        metric_type=metric_type,
        horizon_minutes=horizon_minutes,
        step_minutes=step_minutes,
        history_days=history_days,
    )
    response = {
        "source": result.source,
        "metric_type": result.metric_type,
        "unit": result.unit,
        "method": result.method,
        "model_status": result.model_status,
        "data_source": result.data_source,
        "training_points": result.training_points,
        "confidence_score": result.confidence_score,
        "quality_label": result.quality_label,
        "forecast_min": result.forecast_min,
        "forecast_max": result.forecast_max,
        "forecast_delta": result.forecast_delta,
        "next_predicted_value": result.next_predicted_value,
        "debug_metadata": result.debug_metadata,
        "error": result.error,
        "generated_at": result.generated_at.isoformat(),
        "horizon_minutes": horizon_minutes,
        "step_minutes": step_minutes,
        "timezone": "Asia/Ho_Chi_Minh",
        "predictions": result.predictions,
    }
    try:
        save_summary = save_predictions(
            db=db,
            prediction_kind="short_horizon",
            source=result.source,
            metric_type=result.metric_type,
            method=result.method,
            model_status=result.model_status,
            predictions=result.predictions,
            generated_at=result.generated_at.isoformat(),
            confidence_score=result.confidence_score,
            quality_label=result.quality_label,
            horizon_minutes=horizon_minutes,
            step_minutes=step_minutes,
        )
        response["storage"] = save_summary.__dict__
    except Exception as exc:
        db.rollback()
        response["storage"] = {"enabled": False, "error": f"{type(exc).__name__}: {exc}"}
    return response


@router.post("/metrics/train-xgboost")
def train_xgboost(
    source: str = Query(...),
    metric_type: str = Query(...),
    history_days: int = Query(60, ge=1, le=365),
    step_minutes: int = Query(5, ge=1, le=30),
    db: Session = Depends(get_db),
):
    if metric_type not in IOT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid metric_type. Must be one of {IOT_TYPES}")
    return PredictionService.train_offline_model(
        db=db,
        source=source,
        metric_type=metric_type,
        history_days=history_days,
        step_minutes=step_minutes,
    )


@router.get("/dashboard/forecast")
def dashboard_forecast(
    device_id: int = Query(...),
    horizon_days: int = Query(3, ge=1, le=14),
    history_days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
):
    device = db.query(IoTDevice).filter(IoTDevice.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="IoT device not found")
    if device.device_type not in IOT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported device_type: {device.device_type}")

    forecast = DashboardForecastService.forecast(
        db=db,
        source=device.source,
        metric_type=device.device_type,
        horizon_days=horizon_days,
        history_days=history_days,
        device=device,
    )
    forecast["device_id"] = device.id
    forecast["device_name"] = device.name
    forecast["environment_type"] = device.environment_type
    forecast["location_query"] = device.location_query
    forecast["latitude"] = device.latitude
    forecast["longitude"] = device.longitude
    try:
        save_summary = save_predictions(
            db=db,
            prediction_kind="dashboard_forecast",
            source=device.source,
            device_id=device.id,
            metric_type=device.device_type,
            method=str(forecast.get("method", "unknown")),
            model_status=str(forecast.get("model_status", "unknown")),
            predictions=list(forecast.get("predictions", [])),
            generated_at=str(forecast.get("generated_at", "")),
            confidence_score=forecast.get("confidence_score"),
            quality_label=forecast.get("quality_label"),
            horizon_days=horizon_days,
        )
        forecast["storage"] = save_summary.__dict__
    except Exception as exc:
        db.rollback()
        forecast["storage"] = {"enabled": False, "error": f"{type(exc).__name__}: {exc}"}
    return forecast


@router.get("/tft-training/devices/{device_id}/status")
def tft_training_status(
    device_id: int,
    target_column: str | None = Query(None),
    db: Session = Depends(get_db),
):
    device = db.query(IoTDevice).filter(IoTDevice.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="IoT device not found")
    try:
        dataset = TFTTrainingService.get_dataset_summary(db, device, target_column=target_column)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "device_id": device.id,
        "source": device.source,
        "device_type": device.device_type,
        "dataset": dataset.__dict__,
    }


@router.post("/tft-training/devices/{device_id}/train")
def tft_train_device(
    device_id: int,
    target_column: str | None = Query(None),
    horizon_hours: int = Query(72, ge=24, le=24 * 14),
    encoder_hours: int = Query(168, ge=12, le=24 * 30),
    max_epochs: int = Query(40, ge=1, le=200),
    batch_size: int = Query(32, ge=1, le=512),
    learning_rate: float = Query(0.01, gt=0.0, le=1.0),
    hidden_size: int = Query(32, ge=4, le=512),
    attention_head_size: int = Query(4, ge=1, le=16),
    min_rows: int = Query(96, ge=24, le=20000),
    early_stopping_patience: int = Query(8, ge=1, le=50),
    db: Session = Depends(get_db),
):
    device = db.query(IoTDevice).filter(IoTDevice.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="IoT device not found")

    try:
        result = TFTTrainingService.train_weather_tft(
            db=db,
            device=device,
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "device_id": result.device_id,
        "source": result.source,
        "target_column": result.target_column,
        "rows": result.rows,
        "checkpoint_path": result.checkpoint_path,
        "metadata_path": result.metadata_path,
        "encoder_length": result.encoder_length,
        "prediction_length": result.prediction_length,
        "max_epochs": result.max_epochs,
        "created_at": result.created_at,
        "validation_loss": result.validation_loss,
        "best_epoch": result.best_epoch,
    }


@router.post("/weather-pipeline/devices/{device_id}/sync")
def sync_weather_history(
    device_id: int,
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    db: Session = Depends(get_db),
):
    device = db.query(IoTDevice).filter(IoTDevice.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="IoT device not found")
    try:
        result = MeteostatPipelineService.sync_device_history(
            db=db,
            device=device,
            start_date=start_date,
            end_date=end_date,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "device_id": result.device_id,
        "source": result.source,
        "provider": result.provider,
        "latitude": result.latitude,
        "longitude": result.longitude,
        "timezone_name": result.timezone_name,
        "start_date": result.start_date.isoformat(),
        "end_date": result.end_date.isoformat(),
        "fetched_rows": result.fetched_rows,
        "upserted_rows": result.upserted_rows,
        "cached_rows": result.cached_rows,
    }
