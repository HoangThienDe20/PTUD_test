"""Dashboard multi-day forecast service.

The dashboard forecast path prioritizes saved Temporal Fusion Transformer (TFT)
checkpoints. When a checkpoint or weather cache is not available yet, the API
still returns a TFT-compatible seasonal baseline so the user dashboard never
loses its forecast line.
"""

from __future__ import annotations

import math
import time
from copy import deepcopy
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models import IoTDevice, Metric
from services.tft_inference_service import TFTInferenceService
from services.weather_service import get_hourly_weather_forecast


VN_TZ = timezone(timedelta(hours=7))
FORECAST_CACHE_TTL_SECONDS = 180
_FORECAST_CACHE: dict[tuple, tuple[float, dict]] = {}


def _forecast_cache_key(
    source: str,
    metric_type: str,
    horizon_days: int,
    history_days: int,
    device: Optional[IoTDevice],
) -> tuple:
    return (
        source,
        metric_type,
        int(horizon_days),
        int(history_days),
        getattr(device, "id", None),
        getattr(device, "environment_type", None),
        getattr(device, "location_query", None),
        getattr(device, "latitude", None),
        getattr(device, "longitude", None),
    )


def _get_cached_forecast(key: tuple) -> Optional[dict]:
    cached = _FORECAST_CACHE.get(key)
    if not cached:
        return None
    created_at, payload = cached
    if time.time() - created_at > FORECAST_CACHE_TTL_SECONDS:
        _FORECAST_CACHE.pop(key, None)
        return None
    response = deepcopy(payload)
    response["cache_status"] = "hit"
    return response


def _set_cached_forecast(key: tuple, payload: dict) -> dict:
    response = deepcopy(payload)
    response["cache_status"] = "miss"
    _FORECAST_CACHE[key] = (time.time(), deepcopy(response))
    return response


@dataclass
class ForecastPoint:
    timestamp: datetime
    value: float


def _to_vn_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=VN_TZ)
    return value.astimezone(VN_TZ)


def _floor_hour(value: datetime) -> datetime:
    value = _to_vn_time(value)
    return value.replace(minute=0, second=0, microsecond=0)


def _clamp_for_metric(metric_type: str, value: float) -> float:
    ranges = {
        "temperature": (0.0, 50.0),
        "humidity": (0.0, 100.0),
        "soil_moisture": (0.0, 100.0),
        "light_intensity": (0.0, 1000.0),
        "pressure": (850.0, 1150.0),
    }
    low, high = ranges.get(metric_type, (0.0, 1000000.0))
    return max(low, min(high, value))


def _unit_for_metric(metric_type: str) -> str:
    return {
        "temperature": "C",
        "humidity": "%",
        "soil_moisture": "%",
        "light_intensity": "lux",
        "pressure": "hPa",
    }.get(metric_type, "")


def _prediction_values(predictions: list[dict]) -> list[float]:
    values = []
    for point in predictions or []:
        try:
            values.append(float(point["predicted_value"]))
        except (KeyError, TypeError, ValueError):
            continue
    return values


def _forecast_metadata(method: str, data_source: str, history_points: int, predictions: list[dict]) -> dict:
    values = _prediction_values(predictions)
    if method == "tft_checkpoint":
        confidence = min(0.96, 0.62 + min(history_points, 720) / 1800.0)
        quality_label = "high" if history_points >= 168 else "medium"
    elif method == "open_meteo_location_forecast":
        confidence = 0.88
        quality_label = "location_weather"
    else:
        confidence = min(0.74, 0.38 + min(history_points, 240) / 800.0)
        quality_label = "fallback" if history_points < 48 else "warmup"

    if "weather" in data_source or "meteostat" in data_source:
        confidence += 0.04

    return {
        "engine": "Temporal Fusion Transformer",
        "uses_tft": method == "tft_checkpoint",
        "confidence_score": round(max(0.0, min(0.99, confidence)), 2),
        "quality_label": quality_label,
        "forecast_min": round(min(values), 4) if values else None,
        "forecast_max": round(max(values), 4) if values else None,
        "forecast_delta": round(values[-1] - values[0], 4) if len(values) > 1 else 0.0 if values else None,
        "next_predicted_value": round(values[0], 4) if values else None,
    }


def _aggregate_hourly(rows: Iterable[Metric]) -> list[ForecastPoint]:
    buckets: dict[datetime, list[float]] = defaultdict(list)
    for row in rows:
        if row.metric_value is None:
            continue
        buckets[_floor_hour(row.event_ts)].append(float(row.metric_value))

    return [
        ForecastPoint(ts, float(mean(values)))
        for ts, values in sorted(buckets.items())
        if values
    ]


def _fallback_start_value(metric_type: str) -> float:
    return {
        "temperature": 26.0,
        "humidity": 65.0,
        "soil_moisture": 55.0,
        "light_intensity": 450.0,
        "pressure": 1012.0,
    }.get(metric_type, 0.0)


def _parse_weather_time(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=VN_TZ)
    return parsed.astimezone(VN_TZ)


def _weather_value_key(metric_type: str) -> Optional[tuple[str, float]]:
    return {
        "temperature": ("temperature_2m", 1.0),
        "humidity": ("relative_humidity_2m", 1.0),
        "soil_moisture": ("soil_moisture_0_to_1cm", 100.0),
        "light_intensity": ("shortwave_radiation", 1.0),
        "pressure": ("pressure_msl", 1.0),
    }.get(metric_type)


def _forecast_from_location_weather(
    device: IoTDevice,
    metric_type: str,
    horizon_days: int,
) -> Optional[dict]:
    """Use live weather forecast for outdoor climate-facing devices."""
    if not device or device.environment_type != "outdoor":
        return None
    if device.latitude is None or device.longitude is None:
        return None

    value_key_scale = _weather_value_key(metric_type)
    if not value_key_scale:
        return None
    value_key, value_scale = value_key_scale

    payload = get_hourly_weather_forecast(
        latitude=float(device.latitude),
        longitude=float(device.longitude),
        forecast_days=horizon_days + 1,
        timezone=device.timezone_name or "Asia/Ho_Chi_Minh",
    )
    if not payload:
        return None

    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    values = hourly.get(value_key) or []
    if not times or not values:
        return None

    horizon_hours = max(24, min(24 * 14, int(horizon_days) * 24))
    now_hour = _floor_hour(datetime.now(VN_TZ))
    max_ts = now_hour + timedelta(hours=horizon_hours)
    predictions = []

    for index, time_text in enumerate(times):
        if index >= len(values):
            break
        ts = _parse_weather_time(time_text)
        if not ts or ts <= now_hour or ts > max_ts:
            continue
        try:
            value = float(values[index]) * value_scale
        except (TypeError, ValueError):
            continue
        predictions.append(
            {
                "timestamp": ts.isoformat(),
                "predicted_value": round(_clamp_for_metric(metric_type, value), 4),
            }
        )
        if len(predictions) >= horizon_hours:
            break

    if not predictions:
        return None

    response = {
        "method": "open_meteo_location_forecast",
        "data_source": "open_meteo_hourly_forecast",
        "model_status": "location_weather_forecast_ready",
        "target_column": value_key,
        "unit": _unit_for_metric(metric_type),
        "timezone": payload.get("timezone") or device.timezone_name or "Asia/Ho_Chi_Minh",
        "history_points": len(predictions),
        "horizon_days": horizon_days,
        "frequency": "hourly",
        "generated_at": datetime.now(VN_TZ).isoformat(),
        "weather_provider": "Open-Meteo",
        "predictions": predictions,
    }
    response.update(
        _forecast_metadata(
            method=response["method"],
            data_source=response["data_source"],
            history_points=len(predictions),
            predictions=predictions,
        )
    )
    return response


def _temperature_predictions_have_plausible_shape(predictions: list[dict]) -> bool:
    values_by_hour: dict[int, list[float]] = defaultdict(list)
    for point in predictions[:24]:
        ts = _parse_weather_time(str(point.get("timestamp", "")))
        if not ts:
            continue
        try:
            values_by_hour[ts.hour].append(float(point["predicted_value"]))
        except (KeyError, TypeError, ValueError):
            continue

    if len(values_by_hour) < 12:
        return True

    hourly = {hour: mean(values) for hour, values in values_by_hour.items() if values}
    peak_hour = max(hourly, key=hourly.get)
    trough_hour = min(hourly, key=hourly.get)
    spread = max(hourly.values()) - min(hourly.values())

    # Vietnam daily temperature normally peaks late morning to afternoon and
    # bottoms out overnight or early morning. Synthetic checkpoints that invert
    # this shape should fall back instead of driving the dashboard.
    peak_is_daytime = 10 <= peak_hour <= 17
    trough_is_cool_period = 0 <= trough_hour <= 8 or 19 <= trough_hour <= 23
    spread_is_reasonable = spread <= 14.0
    return peak_is_daytime and trough_is_cool_period and spread_is_reasonable


def _forecast_from_hourly_history(
    points: list[ForecastPoint],
    metric_type: str,
    horizon_days: int,
) -> list[ForecastPoint]:
    """Forecast using hourly seasonality pattern.
    
    For temperature in Vietnam:
    - Peak around 13-14h (midday)
    - Lowest around 5-6h (early morning)
    """
    horizon_hours = max(24, min(24 * 14, int(horizon_days) * 24))
    now_hour = _floor_hour(datetime.now(VN_TZ))

    if points:
        latest_value = points[-1].value
        values = [point.value for point in points]
    else:
        latest_value = _fallback_start_value(metric_type)
        values = [latest_value]

    by_hour: dict[int, list[float]] = defaultdict(list)
    by_week_hour: dict[tuple[int, int], list[float]] = defaultdict(list)
    for point in points:
        ts = _to_vn_time(point.timestamp)
        by_hour[ts.hour].append(point.value)
        by_week_hour[(ts.weekday(), ts.hour)].append(point.value)

    recent = values[-48:]
    if len(recent) >= 2:
        hourly_trend = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
    else:
        hourly_trend = 0.0

    # Dampen trend to avoid unrealistic forecasts
    hourly_trend = hourly_trend * 0.25

    # Vietnam-specific daily cycles by metric type.
    daily_cycles = {
        "temperature": {0:-0.8, 1:-1.0, 2:-1.2, 3:-1.3, 4:-1.4, 5:-1.5, 6:-1.3, 7:-0.8, 8:-0.2, 9:0.3, 10:0.8, 11:1.2, 12:1.6, 13:1.8, 14:1.8, 15:1.6, 16:1.2, 17:0.6, 18:0.2, 19:-0.4, 20:-0.8, 21:-1.0, 22:-1.1, 23:-1.0},
        "humidity": {0:0.6, 1:0.8, 2:1.0, 3:1.1, 4:1.2, 5:1.3, 6:1.1, 7:0.7, 8:0.1, 9:-0.2, 10:-0.6, 11:-1.0, 12:-1.4, 13:-1.6, 14:-1.6, 15:-1.4, 16:-1.0, 17:-0.4, 18:0.0, 19:0.4, 20:0.6, 21:0.7, 22:0.7, 23:0.6},
        "light_intensity": {0:-1.8, 1:-1.8, 2:-1.8, 3:-1.8, 4:-1.8, 5:-1.5, 6:-0.8, 7:0.2, 8:0.9, 9:1.4, 10:1.7, 11:1.8, 12:1.8, 13:1.8, 14:1.6, 15:1.2, 16:0.6, 17:-0.2, 18:-1.0, 19:-1.6, 20:-1.8, 21:-1.8, 22:-1.8, 23:-1.8},
        "pressure": {h: 0.0 for h in range(24)},
        "soil_moisture": {h: 0.0 for h in range(24)},
    }
    vietnam_daily_cycle = daily_cycles.get(metric_type, {h: 0.0 for h in range(24)})

    predictions: list[ForecastPoint] = []
    for step in range(1, horizon_hours + 1):
        ts = now_hour + timedelta(hours=step)
        hour_of_day = ts.hour
        week_values = by_week_hour.get((ts.weekday(), hour_of_day), [])
        hour_values = by_hour.get(hour_of_day, [])

        # Try to get seasonal value from history
        if week_values:
            seasonal = float(mean(week_values[-8:]))
        elif hour_values:
            seasonal = float(mean(hour_values[-14:]))
        else:
            seasonal = None

        # If we have seasonal data from history, use it; otherwise use generic daily cycle
        if seasonal is not None:
            # Blend historical seasonal with generic cycle
            generic_cycle_offset = vietnam_daily_cycle.get(hour_of_day, 0.0)
            # Give more weight to historical seasonal as we get more data
            history_weight = min(0.9, len(hour_values) * 0.2)
            seasonal = seasonal * history_weight + (latest_value + generic_cycle_offset * abs(latest_value) * 0.05) * (1 - history_weight)
        else:
            # Use generic Vietnam daily cycle
            cycle_offset = vietnam_daily_cycle.get(hour_of_day, 0.0)
            # Cycle offset is in terms of ±% of latest value
            seasonal = latest_value + (cycle_offset * abs(latest_value) * 0.05)

        # Smoother daily wave for fine-tuning
        day_angle = 2 * math.pi * (hour_of_day / 24)
        smooth_daily_wave = math.sin(day_angle) * max(0.01, abs(latest_value) * 0.002)
        
        # Lower anchor weight to allow seasonal pattern to show more
        anchor_weight = max(0.35, 0.70 - step * 0.010)
        seasonal_weight = 1.0 - anchor_weight

        predicted = (
            latest_value * anchor_weight
            + seasonal * seasonal_weight
            + hourly_trend * step * 0.15
            + smooth_daily_wave
        )
        predictions.append(ForecastPoint(ts, _clamp_for_metric(metric_type, predicted)))

    return predictions


class DashboardForecastService:
    """Generate multi-day dashboard forecasts."""

    @staticmethod
    def forecast(
        db: Session,
        source: str,
        metric_type: str,
        horizon_days: int = 3,
        history_days: int = 30,
        device: Optional[IoTDevice] = None,
    ) -> dict:
        horizon_days = max(1, min(14, int(horizon_days)))
        history_days = max(7, min(365, int(history_days)))
        cache_key = _forecast_cache_key(source, metric_type, horizon_days, history_days, device)
        cached = _get_cached_forecast(cache_key)
        if cached is not None:
            return cached

        fallback_reason = None

        if device is not None:
            try:
                tft_result = TFTInferenceService.predict(
                    db=db,
                    device=device,
                    horizon_days=horizon_days,
                )
                if (
                    metric_type == "temperature"
                    and not _temperature_predictions_have_plausible_shape(tft_result.predictions)
                ):
                    raise ValueError("TFT temperature checkpoint produced an implausible Vietnam daily cycle.")

                response = {
                    "method": "tft_checkpoint",
                    "data_source": tft_result.data_source,
                    "model_status": "tft_checkpoint_loaded",
                    "source": source,
                    "metric_type": metric_type,
                    "target_column": tft_result.target_column,
                    "unit": _unit_for_metric(metric_type),
                    "timezone": "Asia/Ho_Chi_Minh",
                    "history_points": tft_result.rows,
                    "horizon_days": horizon_days,
                    "frequency": "hourly",
                    "checkpoint_path": tft_result.checkpoint_path,
                    "metadata_path": tft_result.metadata_path,
                    "prediction_length": tft_result.prediction_length,
                    "generated_at": datetime.now(VN_TZ).isoformat(),
                    "predictions": tft_result.predictions,
                }
                response.update(
                    _forecast_metadata(
                        method=response["method"],
                        data_source=response["data_source"],
                        history_points=tft_result.rows,
                        predictions=tft_result.predictions,
                    )
                )
                return _set_cached_forecast(cache_key, response)
            except Exception as exc:
                fallback_reason = f"{type(exc).__name__}: {exc}"

        weather_response = (
            _forecast_from_location_weather(device, metric_type, horizon_days)
            if device is not None
            else None
        )
        if weather_response is not None:
            weather_response["source"] = source
            weather_response["metric_type"] = metric_type
            if fallback_reason:
                weather_response["fallback_reason"] = fallback_reason
                weather_response["model_status"] = "location_weather_fallback_used"
            return _set_cached_forecast(cache_key, weather_response)

        since = datetime.now(VN_TZ).replace(tzinfo=None) - timedelta(days=history_days)

        rows = (
            db.query(Metric)
            .filter(
                Metric.sensor_id == source,
                Metric.metric_type == metric_type,
                Metric.event_ts >= since,
            )
            .order_by(Metric.event_ts.asc())
            .all()
        )

        points = _aggregate_hourly(rows)
        predictions = _forecast_from_hourly_history(points, metric_type, horizon_days)

        response = {
            "method": "tft_seasonal_baseline",
            "data_source": "metrics_realtime_history",
            "model_status": "tft_fallback_used" if fallback_reason else "tft_baseline_ready",
            "fallback_reason": fallback_reason,
            "source": source,
            "metric_type": metric_type,
            "unit": _unit_for_metric(metric_type),
            "timezone": "Asia/Ho_Chi_Minh",
            "history_points": len(points),
            "horizon_days": horizon_days,
            "frequency": "hourly",
            "generated_at": datetime.now(VN_TZ).isoformat(),
            "predictions": [
                {
                    "timestamp": point.timestamp.isoformat(),
                    "predicted_value": round(point.value, 4),
                }
                for point in predictions
            ],
        }
        response.update(
            _forecast_metadata(
                method=response["method"],
                data_source=response["data_source"],
                history_points=len(points),
                predictions=response["predictions"],
            )
        )
        return _set_cached_forecast(cache_key, response)

