"""Minimal ORM models needed by prediction services."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, UniqueConstraint

from database import Base


class Metric(Base):
    __tablename__ = "metrics"

    id = Column(Integer, primary_key=True, index=True)
    event_ts = Column(DateTime, default=lambda: datetime.now(timezone(timedelta(hours=7))), index=True, nullable=False)
    sensor_id = Column(String(100), nullable=False, index=True)
    location = Column(String(255), nullable=True)
    metric_type = Column(String(50), index=True, nullable=False)
    metric_value = Column(Float, nullable=False)
    unit = Column(String(50), nullable=True)


class IoTDevice(Base):
    __tablename__ = "iot_devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    device_type = Column(String(50), nullable=False)
    source = Column(String(100), nullable=False, index=True)
    unit = Column(String(50), nullable=True)
    location = Column(String(255), nullable=True)
    environment_type = Column(String(20), nullable=False, default="indoor")
    location_query = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    timezone_name = Column(String(64), nullable=True)
    task_description = Column(String(500), nullable=True)
    priority_level = Column(String(20), nullable=True)
    action_hint = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    alert_enabled = Column(Boolean, default=False, nullable=False)
    min_threshold = Column(Float, nullable=True)
    max_threshold = Column(Float, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone(timedelta(hours=7))), nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "device_type", name="uq_iot_device_source_type"),
    )


class WeatherHistorical(Base):
    __tablename__ = "weather_historical"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, nullable=False, index=True)
    source = Column(String(100), nullable=False, index=True)
    provider = Column(String(50), nullable=False, default="meteostat", index=True)
    station_id = Column(String(64), nullable=True)
    event_ts = Column(DateTime, nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    timezone_name = Column(String(64), nullable=True)
    temperature_c = Column(Float, nullable=True)
    dew_point_c = Column(Float, nullable=True)
    relative_humidity = Column(Float, nullable=True)
    precipitation_mm = Column(Float, nullable=True)
    snow_mm = Column(Float, nullable=True)
    wind_direction_deg = Column(Float, nullable=True)
    wind_speed_kmh = Column(Float, nullable=True)
    wind_peak_kmh = Column(Float, nullable=True)
    pressure_hpa = Column(Float, nullable=True)
    sunshine_minutes = Column(Float, nullable=True)
    condition_code = Column(Float, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone(timedelta(hours=7))), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone(timedelta(hours=7))), nullable=False)

    __table_args__ = (
        UniqueConstraint("device_id", "provider", "event_ts", name="uq_weather_device_provider_ts"),
    )
