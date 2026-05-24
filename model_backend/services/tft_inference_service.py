"""Load trained TFT checkpoints and generate Dashboard forecasts."""

from __future__ import annotations

import json
import math
import re
import warnings
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from models import IoTDevice
from services.tft_training_service import TFTTrainingService, WEATHER_COLUMNS, WEATHER_COLUMN_RANGES


VN_TZ = timezone(timedelta(hours=7))


@dataclass
class TFTForecastResult:
    target_column: str
    data_source: str
    checkpoint_path: str
    metadata_path: str
    rows: int
    prediction_length: int
    predictions: list[dict]


def _now_hour() -> datetime:
    return datetime.now(VN_TZ).replace(minute=0, second=0, microsecond=0)


class TFTInferenceService:
    """Inference helper for Phase 4 Dashboard forecast."""

    @staticmethod
    def _validation_loss_from_metadata(metadata: dict) -> Optional[float]:
        value = metadata.get("validation_loss")
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                pass

        checkpoint_path = str(metadata.get("checkpoint_path") or "")
        match = re.search(r"val_loss=([0-9.]+)", checkpoint_path)
        if match:
            try:
                return float(match.group(1).rstrip("."))
            except ValueError:
                return None
        return None

    @staticmethod
    def _resolve_checkpoint_path(metadata: dict, metadata_path: Path) -> Path:
        checkpoint_path = Path(metadata.get("checkpoint_path", ""))
        if checkpoint_path.exists():
            return checkpoint_path

        sibling = metadata_path.with_suffix(".ckpt")
        if sibling.exists():
            return sibling

        matched = sorted(
            metadata_path.parent.glob(metadata_path.stem + "*.ckpt"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if matched:
            return matched[0]

        raise FileNotFoundError(f"TFT checkpoint not found for {metadata_path}")

    @staticmethod
    def _latest_metadata(
        device: IoTDevice,
        target_column: str,
        model_dir: str = "models/tft_dashboard",
    ) -> tuple[dict, Path]:
        base_dir = Path(model_dir)
        if not base_dir.exists() and not base_dir.is_absolute():
            project_root = Path(__file__).resolve().parents[2]
            project_model_dir = project_root / model_dir
            if project_model_dir.exists():
                base_dir = project_model_dir
        if not base_dir.exists():
            raise FileNotFoundError(f"TFT model directory not found: {model_dir}")

        patterns = [
            f"tft_device{device.id}_{target_column}_*.json",
            f"tft_device{device.id}_*.json",
        ]
        candidates: list[Path] = []
        for pattern in patterns:
            candidates.extend(base_dir.glob(pattern))
            if candidates:
                break

        if not candidates:
            raise FileNotFoundError(
                f"No TFT metadata found for device_id={device.id}, target={target_column}"
            )

        usable_candidates = []
        for metadata_path in candidates:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            checkpoint_path = TFTInferenceService._resolve_checkpoint_path(metadata, metadata_path)
            metadata["checkpoint_path"] = str(checkpoint_path)
            validation_loss = TFTInferenceService._validation_loss_from_metadata(metadata)
            usable_candidates.append(
                {
                    "metadata": metadata,
                    "metadata_path": metadata_path,
                    "has_score": validation_loss is not None,
                    "validation_loss": validation_loss if validation_loss is not None else float("inf"),
                    "mtime": metadata_path.stat().st_mtime,
                }
            )

        selected = sorted(
            usable_candidates,
            key=lambda item: (
                0 if item["has_score"] else 1,
                item["validation_loss"],
                -item["mtime"],
            ),
        )[0]
        return selected["metadata"], selected["metadata_path"]

    @staticmethod
    def _load_dependencies():
        try:
            from pytorch_forecasting import TemporalFusionTransformer, TimeSeriesDataSet
        except ImportError as exc:
            raise RuntimeError(
                "Missing TFT inference dependencies. Install requirements.txt again."
            ) from exc
        return TemporalFusionTransformer, TimeSeriesDataSet

    @staticmethod
    def _estimate_future_value(frame: pd.DataFrame, column: str, event_ts: pd.Timestamp) -> float:
        if column not in frame.columns:
            return 0.0
        same_hour = frame[frame["event_ts"].dt.hour == event_ts.hour][column].dropna()
        if len(same_hour) > 0:
            return float(same_hour.tail(14).mean())
        values = frame[column].dropna()
        if len(values) > 0:
            return float(values.tail(24).mean())
        return 0.0

    @staticmethod
    def _append_future_rows(
        frame: pd.DataFrame,
        target_column: str,
        hours: int,
    ) -> pd.DataFrame:
        next_rows = []
        max_time_idx = int(frame["time_idx"].max())
        last_event_ts = pd.to_datetime(frame["event_ts"].max())
        static = {
            "series_id": str(frame["series_id"].iloc[-1]),
            "device_id": int(frame["device_id"].iloc[-1]),
            "source": str(frame["source"].iloc[-1]),
            "device_type": str(frame["device_type"].iloc[-1]),
            "environment_type": str(frame["environment_type"].iloc[-1]),
        }

        for step in range(1, hours + 1):
            event_ts = last_event_ts + pd.Timedelta(hours=step)
            record = {
                **static,
                "event_ts": event_ts,
                "time_idx": max_time_idx + step,
                "hour": int(event_ts.hour),
                "day_of_week": int(event_ts.dayofweek),
                "month": int(event_ts.month),
                "is_weekend": int(event_ts.dayofweek in [5, 6]),
            }
            for column in WEATHER_COLUMNS:
                record[column] = TFTInferenceService._estimate_future_value(frame, column, event_ts)
            record["target_value"] = record[target_column]
            next_rows.append(record)

        combined = pd.concat([frame, pd.DataFrame(next_rows)], ignore_index=True)
        combined = TFTTrainingService.add_time_features(combined)
        return combined

    @staticmethod
    def _build_dataset(metadata: dict, historical_frame: pd.DataFrame, prediction_frame: pd.DataFrame):
        _, TimeSeriesDataSet = TFTInferenceService._load_dependencies()
        prediction_length = int(metadata.get("prediction_length") or 24)
        encoder_length = int(metadata.get("encoder_length") or 48)
        training_cutoff = int(historical_frame["time_idx"].max() - prediction_length)
        if training_cutoff <= encoder_length:
            training_cutoff = int(historical_frame["time_idx"].max() - max(1, prediction_length // 2))

        known_reals = metadata.get("known_reals") or [
            "time_idx",
            "hour",
            "day_of_week",
            "month",
            "day_of_year",
            "is_weekend",
            "hour_sin",
            "hour_cos",
            "day_of_week_sin",
            "day_of_week_cos",
            "month_sin",
            "month_cos",
            "day_of_year_sin",
            "day_of_year_cos",
        ]
        unknown_reals = metadata.get("unknown_reals") or ["target_value"]

        training = TimeSeriesDataSet(
            historical_frame[historical_frame.time_idx <= training_cutoff],
            time_idx="time_idx",
            target="target_value",
            group_ids=["series_id"],
            min_encoder_length=max(1, encoder_length // 2),
            max_encoder_length=encoder_length,
            min_prediction_length=1,
            max_prediction_length=prediction_length,
            static_categoricals=["series_id", "device_type", "environment_type"],
            time_varying_known_reals=known_reals,
            time_varying_unknown_reals=unknown_reals,
            add_relative_time_idx=True,
            add_target_scales=True,
            add_encoder_length=True,
        )
        return TimeSeriesDataSet.from_dataset(training, prediction_frame, predict=True, stop_randomization=True)

    @staticmethod
    def _predict_chunk(metadata: dict, historical_frame: pd.DataFrame, prediction_frame: pd.DataFrame) -> list[float]:
        TemporalFusionTransformer, _ = TFTInferenceService._load_dependencies()
        dataset = TFTInferenceService._build_dataset(metadata, historical_frame, prediction_frame)
        loader = dataset.to_dataloader(train=False, batch_size=1, num_workers=0)
        model = TemporalFusionTransformer.load_from_checkpoint(metadata["checkpoint_path"])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            prediction = model.predict(
                loader,
                mode="prediction",
                trainer_kwargs={"logger": False, "enable_progress_bar": False},
            )
        if hasattr(prediction, "detach"):
            values = prediction.detach().cpu().numpy().reshape(-1).tolist()
        elif hasattr(prediction, "output") and hasattr(prediction.output, "detach"):
            values = prediction.output.detach().cpu().numpy().reshape(-1).tolist()
        else:
            values = pd.Series(prediction).astype(float).tolist()
        return [float(value) for value in values]

    @staticmethod
    def _predict_baseline(metadata: dict, frame: pd.DataFrame, target: str, horizon_hours: int) -> list[float]:
        target_values = pd.to_numeric(frame[target], errors="coerce").dropna()
        if target_values.empty:
            raise ValueError(f"Target column '{target}' has no usable values")

        latest_value = float(target_values.iloc[-1])
        recent = target_values.tail(72)
        trend = 0.0
        if len(recent) >= 2:
            trend = (float(recent.iloc[-1]) - float(recent.iloc[0])) / max(1, len(recent) - 1)
            trend *= 0.15

        by_hour = {
            hour: values[target].dropna().tail(30).astype(float).mean()
            for hour, values in frame.groupby(frame["event_ts"].dt.hour)
        }
        fallback_min = float(metadata.get("min_value", target_values.min()))
        fallback_max = float(metadata.get("max_value", target_values.max()))
        value_range = max(1.0, fallback_max - fallback_min)

        start = _now_hour()
        predictions: list[float] = []
        for step in range(1, horizon_hours + 1):
            event_ts = pd.Timestamp(start + timedelta(hours=step))
            seasonal = by_hour.get(event_ts.hour)
            if seasonal is None or math.isnan(float(seasonal)):
                seasonal = TFTInferenceService._estimate_future_value(frame, target, event_ts)

            day_wave = math.sin((event_ts.hour / 24.0) * 2 * math.pi) * value_range * 0.03
            anchor_weight = max(0.25, 0.70 - step * 0.006)
            predicted = latest_value * anchor_weight + float(seasonal) * (1.0 - anchor_weight)
            predicted += trend * step + day_wave
            predictions.append(float(max(fallback_min - value_range * 0.1, min(fallback_max + value_range * 0.1, predicted))))

        return predictions

    @staticmethod
    def _clip_predictions(metadata: dict, frame: pd.DataFrame, target: str, values: list[float]) -> list[float]:
        target_values = pd.to_numeric(frame[target], errors="coerce").dropna()
        if target_values.empty:
            return [float(value) for value in values]

        train_min = metadata.get("target_min")
        train_max = metadata.get("target_max")
        if train_min is None:
            train_min = float(target_values.min())
        if train_max is None:
            train_max = float(target_values.max())

        value_range = max(1.0, float(train_max) - float(train_min))
        lower = float(train_min) - value_range * 0.15
        upper = float(train_max) + value_range * 0.15
        physical_bounds = WEATHER_COLUMN_RANGES.get(target)
        if physical_bounds:
            lower = max(lower, physical_bounds[0])
            upper = min(upper, physical_bounds[1])

        clipped = []
        for value in values:
            numeric = float(value)
            if math.isnan(numeric) or math.isinf(numeric):
                numeric = float(target_values.iloc[-1])
            clipped.append(float(max(lower, min(upper, numeric))))
        return clipped

    @staticmethod
    def predict(
        db: Session,
        device: IoTDevice,
        horizon_days: int = 3,
        model_dir: str = "models/tft_dashboard",
        target_column: Optional[str] = None,
    ) -> TFTForecastResult:
        horizon_hours = max(1, min(24 * 14, int(horizon_days) * 24))
        target = TFTTrainingService.resolve_target_column(device, target_column)
        metadata, metadata_path = TFTInferenceService._latest_metadata(device, target, model_dir=model_dir)
        target = metadata.get("target_column") or target

        base_frame = TFTTrainingService.build_weather_frame(
            db=db,
            device=device,
            target_column=target,
            min_rows=24,
        )
        prediction_length = int(metadata.get("prediction_length") or 24)
        encoder_length = int(metadata.get("encoder_length") or 48)
        min_required = encoder_length + prediction_length
        if len(base_frame) < min_required:
            raise ValueError(
                f"Insufficient weather history: {len(base_frame)} rows, "
                f"need {min_required} (encoder={encoder_length} + prediction={prediction_length})."
            )
        historical_frame = base_frame.copy()
        rolling_frame = base_frame.copy()
        if metadata.get("model_type") == "SeasonalBaselineTFT":
            generated = TFTInferenceService._predict_baseline(metadata, base_frame, target, horizon_hours)
        else:
            generated: list[float] = []

            max_chunks = horizon_hours
            chunks_done = 0
            while len(generated) < horizon_hours and chunks_done < max_chunks:
                chunk_hours = min(prediction_length, horizon_hours - len(generated))
                prediction_frame = TFTInferenceService._append_future_rows(rolling_frame, target, prediction_length)
                chunk_values = TFTInferenceService._predict_chunk(metadata, historical_frame, prediction_frame)
                if not chunk_values:
                    raise RuntimeError("TFT predict_chunk returned empty - checkpoint may be corrupt.")
                chunks_done += 1
                chunk_values = chunk_values[:chunk_hours]
                generated.extend(chunk_values)

                start_idx = len(rolling_frame)
                rolling_frame = prediction_frame.iloc[: start_idx + chunk_hours].copy()
                future_indexes = rolling_frame.tail(chunk_hours).index
                for offset, index in enumerate(future_indexes):
                    value = float(chunk_values[offset])
                    rolling_frame.loc[index, target] = value
                    rolling_frame.loc[index, "target_value"] = value

        generated = TFTInferenceService._clip_predictions(metadata, base_frame, target, generated)

        start = _now_hour()
        predictions = [
            {
                "timestamp": (start + timedelta(hours=idx + 1)).isoformat(),
                "predicted_value": round(float(value), 4),
            }
            for idx, value in enumerate(generated[:horizon_hours])
        ]

        return TFTForecastResult(
            target_column=target,
            data_source=f"{metadata.get('data_provider') or 'weather'}_weather_historical",
            checkpoint_path=str(metadata["checkpoint_path"]),
            metadata_path=str(metadata_path),
            rows=len(base_frame),
            prediction_length=prediction_length,
            predictions=predictions,
        )

