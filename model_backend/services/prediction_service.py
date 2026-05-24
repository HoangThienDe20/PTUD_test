"""XGBoost-based IoT metric prediction using live metrics plus optional thongke priors.

The model is trained per source + metric type when enough historical data exists.
For newly-created user devices with limited live history, it can add rows from
public.thongke and reports the selected data_source so synthetic/prior data is
not confused with recorded realtime metrics.
"""

from __future__ import annotations

import math
import json
import logging
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import xgboost as xgb
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Metric


VN_TZ = timezone(timedelta(hours=7))
LAG_STEPS = (1, 2, 3, 6, 12, 24, 36)
# Use XGBoost as soon as the lag matrix is useful. Higher point counts are
# reflected in confidence metadata rather than gating the model too aggressively.
MIN_TRAINING_POINTS = 48
CACHE_TTL_SECONDS = 300
CACHE_MAX_SIZE = 256
MAX_QUERY_ROWS = 1500
MAX_TRAINING_POINTS = 360
OFFLINE_MAX_TRAINING_POINTS = 17280
MODEL_FEATURE_VERSION = 2
logger = logging.getLogger(__name__)

METRIC_RANGES = {
    "temperature": (0.0, 50.0),
    "humidity": (0.0, 100.0),
    "soil_moisture": (0.0, 100.0),
    "light_intensity": (0.0, 1000.0),
    "pressure": (850.0, 1150.0),
}

FALLBACK_VALUES = {
    "temperature": 26.0,
    "humidity": 65.0,
    "soil_moisture": 55.0,
    "light_intensity": 450.0,
    "pressure": 1012.0,
}

SHORT_HORIZON_GUARDRAILS = {
    # max change per 5 minutes, max change per 30 minutes
    "temperature": (0.8, 3.0),
    "humidity": (4.0, 15.0),
    "soil_moisture": (4.0, 15.0),
    "light_intensity": (150.0, 500.0),
    "pressure": (1.0, 4.0),
}

SPIKE_LIMITS = {
    "temperature": 6.0,
    "humidity": 25.0,
    "soil_moisture": 25.0,
    "light_intensity": 450.0,
    "pressure": 8.0,
}


@dataclass
class SeriesPoint:
    ts: datetime
    value: float


@dataclass
class XGBoostTrainingReport:
    rows: int
    feature_count: int
    train_rows: int
    validation_rows: int
    best_iteration: Optional[int]
    best_score: Optional[float]
    train_rmse: Optional[float]
    validation_rmse: Optional[float]
    train_mae: Optional[float]
    validation_mae: Optional[float]


@dataclass
class ForecastResult:
    method: str
    data_source: str
    source: str
    metric_type: str
    unit: Optional[str]
    training_points: int
    generated_at: datetime
    predictions: list[dict]
    model_status: str
    confidence_score: float
    quality_label: str
    forecast_min: Optional[float]
    forecast_max: Optional[float]
    forecast_delta: Optional[float]
    next_predicted_value: Optional[float]
    debug_metadata: Optional[dict] = None
    error: Optional[str] = None


_prediction_cache: dict[tuple, tuple[float, ForecastResult]] = {}
_cache_lock = threading.Lock()


def _cache_get(key, now):
    with _cache_lock:
        entry = _prediction_cache.get(key)
        if entry and now - entry[0] < CACHE_TTL_SECONDS:
            return entry[1]
        return None


def _cache_set(key, result, now):
    with _cache_lock:
        if len(_prediction_cache) >= CACHE_MAX_SIZE:
            oldest = min(_prediction_cache, key=lambda k: _prediction_cache[k][0])
            del _prediction_cache[oldest]
        _prediction_cache[key] = (now, result)


def _project_path(path_value: str) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    project_root = Path(__file__).resolve().parents[2]
    return project_root / path


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "unknown")).strip("_")
    return slug[:80] or "unknown"


def _to_vn_time(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=VN_TZ)
    return dt.astimezone(VN_TZ)


def _floor_time(dt: datetime, step_minutes: int) -> datetime:
    dt = _to_vn_time(dt)
    bucket_minute = (dt.minute // step_minutes) * step_minutes
    return dt.replace(minute=bucket_minute, second=0, microsecond=0)


def _time_features(target_ts: datetime) -> list[float]:
    target_ts = _to_vn_time(target_ts)
    minute_of_day = target_ts.hour * 60 + target_ts.minute
    day_angle = 2 * math.pi * minute_of_day / 1440
    week_angle = 2 * math.pi * target_ts.weekday() / 7
    return [
        target_ts.hour,
        target_ts.minute,
        minute_of_day,
        math.sin(day_angle),
        math.cos(day_angle),
        target_ts.weekday(),
        math.sin(week_angle),
        math.cos(week_angle),
    ]


def _unit_for_metric(metric_type: str) -> str:
    return {
        "temperature": "C",
        "humidity": "%",
        "soil_moisture": "%",
        "light_intensity": "lux",
        "pressure": "hPa",
    }.get(metric_type, "")


def _clamp_for_metric(metric_type: str, value: float) -> float:
    low, high = METRIC_RANGES.get(metric_type, (-1_000_000.0, 1_000_000.0))
    return max(low, min(high, float(value)))


def _window(values: list[float], current_index: int, size: int) -> list[float]:
    return values[max(0, current_index - size + 1) : current_index + 1]


def _safe_std(values: list[float]) -> float:
    return float(np.std(values)) if values else 0.0


def _safe_slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return float((values[-1] - values[0]) / max(1, len(values) - 1))


def _build_feature(values: list[float], current_index: int, target_ts: datetime) -> list[float]:
    current = values[current_index]
    lags = [values[max(0, current_index - lag)] for lag in LAG_STEPS]
    recent_3 = _window(values, current_index, 3)
    recent_6 = _window(values, current_index, 6)
    recent_12 = _window(values, current_index, 12)
    recent_24 = _window(values, current_index, 24)
    recent_36 = _window(values, current_index, 36)
    delta_1 = current - values[max(0, current_index - 1)]
    delta_6 = current - values[max(0, current_index - 6)]
    delta_12 = current - values[max(0, current_index - 12)]
    rolling_mean_12 = float(np.mean(recent_12))
    rolling_std_12 = _safe_std(recent_12)
    rolling_min_12 = float(np.min(recent_12))
    rolling_max_12 = float(np.max(recent_12))
    rolling_range_12 = rolling_max_12 - rolling_min_12
    rolling_mean_3 = float(np.mean(recent_3))
    rolling_mean_6 = float(np.mean(recent_6))
    rolling_mean_24 = float(np.mean(recent_24))
    rolling_std_24 = _safe_std(recent_24)
    rolling_median_12 = float(np.median(recent_12))
    rolling_slope_6 = _safe_slope(recent_6)
    rolling_slope_12 = _safe_slope(recent_12)
    rolling_slope_36 = _safe_slope(recent_36)
    deviation_from_12 = current - rolling_mean_12
    return [
        current,
        *lags,
        delta_1,
        delta_6,
        delta_12,
        rolling_mean_3,
        rolling_mean_6,
        rolling_mean_12,
        rolling_mean_24,
        rolling_std_12,
        rolling_std_24,
        rolling_min_12,
        rolling_max_12,
        rolling_range_12,
        rolling_median_12,
        rolling_slope_6,
        rolling_slope_12,
        rolling_slope_36,
        deviation_from_12,
        *_time_features(target_ts),
    ]


def _query_thongke_rows(
    db: Session,
    metric_type: str,
    source: Optional[str],
    history_days: int,
    max_rows: int = MAX_QUERY_ROWS,
) -> list[tuple[datetime, float, Optional[str]]]:
    params = {"metric_type": metric_type, "history_days": history_days, "max_rows": int(max_rows)}
    source_filter = ""
    if source:
        params["source"] = source
        source_filter = "and sensor_id = :source"

    return db.execute(
        text(
            f"""
            select event_ts, metric_value, unit
            from (
                select event_ts, metric_value, unit
                from public.thongke
                where metric_type = :metric_type
                  {source_filter}
                  and event_ts >= now() - (:history_days * interval '1 day')
                order by event_ts desc
                limit :max_rows
            ) recent_rows
            order by event_ts asc
            """
        ),
        params,
    ).fetchall()


def _query_metric_rows(
    db: Session,
    metric_type: str,
    source: Optional[str],
    history_days: int,
    max_rows: int = MAX_QUERY_ROWS,
) -> list[tuple[datetime, float, Optional[str]]]:
    since = datetime.now(VN_TZ).replace(tzinfo=None) - timedelta(days=history_days)
    query = (
        db.query(Metric.event_ts, Metric.metric_value, Metric.unit)
        .filter(Metric.metric_type == metric_type)
        .filter(Metric.event_ts >= since)
    )
    if source:
        query = query.filter(Metric.sensor_id == source)
    rows = query.order_by(Metric.event_ts.desc()).limit(int(max_rows)).all()
    return list(reversed(rows))


def _safe_thongke_rows(
    db: Session,
    metric_type: str,
    source: Optional[str],
    history_days: int,
    max_rows: int = MAX_QUERY_ROWS,
) -> list[tuple[datetime, float, Optional[str]]]:
    try:
        return _query_thongke_rows(
            db,
            metric_type=metric_type,
            source=source,
            history_days=history_days,
            max_rows=max_rows,
        )
    except Exception:
        db.rollback()
        return []


def _merge_row_sets(
    *row_sets: list[tuple[datetime, float, Optional[str]]],
    max_rows: int = MAX_QUERY_ROWS,
) -> list[tuple[datetime, float, Optional[str]]]:
    rows: list[tuple[datetime, float, Optional[str]]] = []
    for row_set in row_sets:
        rows.extend(row_set or [])
    rows = sorted(rows, key=lambda row: _to_vn_time(row[0]))
    if max_rows and len(rows) > max_rows:
        rows = rows[-int(max_rows):]
    return rows


def _selection_debug(
    *,
    data_source: str,
    metrics_rows: list[tuple[datetime, float, Optional[str]]],
    thongke_rows: list[tuple[datetime, float, Optional[str]]],
    merged_rows: list[tuple[datetime, float, Optional[str]]],
    aggregated_points: int = 0,
) -> dict:
    return {
        "metrics_rows": len(metrics_rows or []),
        "thongke_rows": len(thongke_rows or []),
        "merged_rows": len(merged_rows or []),
        "aggregated_points": int(aggregated_points or 0),
        "data_source": data_source,
    }


def _log_selection_debug(debug_metadata: Optional[dict]) -> None:
    if debug_metadata:
        logger.info("prediction_data_selection=%s", debug_metadata)


def _best_training_rows(
    db: Session,
    metric_type: str,
    source: str,
    history_days: int,
    max_rows: int = MAX_QUERY_ROWS,
) -> tuple[list[tuple[datetime, float, Optional[str]]], str]:
    metrics_source_rows = _query_metric_rows(db, metric_type, source, history_days, max_rows=max_rows)
    thongke_source_rows = _safe_thongke_rows(db, metric_type, source, history_days, max_rows=max_rows)
    metrics_prior_rows = _query_metric_rows(db, metric_type, None, history_days, max_rows=max_rows)
    thongke_prior_rows = _safe_thongke_rows(db, metric_type, None, history_days, max_rows=max_rows)

    candidates = [
        ("combined_metrics_thongke_source", metrics_source_rows, thongke_source_rows),
        ("metrics_live_source", metrics_source_rows, []),
        ("thongke_source", [], thongke_source_rows),
        ("combined_metrics_thongke_metric_type_prior", metrics_prior_rows, thongke_prior_rows),
        ("metrics_metric_type_prior", metrics_prior_rows, []),
        ("thongke_metric_type_prior", [], thongke_prior_rows),
    ]

    best_source = "unavailable"
    best_rows: list[tuple[datetime, float, Optional[str]]] = []
    best_debug: Optional[dict] = None
    for data_source, metrics_rows, thongke_rows in candidates:
        rows = _merge_row_sets(metrics_rows, thongke_rows, max_rows=max_rows)
        debug_metadata = _selection_debug(
            data_source=data_source,
            metrics_rows=metrics_rows,
            thongke_rows=thongke_rows,
            merged_rows=rows,
        )
        if len(rows) >= MIN_TRAINING_POINTS:
            _log_selection_debug(debug_metadata)
            return rows, data_source
        if len(rows) > len(best_rows):
            best_source = data_source
            best_rows = rows
            best_debug = debug_metadata

    _log_selection_debug(best_debug)
    return best_rows, best_source


def _best_training_series(
    db: Session,
    metric_type: str,
    source: str,
    history_days: int,
    step_minutes: int,
    max_rows: int = MAX_QUERY_ROWS,
) -> tuple[list[tuple[datetime, float, Optional[str]]], str, list[SeriesPoint], Optional[str], dict]:
    metrics_source_rows = _query_metric_rows(db, metric_type, source, history_days, max_rows=max_rows)
    thongke_source_rows = _safe_thongke_rows(db, metric_type, source, history_days, max_rows=max_rows)
    metrics_prior_rows = _query_metric_rows(db, metric_type, None, history_days, max_rows=max_rows)
    thongke_prior_rows = _safe_thongke_rows(db, metric_type, None, history_days, max_rows=max_rows)

    candidates = [
        ("combined_metrics_thongke_source", metrics_source_rows, thongke_source_rows),
        ("metrics_live_source", metrics_source_rows, []),
        ("thongke_source", [], thongke_source_rows),
        ("combined_metrics_thongke_metric_type_prior", metrics_prior_rows, thongke_prior_rows),
        ("metrics_metric_type_prior", metrics_prior_rows, []),
        ("thongke_metric_type_prior", [], thongke_prior_rows),
    ]

    best_source = "unavailable"
    best_rows: list[tuple[datetime, float, Optional[str]]] = []
    best_points: list[SeriesPoint] = []
    best_unit: Optional[str] = None
    best_debug = _selection_debug(
        data_source=best_source,
        metrics_rows=[],
        thongke_rows=[],
        merged_rows=[],
    )

    for data_source, metrics_rows, thongke_rows in candidates:
        rows = _merge_row_sets(metrics_rows, thongke_rows, max_rows=max_rows)
        points, unit = _aggregate_series(rows, step_minutes=step_minutes)
        points = _clean_series_points(points, metric_type)
        debug_metadata = _selection_debug(
            data_source=data_source,
            metrics_rows=metrics_rows,
            thongke_rows=thongke_rows,
            merged_rows=rows,
            aggregated_points=len(points),
        )
        if len(points) >= MIN_TRAINING_POINTS:
            _log_selection_debug(debug_metadata)
            return rows, data_source, points, unit, debug_metadata
        if len(points) > len(best_points):
            best_source = data_source
            best_rows = rows
            best_points = points
            best_unit = unit
            best_debug = debug_metadata

    _log_selection_debug(best_debug)
    return best_rows, best_source, best_points, best_unit, best_debug


def _aggregate_series(rows: Iterable[tuple[datetime, float, Optional[str]]], step_minutes: int) -> tuple[list[SeriesPoint], Optional[str]]:
    buckets: dict[datetime, list[float]] = defaultdict(list)
    unit = None
    for ts, value, row_unit in rows:
        if value is None:
            continue
        buckets[_floor_time(ts, step_minutes)].append(float(value))
        if unit is None and row_unit:
            unit = str(row_unit)

    if not buckets:
        return [], unit

    start = min(buckets)
    end = max(buckets)
    points: list[SeriesPoint] = []
    last_value: Optional[float] = None
    cursor = start
    while cursor <= end:
        values = buckets.get(cursor)
        if values:
            last_value = float(np.mean(values))
        if last_value is not None:
            points.append(SeriesPoint(cursor, last_value))
        cursor += timedelta(minutes=step_minutes)

    return points, unit


def _clean_series_points(points: list[SeriesPoint], metric_type: str) -> list[SeriesPoint]:
    """Filter impossible values and damp isolated spikes before training."""
    if not points:
        return []

    low, high = METRIC_RANGES.get(metric_type, (-1_000_000.0, 1_000_000.0))
    spike_limit = SPIKE_LIMITS.get(metric_type, max(1.0, (high - low) * 0.08))
    cleaned: list[SeriesPoint] = []

    for point in sorted(points, key=lambda item: item.ts):
        value = float(point.value)
        if not math.isfinite(value):
            continue
        if value < low or value > high:
            continue

        if len(cleaned) >= 6:
            recent_values = [item.value for item in cleaned[-12:]]
            median = float(np.median(recent_values))
            if abs(value - median) > spike_limit:
                value = median + math.copysign(spike_limit, value - median)

        cleaned.append(SeriesPoint(point.ts, _clamp_for_metric(metric_type, value)))

    return cleaned


def _build_training_matrix(points: list[SeriesPoint]) -> tuple[np.ndarray, np.ndarray]:
    values = [p.value for p in points]
    x_rows = []
    y_rows = []
    min_index = max(LAG_STEPS)
    for idx in range(min_index, len(points) - 1):
        target_ts = points[idx + 1].ts
        x_rows.append(_build_feature(values, idx, target_ts))
        y_rows.append(values[idx + 1])
    if not x_rows:
        raise ValueError(
            f"Not enough data: {len(points)} points, need at least {max(LAG_STEPS) + 2}."
        )
    return np.asarray(x_rows, dtype=np.float32), np.asarray(y_rows, dtype=np.float32)


def _regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[Optional[float], Optional[float]]:
    if y_true.size == 0 or y_pred.size == 0:
        return None, None
    errors = y_pred.astype(float) - y_true.astype(float)
    rmse = float(np.sqrt(np.mean(np.square(errors))))
    mae = float(np.mean(np.abs(errors)))
    return round(rmse, 6), round(mae, 6)


def _train_xgboost(
    points: list[SeriesPoint],
    max_points: int = MAX_TRAINING_POINTS,
    boost_rounds: Optional[int] = None,
) -> tuple[xgb.Booster, XGBoostTrainingReport]:
    points = points[-max_points:]
    x_train, y_train = _build_training_matrix(points)
    sample_count = len(y_train)
    validation_rows = 0
    if sample_count >= 80:
        validation_rows = max(12, min(sample_count // 5, 288))
    train_end = sample_count - validation_rows if validation_rows else sample_count

    dtrain = xgb.DMatrix(x_train[:train_end], label=y_train[:train_end])
    dvalid = None
    if validation_rows:
        dvalid = xgb.DMatrix(x_train[train_end:], label=y_train[train_end:])

    rounds = boost_rounds or (180 if len(points) < 240 else 500)
    params = {
        "objective": "reg:squarederror",
        "eval_metric": ["rmse", "mae"],
        "tree_method": "hist",
        "max_depth": 3,
        "eta": 0.035,
        "subsample": 0.88,
        "colsample_bytree": 0.9,
        "min_child_weight": 2,
        "lambda": 2.0,
        "alpha": 0.05,
        "gamma": 0.02,
        "nthread": 1,
        "seed": 42,
    }
    evals = [(dtrain, "train")]
    if dvalid is not None:
        evals.append((dvalid, "validation"))

    booster = xgb.train(
        params,
        dtrain,
        num_boost_round=rounds,
        evals=evals,
        early_stopping_rounds=30 if dvalid is not None else None,
        verbose_eval=False,
    )

    iteration_range = None
    if getattr(booster, "best_iteration", None) is not None:
        iteration_range = (0, int(booster.best_iteration) + 1)

    train_pred = booster.predict(dtrain, iteration_range=iteration_range)
    train_rmse, train_mae = _regression_metrics(y_train[:train_end], train_pred)
    validation_rmse = None
    validation_mae = None
    if dvalid is not None:
        valid_pred = booster.predict(dvalid, iteration_range=iteration_range)
        validation_rmse, validation_mae = _regression_metrics(y_train[train_end:], valid_pred)

    best_iteration = getattr(booster, "best_iteration", None)
    best_score = getattr(booster, "best_score", None)
    report = XGBoostTrainingReport(
        rows=len(points),
        feature_count=int(x_train.shape[1]),
        train_rows=int(train_end),
        validation_rows=int(validation_rows),
        best_iteration=int(best_iteration) if best_iteration is not None else None,
        best_score=float(best_score) if best_score is not None else None,
        train_rmse=train_rmse,
        validation_rmse=validation_rmse,
        train_mae=train_mae,
        validation_mae=validation_mae,
    )
    return booster, report


def _trend_forecast(
    points: list[SeriesPoint],
    horizon_minutes: int,
    step_minutes: int,
    metric_type: str,
) -> list[SeriesPoint]:
    if not points:
        base = FALLBACK_VALUES.get(metric_type, 0.0)
        start = _floor_time(datetime.now(VN_TZ), step_minutes)
        steps = max(1, horizon_minutes // step_minutes)
        return [
            SeriesPoint(start + timedelta(minutes=step_minutes * step), base)
            for step in range(1, steps + 1)
        ]
    values = [p.value for p in points]
    recent = values[-12:]
    if len(recent) >= 2:
        slope = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
    else:
        slope = 0.0

    predictions = []
    current_ts = points[-1].ts
    current_value = values[-1]
    steps = max(1, horizon_minutes // step_minutes)
    for step in range(1, steps + 1):
        next_ts = current_ts + timedelta(minutes=step_minutes * step)
        next_value = _clamp_for_metric(metric_type, current_value + slope * step)
        predictions.append(SeriesPoint(next_ts, float(next_value)))
    return predictions


def _predict_xgboost_value(
    booster: xgb.Booster,
    feature: np.ndarray,
    best_iteration: Optional[int] = None,
) -> float:
    if best_iteration is None:
        best_iteration = getattr(booster, "best_iteration", None)
    if best_iteration is not None:
        prediction = booster.predict(xgb.DMatrix(feature), iteration_range=(0, int(best_iteration) + 1))
    else:
        prediction = booster.predict(xgb.DMatrix(feature))
    return float(prediction[0])


def _xgboost_forecast(
    points: list[SeriesPoint],
    horizon_minutes: int,
    step_minutes: int,
    metric_type: str,
) -> list[SeriesPoint]:
    booster, report = _train_xgboost(points)
    values = [p.value for p in points]
    predictions = []
    current_ts = points[-1].ts
    steps = max(1, horizon_minutes // step_minutes)

    for _ in range(steps):
        target_ts = current_ts + timedelta(minutes=step_minutes)
        feature = np.asarray([_build_feature(values, len(values) - 1, target_ts)], dtype=np.float32)
        predicted = _clamp_for_metric(
            metric_type,
            _predict_xgboost_value(booster, feature, report.best_iteration),
        )
        values.append(predicted)
        predictions.append(SeriesPoint(target_ts, predicted))
        current_ts = target_ts

    return predictions


def _xgboost_model_forecast(
    booster: xgb.Booster,
    points: list[SeriesPoint],
    horizon_minutes: int,
    step_minutes: int,
    metric_type: str,
    best_iteration: Optional[int] = None,
) -> list[SeriesPoint]:
    values = [p.value for p in points]
    if len(values) < max(LAG_STEPS) + 1:
        raise ValueError(f"Need at least {max(LAG_STEPS) + 1} seed points for XGBoost inference.")

    predictions = []
    current_ts = points[-1].ts
    steps = max(1, horizon_minutes // step_minutes)
    for _ in range(steps):
        target_ts = current_ts + timedelta(minutes=step_minutes)
        feature = np.asarray([_build_feature(values, len(values) - 1, target_ts)], dtype=np.float32)
        predicted = _clamp_for_metric(
            metric_type,
            _predict_xgboost_value(booster, feature, best_iteration),
        )
        values.append(predicted)
        predictions.append(SeriesPoint(target_ts, predicted))
        current_ts = target_ts

    return predictions


def _latest_live_value(db: Session, source: str, metric_type: str) -> Optional[float]:
    row = (
        db.query(Metric)
        .filter(Metric.sensor_id == source, Metric.metric_type == metric_type)
        .order_by(Metric.event_ts.desc())
        .first()
    )
    return float(row.metric_value) if row else None


def _safe_latest_live_value(db: Session, source: str, metric_type: str) -> Optional[float]:
    try:
        return _latest_live_value(db, source, metric_type)
    except Exception:
        db.rollback()
        return None


def _format_predictions(points: list[SeriesPoint]) -> list[dict]:
    return [
        {
            "timestamp": _to_vn_time(point.ts).isoformat(),
            "predicted_value": round(float(point.value), 4),
        }
        for point in points
    ]


def _align_forecast_to_live(
    prediction_points: list[SeriesPoint],
    training_points: list[SeriesPoint],
    latest_value: Optional[float],
    step_minutes: int,
    metric_type: str,
) -> list[SeriesPoint]:
    """Shift forecast timestamps to now and align values to the latest realtime metric."""
    if not prediction_points:
        return prediction_points

    now_bucket = _floor_time(datetime.now(VN_TZ), step_minutes)
    offset = 0.0
    if latest_value is not None and training_points:
        offset = float(latest_value) - float(training_points[-1].value)

    aligned_points = []
    for index, point in enumerate(prediction_points, start=1):
        aligned_points.append(
            SeriesPoint(
                now_bucket + timedelta(minutes=index * step_minutes),
                _clamp_for_metric(metric_type, float(point.value) + offset),
            )
        )
    return aligned_points


def _recent_trend_per_step(points: list[SeriesPoint], metric_type: str, step_minutes: int) -> float:
    values = [float(point.value) for point in (points or []) if point.value is not None]
    recent = values[-12:]
    if len(recent) < 2:
        return 0.0

    trend = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
    per_step_5m, _ = SHORT_HORIZON_GUARDRAILS.get(metric_type, (5.0, 20.0))
    step_limit = per_step_5m * max(1.0, step_minutes / 5.0)
    return max(-step_limit, min(step_limit, trend))


def _stabilize_short_horizon_forecast(
    prediction_points: list[SeriesPoint],
    training_points: list[SeriesPoint],
    latest_value: Optional[float],
    horizon_minutes: int,
    step_minutes: int,
    metric_type: str,
) -> list[SeriesPoint]:
    """Keep short-horizon forecasts continuous with the latest sensor reading."""
    if not prediction_points:
        return prediction_points

    base_value = latest_value
    if base_value is None and training_points:
        base_value = training_points[-1].value
    if base_value is None:
        base_value = prediction_points[0].value
    base_value = _clamp_for_metric(metric_type, float(base_value))

    per_step_5m, total_30m = SHORT_HORIZON_GUARDRAILS.get(metric_type, (5.0, 20.0))
    step_limit = per_step_5m * max(1.0, step_minutes / 5.0)
    total_limit = total_30m * max(1.0, horizon_minutes / 30.0)
    steps = max(1, len(prediction_points))
    trend_step = _recent_trend_per_step(training_points, metric_type, step_minutes)

    stabilized: list[SeriesPoint] = []
    previous_value = base_value
    for index, point in enumerate(prediction_points, start=1):
        raw_value = _clamp_for_metric(metric_type, float(point.value))
        trend_value = _clamp_for_metric(metric_type, base_value + trend_step * index)
        blended_value = raw_value * 0.35 + trend_value * 0.65

        progress_limit = min(total_limit, max(step_limit, total_limit * index / steps))
        lower_bound = base_value - progress_limit
        upper_bound = base_value + progress_limit
        bounded_value = max(lower_bound, min(upper_bound, blended_value))

        bounded_value = max(previous_value - step_limit, min(previous_value + step_limit, bounded_value))
        bounded_value = _clamp_for_metric(metric_type, bounded_value)
        stabilized.append(SeriesPoint(point.ts, float(bounded_value)))
        previous_value = bounded_value

    return stabilized


def _score_quality(method: str, data_source: str, training_points: int) -> tuple[float, str, str]:
    if method.startswith("xgboost"):
        confidence = min(0.95, 0.55 + min(training_points, 240) / 600.0)
        if "prior" in data_source:
            confidence -= 0.08
        if method == "xgboost_offline":
            confidence = min(0.97, confidence + 0.05)
        if training_points >= 120:
            label = "high"
        elif training_points >= 60:
            label = "medium"
        else:
            label = "warmup"
        status = "xgboost_offline_model_loaded" if method == "xgboost_offline" else "xgboost_trained"
    elif method == "trend_fallback":
        confidence = 0.42 if training_points else 0.25
        label = "fallback"
        status = "insufficient_history_for_xgboost"
    else:
        confidence = 0.15
        label = "error"
        status = "prediction_error"
    return round(max(0.0, min(0.99, confidence)), 2), label, status


def _summarize(points: list[SeriesPoint]) -> tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
    if not points:
        return None, None, None, None
    values = [float(point.value) for point in points]
    return (
        round(min(values), 4),
        round(max(values), 4),
        round(values[-1] - values[0], 4) if len(values) > 1 else 0.0,
        round(values[0], 4),
    )


def _latest_xgboost_metadata(
    source: str,
    metric_type: str,
    step_minutes: int,
    model_dir: str = "models/xgboost_iot",
) -> tuple[dict, Path]:
    base_dir = _project_path(model_dir)
    if not base_dir.exists():
        raise FileNotFoundError(f"XGBoost model directory not found: {base_dir}")

    source_slug = _safe_slug(source)
    metric_slug = _safe_slug(metric_type)
    pattern = f"xgb_{source_slug}_{metric_slug}_{step_minutes}m_*.meta.json"
    candidates = sorted(base_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError(
            f"No offline XGBoost model found for source={source}, metric_type={metric_type}, step={step_minutes}m"
        )

    metadata_path = candidates[0]
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if int(metadata.get("feature_version", 0)) != MODEL_FEATURE_VERSION:
        raise ValueError(
            f"Unsupported XGBoost feature version: {metadata.get('feature_version')}; "
            f"expected {MODEL_FEATURE_VERSION}"
        )
    return metadata, metadata_path


def _load_offline_xgboost_model(
    source: str,
    metric_type: str,
    step_minutes: int,
    model_dir: str = "models/xgboost_iot",
) -> tuple[xgb.Booster, dict, Path]:
    metadata, metadata_path = _latest_xgboost_metadata(source, metric_type, step_minutes, model_dir=model_dir)
    model_path = Path(metadata.get("model_path", ""))
    if not model_path.exists():
        sibling = metadata_path.with_name(metadata_path.name.replace(".meta.json", ".model.json"))
        if sibling.exists():
            model_path = sibling
        else:
            model_path = metadata_path.parent / Path(metadata.get("model_path", "")).name
    if not model_path.exists():
        raise FileNotFoundError(f"Offline XGBoost model file not found: {metadata.get('model_path')}")

    booster = xgb.Booster()
    booster.load_model(str(model_path))
    return booster, metadata, metadata_path


class PredictionService:
    """Train and generate short-horizon IoT forecasts."""

    @staticmethod
    def train_offline_model(
        db: Session,
        source: str,
        metric_type: str,
        history_days: int = 60,
        step_minutes: int = 5,
        model_dir: str = "models/xgboost_iot",
        max_training_points: int = OFFLINE_MAX_TRAINING_POINTS,
        boost_rounds: int = 160,
    ) -> dict:
        """Train and save an offline XGBoost model for one source + metric type."""
        step_minutes = max(1, min(30, int(step_minutes)))
        history_days = max(1, min(365, int(history_days)))
        max_training_points = max(MIN_TRAINING_POINTS, int(max_training_points))

        rows, data_source, points, unit, debug_metadata = _best_training_series(
            db=db,
            metric_type=metric_type,
            source=source,
            history_days=history_days,
            step_minutes=step_minutes,
            max_rows=max_training_points,
        )
        if len(points) < MIN_TRAINING_POINTS:
            raise ValueError(
                f"Not enough training points for offline XGBoost: {len(points)} points, "
                f"need at least {MIN_TRAINING_POINTS}."
            )

        train_points = points[-max_training_points:]
        booster, report = _train_xgboost(
            train_points,
            max_points=max_training_points,
            boost_rounds=boost_rounds,
        )

        output_dir = _project_path(model_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        created_at = datetime.now(VN_TZ)
        model_stem = (
            f"xgb_{_safe_slug(source)}_{_safe_slug(metric_type)}_"
            f"{step_minutes}m_{created_at.strftime('%Y%m%d_%H%M%S')}"
        )
        model_path = output_dir / f"{model_stem}.model.json"
        metadata_path = output_dir / f"{model_stem}.meta.json"
        booster.save_model(str(model_path))

        metadata = {
            "model_type": "XGBoostRegressor",
            "feature_version": MODEL_FEATURE_VERSION,
            "source": source,
            "metric_type": metric_type,
            "unit": _unit_for_metric(metric_type) or unit,
            "step_minutes": step_minutes,
            "history_days": history_days,
            "data_source": data_source,
            "debug_metadata": debug_metadata,
            "training_points": len(train_points),
            "raw_rows": len(rows),
            "cleaned_points": len(points),
            "lag_steps": list(LAG_STEPS),
            "feature_count": report.feature_count,
            "train_rows": report.train_rows,
            "validation_rows": report.validation_rows,
            "best_iteration": report.best_iteration,
            "best_score": report.best_score,
            "train_rmse": report.train_rmse,
            "validation_rmse": report.validation_rmse,
            "train_mae": report.train_mae,
            "validation_mae": report.validation_mae,
            "model_path": str(model_path),
            "metadata_path": str(metadata_path),
            "start_time": train_points[0].ts.isoformat(),
            "end_time": train_points[-1].ts.isoformat(),
            "boost_rounds": boost_rounds,
            "created_at": created_at.isoformat(),
        }
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        return metadata

    @staticmethod
    def predict(
        db: Session,
        source: str,
        metric_type: str,
        horizon_minutes: int = 30,
        step_minutes: int = 5,
        history_days: int = 14,
    ) -> ForecastResult:
        try:
            horizon_minutes = max(5, min(180, int(horizon_minutes)))
            step_minutes = max(1, min(30, int(step_minutes)))
            history_days = max(1, min(60, int(history_days)))
            cache_key = (source, metric_type, horizon_minutes, step_minutes, history_days)

            now = time.time()
            cached = _cache_get(cache_key, now)
            if cached:
                return cached

            unit = _unit_for_metric(metric_type)
            try:
                booster, metadata, metadata_path = _load_offline_xgboost_model(
                    source=source,
                    metric_type=metric_type,
                    step_minutes=step_minutes,
                )
                seed_rows, seed_source, points, seed_unit, debug_metadata = _best_training_series(
                    db=db,
                    metric_type=metric_type,
                    source=source,
                    history_days=min(history_days, 14),
                    step_minutes=step_minutes,
                )
                method = "xgboost_offline"
                data_source = f"{seed_source}+offline_model"
                debug_metadata = {**debug_metadata, "data_source": data_source}
                unit = unit or metadata.get("unit") or seed_unit
                training_points = int(metadata.get("training_points") or len(points))
                prediction_points = _xgboost_model_forecast(
                    booster,
                    points[-MAX_TRAINING_POINTS:],
                    horizon_minutes,
                    step_minutes,
                    metric_type,
                    best_iteration=metadata.get("best_iteration"),
                )
            except Exception as offline_exc:
                rows, data_source, points, seed_unit, debug_metadata = _best_training_series(
                    db=db,
                    metric_type=metric_type,
                    source=source,
                    history_days=history_days,
                    step_minutes=step_minutes,
                )

                unit = unit or seed_unit
                training_points = len(points)
                if len(points) >= MIN_TRAINING_POINTS:
                    try:
                        method = "xgboost"
                        prediction_points = _xgboost_forecast(points, horizon_minutes, step_minutes, metric_type)
                        data_source = f"{data_source}+online_warmup"
                        debug_metadata = {**debug_metadata, "data_source": data_source}
                    except Exception:
                        method = "trend_fallback"
                        prediction_points = _trend_forecast(points, horizon_minutes, step_minutes, metric_type)
                        data_source = f"{data_source}+fallback_after_xgboost_error"
                        debug_metadata = {**debug_metadata, "data_source": data_source}
                else:
                    method = "trend_fallback"
                    prediction_points = _trend_forecast(points, horizon_minutes, step_minutes, metric_type)
                    data_source = f"{data_source}+no_offline_model"
                    debug_metadata = {**debug_metadata, "data_source": data_source}

            latest_live_value = _safe_latest_live_value(db, source, metric_type)
            prediction_points = _align_forecast_to_live(
                prediction_points=prediction_points,
                training_points=points,
                latest_value=latest_live_value,
                step_minutes=step_minutes,
                metric_type=metric_type,
            )
            prediction_points = _stabilize_short_horizon_forecast(
                prediction_points=prediction_points,
                training_points=points,
                latest_value=latest_live_value,
                horizon_minutes=horizon_minutes,
                step_minutes=step_minutes,
                metric_type=metric_type,
            )
            if method.startswith("xgboost"):
                data_source = f"{data_source}+short_horizon_guardrails"
                debug_metadata = {**debug_metadata, "data_source": data_source}

            confidence, quality_label, model_status = _score_quality(method, data_source, len(points))
            forecast_min, forecast_max, forecast_delta, next_predicted_value = _summarize(prediction_points)

            result = ForecastResult(
                method=method,
                data_source=data_source,
                source=source,
                metric_type=metric_type,
                unit=unit,
                training_points=training_points,
                generated_at=datetime.now(VN_TZ),
                predictions=_format_predictions(prediction_points),
                model_status=model_status,
                confidence_score=confidence,
                quality_label=quality_label,
                forecast_min=forecast_min,
                forecast_max=forecast_max,
                forecast_delta=forecast_delta,
                next_predicted_value=next_predicted_value,
                debug_metadata=debug_metadata,
            )
            _cache_set(cache_key, result, now)
            return result
        except Exception as exc:
            db.rollback()
            prediction_points = _trend_forecast([], horizon_minutes, step_minutes, metric_type)
            forecast_min, forecast_max, forecast_delta, next_predicted_value = _summarize(prediction_points)
            return ForecastResult(
                method="trend_fallback",
                data_source="generated_safe_fallback",
                source=source,
                metric_type=metric_type,
                unit=_unit_for_metric(metric_type),
                training_points=0,
                generated_at=datetime.now(VN_TZ),
                predictions=_format_predictions(prediction_points),
                model_status="prediction_error_safe_fallback",
                confidence_score=0.15,
                quality_label="fallback",
                forecast_min=forecast_min,
                forecast_max=forecast_max,
                forecast_delta=forecast_delta,
                next_predicted_value=next_predicted_value,
                debug_metadata={
                    "metrics_rows": 0,
                    "thongke_rows": 0,
                    "merged_rows": 0,
                    "aggregated_points": 0,
                    "data_source": "generated_safe_fallback",
                },
                error=f"{type(exc).__name__}: {exc}",
            )
