"""Persist prediction snapshots by overwriting old rows for the same scope."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from config import SAVE_PREDICTIONS

VN_TZ = timezone(timedelta(hours=7))


@dataclass
class SaveSummary:
    enabled: bool
    attempted: int
    inserted: int
    overwritten: int
    skipped_invalid: int


def _to_dt(value: str) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone(VN_TZ) if dt.tzinfo else dt.replace(tzinfo=VN_TZ)
    except Exception:
        return None


def _ensure_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS model_predictions (
              id BIGSERIAL PRIMARY KEY,
              prediction_kind VARCHAR(40) NOT NULL,
              source VARCHAR(100) NOT NULL,
              device_id INTEGER NOT NULL DEFAULT 0,
              metric_type VARCHAR(50) NOT NULL,
              method VARCHAR(64) NOT NULL,
              model_status VARCHAR(100),
              generated_at TIMESTAMP NOT NULL,
              horizon_minutes INTEGER,
              horizon_days INTEGER,
              step_minutes INTEGER,
              target_ts TIMESTAMP NOT NULL,
              predicted_value DOUBLE PRECISION NOT NULL,
              confidence_score DOUBLE PRECISION,
              quality_label VARCHAR(32),
              metadata TEXT,
              created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_model_predictions_scope
            ON model_predictions (
              prediction_kind, source, device_id, metric_type, target_ts
            )
            """
        )
    )


def save_predictions(
    db: Session,
    *,
    prediction_kind: str,
    source: str,
    metric_type: str,
    method: str,
    model_status: str,
    predictions: list[dict],
    generated_at: Optional[str] = None,
    confidence_score: Optional[float] = None,
    quality_label: Optional[str] = None,
    horizon_minutes: Optional[int] = None,
    horizon_days: Optional[int] = None,
    step_minutes: Optional[int] = None,
    device_id: Optional[int] = None,
    metadata: Optional[dict | str] = None,
) -> SaveSummary:
    if not SAVE_PREDICTIONS:
        return SaveSummary(enabled=False, attempted=0, inserted=0, overwritten=0, skipped_invalid=0)

    _ensure_table(db)
    now = datetime.now(VN_TZ)
    gen_dt = _to_dt(generated_at) if generated_at else now
    if gen_dt is None:
        gen_dt = now

    inserted = 0
    overwritten = 0
    skipped_invalid = 0
    attempted = len(predictions or [])
    scope_device_id = int(device_id or 0)
    metadata_text = None
    if metadata is not None:
        metadata_text = metadata if isinstance(metadata, str) else json.dumps(metadata, ensure_ascii=False)

    # Overwrite old rows for the same prediction scope.
    delete_result = db.execute(
        text(
            """
            DELETE FROM model_predictions
            WHERE prediction_kind = :prediction_kind
              AND source = :source
              AND device_id = :device_id
              AND metric_type = :metric_type
            """
        ),
        {
            "prediction_kind": prediction_kind,
            "source": source,
            "device_id": scope_device_id,
            "metric_type": metric_type,
        },
    )
    overwritten = int(delete_result.rowcount or 0)

    for point in predictions or []:
        target_dt = _to_dt(point.get("timestamp"))
        try:
            value = float(point.get("predicted_value"))
        except Exception:
            skipped_invalid += 1
            continue
        if target_dt is None:
            skipped_invalid += 1
            continue

        params = {
            "prediction_kind": prediction_kind,
            "source": source,
            "device_id": scope_device_id,
            "metric_type": metric_type,
            "method": method,
            "model_status": model_status,
            "generated_at": gen_dt.replace(tzinfo=None),
            "horizon_minutes": horizon_minutes,
            "horizon_days": horizon_days,
            "step_minutes": step_minutes,
            "target_ts": target_dt.replace(tzinfo=None),
            "predicted_value": value,
            "confidence_score": confidence_score,
            "quality_label": quality_label,
            "metadata": metadata_text,
        }

        db.execute(
            text(
                """
                INSERT INTO model_predictions (
                  prediction_kind, source, device_id, metric_type, method, model_status,
                  generated_at, horizon_minutes, horizon_days, step_minutes,
                  target_ts, predicted_value, confidence_score, quality_label, metadata
                ) VALUES (
                  :prediction_kind, :source, :device_id, :metric_type, :method, :model_status,
                  :generated_at, :horizon_minutes, :horizon_days, :step_minutes,
                  :target_ts, :predicted_value, :confidence_score, :quality_label, :metadata
                )
                """
            ),
            params,
        )
        inserted += 1

    db.commit()

    return SaveSummary(
        enabled=True,
        attempted=attempted,
        inserted=inserted,
        overwritten=overwritten,
        skipped_invalid=skipped_invalid,
    )
