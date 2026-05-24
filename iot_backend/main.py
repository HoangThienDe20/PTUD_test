"""IoT backend entrypoint (standalone service + ESP32 control)."""

import asyncio
import os
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from iot_backend.config import get_cors_origins
from iot_backend.database import init_db, engine
from iot_backend.api import (
    routes_auth,
    routes_iot_devices,
    routes_metrics,
    routes_alerts,
    routes_websocket,
    routes_admin_iot,
    routes_devices,
)
from iot_backend.api.routes_websocket import save_iot_metric_to_db
from iot_backend import mqtt_service
from iot_backend.state import runtime_state
from iot_backend.websocket_manager import manager


MAIN_LOOP = None
VIETNAM_TZ = timezone(timedelta(hours=7))

app = FastAPI(
    title="IoT Backend Service",
    description="Standalone IoT service: metrics, alerts, realtime websocket, and IoT device management",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(routes_metrics.router)
app.include_router(routes_alerts.router)
app.include_router(routes_auth.router)
app.include_router(routes_admin_iot.router)
app.include_router(routes_iot_devices.router)
app.include_router(routes_devices.router)
app.include_router(routes_websocket.router, prefix="/api", tags=["websocket"])


async def _init_db_with_retry():
    attempts = max(1, int(os.getenv("DB_INIT_RETRIES", "5")))
    delay_seconds = max(0.5, float(os.getenv("DB_INIT_RETRY_DELAY", "2")))
    for attempt in range(1, attempts + 1):
        try:
            init_db()
            return
        except Exception as exc:
            if attempt >= attempts:
                print(f"[ERROR] [DB] Startup init failed after {attempts} attempts: {type(exc).__name__}: {exc}")
                raise
            print(
                f"[WARN] [DB] Startup init failed "
                f"(attempt {attempt}/{attempts}): {type(exc).__name__}: {exc}. Retrying..."
            )
            await asyncio.sleep(delay_seconds)


@app.get("/")
async def root():
    return {
        "service": "iot-backend",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.on_event("startup")
async def startup_event():
    """Initialize MQTT ingest for new ESP32 flow."""
    global MAIN_LOOP
    await _init_db_with_retry()
    MAIN_LOOP = asyncio.get_running_loop()
    try:
        mqtt_service.start_mqtt(on_reading=handle_mqtt_reading, on_device_state=None)
        print("[STARTUP] MQTT service started")
    except Exception as exc:
        print(f"[STARTUP] Failed to start MQTT service: {exc}")


@app.on_event("shutdown")
async def shutdown_event():
    mqtt_service.stop_mqtt()
    engine.dispose()


def handle_mqtt_reading(reading: dict):
    """Handle both legacy metric payload and new temp/humidity payload."""
    sensor_id = reading.get("source") or reading.get("sensor_id") or "esp32_devkit_v1"
    location = reading.get("location")
    now_iso = datetime.now(VIETNAM_TZ).isoformat()

    metric_type = reading.get("metric_type")
    metric_value = reading.get("value")
    temp = reading.get("temperature")
    humidity = reading.get("humidity")

    try:
        if metric_type is not None and metric_value is not None:
            save_iot_metric_to_db(
                metric_type=str(metric_type),
                source=str(sensor_id),
                location=location,
                timestamp=reading.get("timestamp") or now_iso,
                value=float(metric_value),
                unit=str(reading.get("unit") or ""),
                save_flag=bool(reading.get("saved", True)),
            )
        else:
            if temp is not None:
                save_iot_metric_to_db(
                    metric_type="temperature",
                    source=str(sensor_id),
                    location=location,
                    timestamp=reading.get("timestamp") or now_iso,
                    value=float(temp),
                    unit="degC",
                    save_flag=True,
                )
            if humidity is not None:
                save_iot_metric_to_db(
                    metric_type="humidity",
                    source=str(sensor_id),
                    location=location,
                    timestamp=reading.get("timestamp") or now_iso,
                    value=float(humidity),
                    unit="%",
                    save_flag=True,
                )
            if temp is not None and humidity is not None:
                runtime_state.apply_auto(float(temp), float(humidity))
    except Exception as exc:
        print(f"[SENSOR] Failed to save metrics/alerts: {exc}")

    response = runtime_state.response()
    try:
        if MAIN_LOOP is not None:
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({"type": "sensor_update", "sensor": reading, "device_state": response}),
                MAIN_LOOP,
            )
    except Exception as exc:
        print(f"[WS] Broadcast skipped: {exc}")
    return response


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("iot_backend.main:app", host="0.0.0.0", port=8100, reload=True)
