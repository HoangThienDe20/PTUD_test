"""Offline TFT training service for dashboard weather forecasts.

The service prepares a clean hourly Meteostat dataset from weather_historical
and trains a Temporal Fusion Transformer when the optional deep-learning
dependencies are installed.
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import IoTDevice, WeatherHistorical


VN_TZ = timezone(timedelta(hours=7))

WEATHER_COLUMNS = [
    "temperature_c",
    "dew_point_c",
    "relative_humidity",
    "precipitation_mm",
    "snow_mm",
    "wind_direction_deg",
    "wind_speed_kmh",
    "wind_peak_kmh",
    "pressure_hpa",
    "sunshine_minutes",
    "condition_code",
]

WEATHER_COLUMN_RANGES = {
    "temperature_c": (-20.0, 55.0),
    "dew_point_c": (-30.0, 40.0),
    "relative_humidity": (0.0, 100.0),
    "precipitation_mm": (0.0, 500.0),
    "snow_mm": (0.0, 500.0),
    "wind_direction_deg": (0.0, 360.0),
    "wind_speed_kmh": (0.0, 220.0),
    "wind_peak_kmh": (0.0, 260.0),
    "pressure_hpa": (850.0, 1100.0),
    "sunshine_minutes": (0.0, 60.0),
    "condition_code": (-100.0, 200.0),
}

PREFERRED_WEATHER_PROVIDERS = ["meteostat", "synthetic"]

DEFAULT_TARGET_BY_DEVICE_TYPE = {
    "temperature": "temperature_c",
    "humidity": "relative_humidity",
    "pressure": "pressure_hpa",
    # Meteostat sunshine is often sparse, so light devices default to weather
    # temperature unless the caller explicitly chooses sunshine_minutes.
    "light_intensity": "temperature_c",
}


@dataclass
class TFTDatasetSummary:
    device_id: int
    source: str
    data_provider: str
    target_column: str
    rows: int
    start_time: Optional[str]
    end_time: Optional[str]
    min_value: Optional[float]
    max_value: Optional[float]
    missing_target_rows: int
    recommended_encoder_length: int
    recommended_prediction_length: int


@dataclass
class TFTTrainingResult:
    device_id: int
    source: str
    target_column: str
    rows: int
    checkpoint_path: str
    metadata_path: str
    encoder_length: int
    prediction_length: int
    max_epochs: int
    created_at: str
    validation_loss: Optional[float]
    best_epoch: Optional[int]


class TFTTrainingService:
    """Prepare Meteostat data and train a TFT checkpoint offline."""

    _FEATURE_NAME_WARNING = (
        r"X does not have valid feature names, but StandardScaler was fitted with feature names"
    )

    @staticmethod
    def _resolve_weather_provider(db: Session, device: IoTDevice) -> str:
        for provider in PREFERRED_WEATHER_PROVIDERS:
            count = (
                db.query(func.count(WeatherHistorical.id))
                .filter(WeatherHistorical.device_id == device.id)
                .filter(WeatherHistorical.provider == provider)
                .scalar()
            )
            if int(count or 0) > 0:
                return provider
        raise ValueError(
            f"No weather cache found for device_id={device.id}. "
            "Run sync_meteostat_history.py or generate_synthetic_weather.py first."
        )

    @staticmethod
    def resolve_target_column(device: IoTDevice, target_column: Optional[str] = None) -> str:
        if target_column:
            if target_column not in WEATHER_COLUMNS:
                raise ValueError(f"Unsupported target_column '{target_column}'")
            return target_column
        return DEFAULT_TARGET_BY_DEVICE_TYPE.get(device.device_type, "temperature_c")

    @staticmethod
    def _clean_weather_series(series: pd.Series, column: str) -> pd.Series:
        values = pd.to_numeric(series, errors="coerce")
        values = values.interpolate(limit_direction="both").ffill().bfill()
        if values.isna().all():
            values = pd.Series(0.0, index=series.index)
        else:
            values = values.fillna(0.0)

        bounds = WEATHER_COLUMN_RANGES.get(column)
        if bounds:
            values = values.clip(lower=bounds[0], upper=bounds[1])

        if len(values) >= 24 and column not in {"precipitation_mm", "snow_mm", "condition_code", "wind_direction_deg"}:
            rolling_median = values.rolling(window=24, min_periods=6, center=True).median()
            residual = (values - rolling_median).abs()
            mad = residual.rolling(window=24, min_periods=6, center=True).median()
            fallback_limit = max(1.0, float(values.quantile(0.95) - values.quantile(0.05)) * 0.35)
            dynamic_limit = (mad.fillna(0.0) * 6.0).clip(lower=fallback_limit)
            upper = rolling_median + dynamic_limit
            lower = rolling_median - dynamic_limit
            mask = rolling_median.notna()
            bounded = values.copy()
            bounded.loc[mask] = np.minimum(
                np.maximum(values.loc[mask].to_numpy(), lower.loc[mask].to_numpy()),
                upper.loc[mask].to_numpy(),
            )
            values = bounded

        if bounds:
            values = values.clip(lower=bounds[0], upper=bounds[1])
        return values.astype(float)

    @staticmethod
    def add_time_features(frame: pd.DataFrame) -> pd.DataFrame:
        frame = frame.copy()
        frame["event_ts"] = pd.to_datetime(frame["event_ts"])
        frame["hour"] = frame["event_ts"].dt.hour.astype(int)
        frame["day_of_week"] = frame["event_ts"].dt.dayofweek.astype(int)
        frame["month"] = frame["event_ts"].dt.month.astype(int)
        frame["day_of_year"] = frame["event_ts"].dt.dayofyear.astype(int)
        frame["is_weekend"] = frame["day_of_week"].isin([5, 6]).astype(int)
        frame["hour_sin"] = np.sin(2 * np.pi * frame["hour"] / 24.0)
        frame["hour_cos"] = np.cos(2 * np.pi * frame["hour"] / 24.0)
        frame["day_of_week_sin"] = np.sin(2 * np.pi * frame["day_of_week"] / 7.0)
        frame["day_of_week_cos"] = np.cos(2 * np.pi * frame["day_of_week"] / 7.0)
        frame["month_sin"] = np.sin(2 * np.pi * (frame["month"] - 1) / 12.0)
        frame["month_cos"] = np.cos(2 * np.pi * (frame["month"] - 1) / 12.0)
        frame["day_of_year_sin"] = np.sin(2 * np.pi * (frame["day_of_year"] - 1) / 366.0)
        frame["day_of_year_cos"] = np.cos(2 * np.pi * (frame["day_of_year"] - 1) / 366.0)
        return frame

    @staticmethod
    def get_dataset_summary(
        db: Session,
        device: IoTDevice,
        target_column: Optional[str] = None,
        horizon_hours: int = 72,
    ) -> TFTDatasetSummary:
        target = TFTTrainingService.resolve_target_column(device, target_column)
        provider = TFTTrainingService._resolve_weather_provider(db, device)
        target_attr = getattr(WeatherHistorical, target)
        row = (
            db.query(
                func.count(WeatherHistorical.id),
                func.min(WeatherHistorical.event_ts),
                func.max(WeatherHistorical.event_ts),
                func.min(target_attr),
                func.max(target_attr),
                func.count(target_attr),
            )
            .filter(WeatherHistorical.device_id == device.id)
            .filter(WeatherHistorical.provider == provider)
            .one()
        )
        total_rows = int(row[0] or 0)
        non_null_rows = int(row[5] or 0)
        recommended_prediction = max(1, min(horizon_hours, max(1, total_rows // 4)))
        recommended_encoder = max(12, min(168, max(12, total_rows - recommended_prediction - 1)))
        return TFTDatasetSummary(
            device_id=device.id,
            source=device.source,
            data_provider=provider,
            target_column=target,
            rows=total_rows,
            start_time=row[1].isoformat() if row[1] else None,
            end_time=row[2].isoformat() if row[2] else None,
            min_value=float(row[3]) if row[3] is not None else None,
            max_value=float(row[4]) if row[4] is not None else None,
            missing_target_rows=total_rows - non_null_rows,
            recommended_encoder_length=recommended_encoder,
            recommended_prediction_length=recommended_prediction,
        )

    @staticmethod
    def build_weather_frame(
        db: Session,
        device: IoTDevice,
        target_column: Optional[str] = None,
        min_rows: int = 96,
    ) -> pd.DataFrame:
        target = TFTTrainingService.resolve_target_column(device, target_column)
        provider = TFTTrainingService._resolve_weather_provider(db, device)
        rows = (
            db.query(WeatherHistorical)
            .filter(WeatherHistorical.device_id == device.id)
            .filter(WeatherHistorical.provider == provider)
            .order_by(WeatherHistorical.event_ts.asc())
            .all()
        )
        if not rows:
            raise ValueError(
                f"No weather cache found for device_id={device.id}. "
                "Run sync_meteostat_history.py or generate_synthetic_weather.py first."
            )

        records = []
        for row in rows:
            record = {
                "event_ts": row.event_ts,
                "series_id": f"device_{device.id}_{target}",
                "device_id": device.id,
                "source": device.source,
                "device_type": device.device_type or "unknown",
                "environment_type": device.environment_type or "unknown",
            }
            for column in WEATHER_COLUMNS:
                record[column] = getattr(row, column)
            records.append(record)

        frame = pd.DataFrame.from_records(records)
        frame["event_ts"] = pd.to_datetime(frame["event_ts"])
        frame = frame.drop_duplicates(subset=["event_ts"]).sort_values("event_ts")

        full_index = pd.date_range(frame["event_ts"].min(), frame["event_ts"].max(), freq="h")
        frame = frame.set_index("event_ts").reindex(full_index)
        frame.index.name = "event_ts"

        static_values = {
            "series_id": f"device_{device.id}_{target}",
            "device_id": device.id,
            "source": device.source,
            "device_type": device.device_type or "unknown",
            "environment_type": device.environment_type or "unknown",
        }
        for column, value in static_values.items():
            frame[column] = frame[column].fillna(value)

        for column in WEATHER_COLUMNS:
            if column == target and frame[column].isna().all():
                raise ValueError(
                    f"Target column '{target}' has no usable values for device_id={device.id}."
                )
            frame[column] = TFTTrainingService._clean_weather_series(frame[column], column)

        frame = frame.reset_index()
        frame = frame.dropna(subset=[target]).copy()
        if len(frame) < min_rows:
            raise ValueError(
                f"Not enough rows for TFT training: {len(frame)} rows after cleaning, "
                f"need at least {min_rows}. Sync more Meteostat history."
            )

        start_ts = frame["event_ts"].min()
        frame["time_idx"] = ((frame["event_ts"] - start_ts) / pd.Timedelta(hours=1)).astype(int)
        frame = TFTTrainingService.add_time_features(frame)
        frame["target_value"] = frame[target].astype(float)

        text_columns = ["series_id", "source", "device_type", "environment_type"]
        for column in text_columns:
            frame[column] = frame[column].astype(str).fillna("unknown")

        frame.attrs["data_provider"] = provider
        return frame

    @staticmethod
    def _load_tft_dependencies():
        try:
            from lightning.pytorch import Trainer
            from lightning.pytorch.callbacks import EarlyStopping, ModelCheckpoint
        except ImportError:
            try:
                from pytorch_lightning import Trainer
                from pytorch_lightning.callbacks import EarlyStopping, ModelCheckpoint
            except ImportError as exc:
                raise RuntimeError(
                    "Missing TFT training dependencies. Install them with: "
                    "venv\\Scripts\\python.exe -m pip install torch lightning "
                    "pytorch-forecasting scikit-learn"
                ) from exc

        try:
            from pytorch_forecasting import TemporalFusionTransformer, TimeSeriesDataSet
            from pytorch_forecasting.metrics import QuantileLoss
        except ImportError as exc:
            raise RuntimeError(
                "Missing pytorch-forecasting. Install it with: "
                "venv\\Scripts\\python.exe -m pip install pytorch-forecasting"
            ) from exc

        return Trainer, EarlyStopping, ModelCheckpoint, TemporalFusionTransformer, TimeSeriesDataSet, QuantileLoss

    @staticmethod
    def train_weather_tft(
        db: Session,
        device: IoTDevice,
        target_column: Optional[str] = None,
        output_dir: str = "models/tft_dashboard",
        horizon_hours: int = 72,
        encoder_hours: int = 168,
        max_epochs: int = 40,
        batch_size: int = 32,
        learning_rate: float = 0.01,
        hidden_size: int = 32,
        attention_head_size: int = 4,
        min_rows: int = 96,
        early_stopping_patience: int = 8,
    ) -> TFTTrainingResult:
        target = TFTTrainingService.resolve_target_column(device, target_column)
        frame = TFTTrainingService.build_weather_frame(
            db=db,
            device=device,
            target_column=target,
            min_rows=min_rows,
        )

        Trainer, EarlyStopping, ModelCheckpoint, TemporalFusionTransformer, TimeSeriesDataSet, QuantileLoss = (
            TFTTrainingService._load_tft_dependencies()
        )

        max_available = max(1, len(frame) - 2)
        prediction_length = max(1, min(horizon_hours, max_available // 4))
        encoder_length = max(12, min(encoder_hours, max_available - prediction_length))
        training_cutoff = int(frame["time_idx"].max() - prediction_length)
        if training_cutoff <= encoder_length:
            raise ValueError(
                "Not enough history for the requested TFT window. "
                f"rows={len(frame)}, encoder={encoder_length}, prediction={prediction_length}"
            )

        known_reals = [
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
        usable_weather_columns = [
            column
            for column in WEATHER_COLUMNS
            if column != target and frame[column].notna().any() and frame[column].nunique(dropna=True) > 1
        ]
        unknown_reals = ["target_value"] + usable_weather_columns

        training = TimeSeriesDataSet(
            frame[frame.time_idx <= training_cutoff],
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
        validation = TimeSeriesDataSet.from_dataset(
            training,
            frame,
            min_prediction_idx=training_cutoff + 1,
            stop_randomization=True,
        )

        train_loader = training.to_dataloader(train=True, batch_size=batch_size, num_workers=0)
        val_loader = validation.to_dataloader(train=False, batch_size=batch_size, num_workers=0)

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        model_stem = f"tft_device{device.id}_{target}_{datetime.now(VN_TZ).strftime('%Y%m%d_%H%M%S')}"
        checkpoint_callback = ModelCheckpoint(
            dirpath=str(output_path),
            filename=model_stem + "-{epoch:02d}-{val_loss:.4f}",
            monitor="val_loss",
            mode="min",
            save_top_k=1,
        )
        early_stop_callback = EarlyStopping(
            monitor="val_loss",
            min_delta=1e-4,
            patience=early_stopping_patience,
            mode="min",
        )

        trainer = Trainer(
            max_epochs=max_epochs,
            accelerator="auto",
            gradient_clip_val=0.1,
            callbacks=[early_stop_callback, checkpoint_callback],
            logger=False,
            enable_checkpointing=True,
            enable_model_summary=False,
            enable_progress_bar=False,
            log_every_n_steps=10,
        )
        model = TemporalFusionTransformer.from_dataset(
            training,
            learning_rate=learning_rate,
            hidden_size=hidden_size,
            attention_head_size=attention_head_size,
            dropout=0.12,
            hidden_continuous_size=max(8, hidden_size // 2),
            loss=QuantileLoss(),
            optimizer="adam",
        )
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=TFTTrainingService._FEATURE_NAME_WARNING,
                category=UserWarning,
            )
            trainer.fit(model, train_dataloaders=train_loader, val_dataloaders=val_loader)

        checkpoint_path = checkpoint_callback.best_model_path
        if not checkpoint_path:
            checkpoint_path = str(output_path / f"{model_stem}.ckpt")
            trainer.save_checkpoint(checkpoint_path)

        created_at = datetime.now(VN_TZ).isoformat()
        best_score = checkpoint_callback.best_model_score
        if hasattr(best_score, "detach"):
            validation_loss = float(best_score.detach().cpu().item())
        elif best_score is not None:
            validation_loss = float(best_score)
        else:
            validation_loss = None
        target_values = pd.to_numeric(frame[target], errors="coerce").dropna()
        metadata = {
            "model_type": "TemporalFusionTransformer",
            "phase": 3,
            "data_provider": frame.attrs.get("data_provider", "unknown"),
            "device_id": device.id,
            "source": device.source,
            "device_type": device.device_type,
            "environment_type": device.environment_type,
            "target_column": target,
            "rows": len(frame),
            "start_time": frame["event_ts"].min().isoformat(),
            "end_time": frame["event_ts"].max().isoformat(),
            "checkpoint_path": checkpoint_path,
            "encoder_length": encoder_length,
            "prediction_length": prediction_length,
            "training_cutoff": training_cutoff,
            "train_rows": int((frame.time_idx <= training_cutoff).sum()),
            "validation_rows": int((frame.time_idx > training_cutoff).sum()),
            "validation_loss": validation_loss,
            "best_epoch": int(trainer.current_epoch) if trainer.current_epoch is not None else None,
            "best_model_path": checkpoint_callback.best_model_path,
            "known_reals": known_reals,
            "unknown_reals": unknown_reals,
            "dropped_constant_or_empty_weather_columns": [
                column for column in WEATHER_COLUMNS if column != target and column not in usable_weather_columns
            ],
            "target_min": float(target_values.min()) if not target_values.empty else None,
            "target_max": float(target_values.max()) if not target_values.empty else None,
            "target_mean": float(target_values.mean()) if not target_values.empty else None,
            "target_std": float(target_values.std()) if len(target_values) > 1 else None,
            "weather_column_ranges": WEATHER_COLUMN_RANGES,
            "hyperparameters": {
                "learning_rate": learning_rate,
                "hidden_size": hidden_size,
                "attention_head_size": attention_head_size,
                "hidden_continuous_size": max(8, hidden_size // 2),
                "dropout": 0.12,
                "batch_size": batch_size,
                "max_epochs": max_epochs,
                "early_stopping_patience": early_stopping_patience,
            },
            "created_at": created_at,
        }
        metadata_path = str(output_path / f"{model_stem}.json")
        Path(metadata_path).write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        return TFTTrainingResult(
            device_id=device.id,
            source=device.source,
            target_column=target,
            rows=len(frame),
            checkpoint_path=checkpoint_path,
            metadata_path=metadata_path,
            encoder_length=encoder_length,
            prediction_length=prediction_length,
            max_epochs=max_epochs,
            created_at=created_at,
            validation_loss=validation_loss,
            best_epoch=int(trainer.current_epoch) if trainer.current_epoch is not None else None,
        )

