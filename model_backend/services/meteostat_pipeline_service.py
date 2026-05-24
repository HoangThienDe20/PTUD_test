"""Meteostat historical weather ingestion for the Dashboard TFT pipeline."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from models import IoTDevice, WeatherHistorical
from services.weather_service import geocode_location


VN_TZ = timezone(timedelta(hours=7))


@dataclass
class MeteostatSyncResult:
    device_id: int
    source: str
    provider: str
    latitude: float
    longitude: float
    start_date: date
    end_date: date
    fetched_rows: int
    upserted_rows: int
    cached_rows: int
    timezone_name: Optional[str]


def _clean_float(value):
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def _parse_date(value: str | date | None, default: date) -> date:
    if value is None:
        return default
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)).date()


def _resolve_device_coordinates(db: Session, device: IoTDevice) -> tuple[float, float, Optional[str]]:
    if device.latitude is not None and device.longitude is not None:
        return float(device.latitude), float(device.longitude), device.timezone_name

    query = device.location_query or device.location
    geo = geocode_location(query) if query else None
    if geo:
        device.latitude = geo.latitude
        device.longitude = geo.longitude
        device.timezone_name = geo.timezone
        return float(device.latitude), float(device.longitude), device.timezone_name

    peer_device = (
        db.query(IoTDevice)
        .filter(IoTDevice.user_id == device.user_id)
        .filter(IoTDevice.id != device.id)
        .filter(IoTDevice.latitude.isnot(None))
        .filter(IoTDevice.longitude.isnot(None))
        .order_by(IoTDevice.id.desc())
        .first()
    )
    if peer_device:
        device.latitude = peer_device.latitude
        device.longitude = peer_device.longitude
        device.timezone_name = peer_device.timezone_name
        if not device.location_query and peer_device.location_query:
            device.location_query = peer_device.location_query
        return float(device.latitude), float(device.longitude), device.timezone_name

    raise ValueError(
        "Device has no latitude/longitude and geocoding failed. "
        "Set device location_query or coordinates before syncing Meteostat."
    )


def _fetch_meteostat_hourly(latitude: float, longitude: float, start_date: date, end_date: date):
    try:
        from meteostat import Hourly, Point
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency 'meteostat'. Install project requirements or run: "
            "venv\\Scripts\\python.exe -m pip install meteostat pandas"
        ) from exc

    start_dt = datetime.combine(start_date, time.min)
    # Meteostat Hourly end is inclusive-ish depending on station; request full end day.
    end_dt = datetime.combine(end_date, time.max.replace(microsecond=0))
    point = Point(latitude, longitude)
    data = Hourly(point, start_dt, end_dt).fetch()
    if data is None or data.empty:
        return []
    return list(data.iterrows())


class MeteostatPipelineService:
    """Fetch and cache Meteostat hourly history for IoT devices."""

    @staticmethod
    def sync_device_history(
        db: Session,
        device: IoTDevice,
        start_date: str | date | None = None,
        end_date: str | date | None = None,
    ) -> MeteostatSyncResult:
        today = datetime.now(VN_TZ).date()
        resolved_end = _parse_date(end_date, today - timedelta(days=1))
        resolved_start = _parse_date(start_date, resolved_end - timedelta(days=365))
        if resolved_start > resolved_end:
            raise ValueError("start_date must be before or equal to end_date")

        latitude, longitude, timezone_name = _resolve_device_coordinates(db, device)
        rows = _fetch_meteostat_hourly(latitude, longitude, resolved_start, resolved_end)

        now = datetime.now(VN_TZ).replace(tzinfo=None)
        values = []
        for ts, row in rows:
            if hasattr(ts, "to_pydatetime"):
                event_ts = ts.to_pydatetime()
            else:
                event_ts = ts
            if event_ts.tzinfo is not None:
                event_ts = event_ts.astimezone(VN_TZ).replace(tzinfo=None)

            values.append(
                {
                    "device_id": device.id,
                    "source": device.source,
                    "provider": "meteostat",
                    "station_id": None,
                    "event_ts": event_ts,
                    "latitude": latitude,
                    "longitude": longitude,
                    "timezone_name": timezone_name,
                    "temperature_c": _clean_float(row.get("temp")),
                    "dew_point_c": _clean_float(row.get("dwpt")),
                    "relative_humidity": _clean_float(row.get("rhum")),
                    "precipitation_mm": _clean_float(row.get("prcp")),
                    "snow_mm": _clean_float(row.get("snow")),
                    "wind_direction_deg": _clean_float(row.get("wdir")),
                    "wind_speed_kmh": _clean_float(row.get("wspd")),
                    "wind_peak_kmh": _clean_float(row.get("wpgt")),
                    "pressure_hpa": _clean_float(row.get("pres")),
                    "sunshine_minutes": _clean_float(row.get("tsun")),
                    "condition_code": _clean_float(row.get("coco")),
                    "created_at": now,
                    "updated_at": now,
                }
            )

        upserted_rows = 0
        if values:
            table = WeatherHistorical.__table__
            stmt = insert(table).values(values)
            update_columns = {
                col.name: getattr(stmt.excluded, col.name)
                for col in table.columns
                if col.name not in {"id", "device_id", "provider", "event_ts", "created_at"}
            }
            update_columns["updated_at"] = now
            stmt = stmt.on_conflict_do_update(
                constraint="uq_weather_device_provider_ts",
                set_=update_columns,
            )
            result = db.execute(stmt)
            db.commit()
            upserted_rows = result.rowcount or len(values)

        cached_rows = (
            db.query(func.count(WeatherHistorical.id))
            .filter(
                WeatherHistorical.device_id == device.id,
                WeatherHistorical.provider == "meteostat",
            )
            .scalar()
            or 0
        )

        return MeteostatSyncResult(
            device_id=device.id,
            source=device.source,
            provider="meteostat",
            latitude=latitude,
            longitude=longitude,
            start_date=resolved_start,
            end_date=resolved_end,
            fetched_rows=len(values),
            upserted_rows=upserted_rows,
            cached_rows=int(cached_rows),
            timezone_name=timezone_name,
        )

    @staticmethod
    def get_device_cache_status(db: Session, device: IoTDevice) -> dict:
        row = (
            db.query(
                func.count(WeatherHistorical.id),
                func.min(WeatherHistorical.event_ts),
                func.max(WeatherHistorical.event_ts),
            )
            .filter(
                WeatherHistorical.device_id == device.id,
                WeatherHistorical.provider == "meteostat",
            )
            .one()
        )
        return {
            "device_id": device.id,
            "source": device.source,
            "provider": "meteostat",
            "cached_rows": int(row[0] or 0),
            "min_event_ts": row[1].isoformat() if row[1] else None,
            "max_event_ts": row[2].isoformat() if row[2] else None,
            "latitude": device.latitude,
            "longitude": device.longitude,
            "timezone_name": device.timezone_name,
        }

