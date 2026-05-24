"""Weather and geocoding service powered by Open-Meteo."""

from __future__ import annotations

import json
import re
import time
import unicodedata
from datetime import date, datetime
from dataclasses import dataclass
from typing import Optional
from urllib import parse as urlparse
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError


GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_API = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"
CURRENT_WEATHER_CACHE_TTL_SECONDS = 30
HOURLY_WEATHER_CACHE_TTL_SECONDS = 300
_CURRENT_WEATHER_CACHE: dict[tuple, tuple[float, dict]] = {}
_HOURLY_WEATHER_CACHE: dict[tuple, tuple[float, dict]] = {}


@dataclass
class GeocodeResult:
    name: str
    latitude: float
    longitude: float
    country: Optional[str] = None
    admin1: Optional[str] = None
    timezone: Optional[str] = None


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def _normalize_location_key(text: str) -> str:
    normalized = _strip_accents(text or "").lower()
    normalized = normalized.replace("tp.", "tp ")
    normalized = re.sub(r"[,/_-]+", " ", normalized)
    normalized = re.sub(
        r"\b(viet\s*nam|vietnam|vn|province|city|tinh|thanh pho|tp)\b",
        " ",
        normalized,
    )
    return re.sub(r"\s+", " ", normalized).strip()


VIETNAM_LOCATION_OVERRIDES: dict[str, GeocodeResult] = {
    "ho chi minh": GeocodeResult("Ho Chi Minh City", 10.7769, 106.7009, "Vietnam", "Ho Chi Minh City", "Asia/Ho_Chi_Minh"),
    "hcm": GeocodeResult("Ho Chi Minh City", 10.7769, 106.7009, "Vietnam", "Ho Chi Minh City", "Asia/Ho_Chi_Minh"),
    "sai gon": GeocodeResult("Ho Chi Minh City", 10.7769, 106.7009, "Vietnam", "Ho Chi Minh City", "Asia/Ho_Chi_Minh"),
    "saigon": GeocodeResult("Ho Chi Minh City", 10.7769, 106.7009, "Vietnam", "Ho Chi Minh City", "Asia/Ho_Chi_Minh"),
    "hue": GeocodeResult("Hue", 16.4637, 107.5909, "Vietnam", "Hue", "Asia/Ho_Chi_Minh"),
    "thua thien hue": GeocodeResult("Hue", 16.4637, 107.5909, "Vietnam", "Hue", "Asia/Ho_Chi_Minh"),
    "ha noi": GeocodeResult("Ha Noi", 21.0285, 105.8542, "Vietnam", "Ha Noi", "Asia/Ho_Chi_Minh"),
    "hanoi": GeocodeResult("Ha Noi", 21.0285, 105.8542, "Vietnam", "Ha Noi", "Asia/Ho_Chi_Minh"),
    "da nang": GeocodeResult("Da Nang", 16.0544, 108.2022, "Vietnam", "Da Nang", "Asia/Ho_Chi_Minh"),
    "ca mau": GeocodeResult("Ca Mau", 9.1768, 105.1524, "Vietnam", "Ca Mau", "Asia/Ho_Chi_Minh"),
    "can tho": GeocodeResult("Can Tho", 10.0452, 105.7469, "Vietnam", "Can Tho", "Asia/Ho_Chi_Minh"),
    "hai phong": GeocodeResult("Hai Phong", 20.8449, 106.6881, "Vietnam", "Hai Phong", "Asia/Ho_Chi_Minh"),
    "nha trang": GeocodeResult("Nha Trang", 12.2388, 109.1967, "Vietnam", "Khanh Hoa", "Asia/Ho_Chi_Minh"),
    "khanh hoa": GeocodeResult("Nha Trang", 12.2388, 109.1967, "Vietnam", "Khanh Hoa", "Asia/Ho_Chi_Minh"),
    "da lat": GeocodeResult("Da Lat", 11.9404, 108.4583, "Vietnam", "Lam Dong", "Asia/Ho_Chi_Minh"),
    "lam dong": GeocodeResult("Da Lat", 11.9404, 108.4583, "Vietnam", "Lam Dong", "Asia/Ho_Chi_Minh"),
    "vung tau": GeocodeResult("Vung Tau", 10.4114, 107.1362, "Vietnam", "Ba Ria - Vung Tau", "Asia/Ho_Chi_Minh"),
    "ba ria vung tau": GeocodeResult("Vung Tau", 10.4114, 107.1362, "Vietnam", "Ba Ria - Vung Tau", "Asia/Ho_Chi_Minh"),
}


def _lookup_vietnam_location_override(query: str) -> Optional[GeocodeResult]:
    key = _normalize_location_key(query)
    if not key:
        return None
    return VIETNAM_LOCATION_OVERRIDES.get(key)


def _json_get(url: str, timeout: int = 12) -> dict:
    req = urlrequest.Request(url, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Failed to fetch Open-Meteo data: {exc}")


def _cached_hourly_result(cache_key: tuple) -> Optional[dict]:
    cached = _HOURLY_WEATHER_CACHE.get(cache_key)
    if cached and time.time() - cached[0] <= HOURLY_WEATHER_CACHE_TTL_SECONDS:
        return json.loads(json.dumps(cached[1]))
    return None


def _set_cached_hourly_result(cache_key: tuple, payload: dict) -> dict:
    _HOURLY_WEATHER_CACHE[cache_key] = (time.time(), json.loads(json.dumps(payload)))
    return payload


def geocode_location(query: str) -> Optional[GeocodeResult]:
    """Resolve a location string to coordinates via Open-Meteo geocoding API."""
    if not query or not query.strip():
        return None
    original = query.strip()
    local_match = _lookup_vietnam_location_override(original)
    if local_match:
        return local_match

    def _query_once(name: str, country_code: Optional[str] = None) -> Optional[GeocodeResult]:
        params = {
            "name": name,
            "count": 1,
            "language": "en",
            "format": "json",
        }
        if country_code:
            params["countryCode"] = country_code
        url = f"{GEOCODING_API}?{urlparse.urlencode(params)}"
        payload = _json_get(url)
        results = payload.get("results") or []
        if not results:
            return None
        top = results[0]
        return GeocodeResult(
            name=top.get("name") or name,
            latitude=float(top["latitude"]),
            longitude=float(top["longitude"]),
            country=top.get("country"),
            admin1=top.get("admin1"),
            timezone=top.get("timezone"),
        )

    candidates = []
    for item in (
        original,
        _strip_accents(original),
        f"{original}, VN",
        f"{original}, Vietnam",
        f"{original} Province, Vietnam",
        f"{_strip_accents(original)} Province, Vietnam",
    ):
        if item and item not in candidates:
            candidates.append(item)

    # Prefer Vietnam search first for better province/city matching.
    for candidate in candidates:
        found = _query_once(candidate, country_code="VN")
        if found:
            return found

    # Fallback: global search without country filter.
    for candidate in candidates:
        found = _query_once(candidate, country_code=None)
        if found:
            return found

    return None


def get_current_weather(latitude: float, longitude: float, timezone: str = "auto") -> Optional[dict]:
    """Fetch current weather snapshot from Open-Meteo."""
    if latitude is None or longitude is None:
        return None
    cache_key = (round(float(latitude), 3), round(float(longitude), 3), timezone or "auto")
    cached = _CURRENT_WEATHER_CACHE.get(cache_key)
    if cached and time.time() - cached[0] <= CURRENT_WEATHER_CACHE_TTL_SECONDS:
        return dict(cached[1])

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,pressure_msl,shortwave_radiation,soil_moisture_0_to_1cm,weather_code,wind_speed_10m",
        "timezone": timezone or "auto",
    }
    url = f"{FORECAST_API}?{urlparse.urlencode(params)}"
    try:
        payload = _json_get(url, timeout=5)
    except RuntimeError:
        return None
    current = payload.get("current")
    if not current:
        return None
    result = {
        "latitude": payload.get("latitude", latitude),
        "longitude": payload.get("longitude", longitude),
        "timezone": payload.get("timezone", timezone),
        "source": "current",
        "time": current.get("time"),
        "temperature_2m": current.get("temperature_2m"),
        "relative_humidity_2m": current.get("relative_humidity_2m"),
        "apparent_temperature": current.get("apparent_temperature"),
        "precipitation": current.get("precipitation"),
        "pressure_msl": current.get("pressure_msl"),
        "shortwave_radiation": current.get("shortwave_radiation"),
        "soil_moisture_0_to_1cm": current.get("soil_moisture_0_to_1cm"),
        "weather_code": current.get("weather_code"),
        "wind_speed_10m": current.get("wind_speed_10m"),
    }
    _CURRENT_WEATHER_CACHE[cache_key] = (time.time(), dict(result))
    return result


def get_hourly_weather_forecast(
    latitude: float,
    longitude: float,
    forecast_days: int = 3,
    timezone: str = "auto",
) -> Optional[dict]:
    """Fetch hourly weather forecast from Open-Meteo for a device location."""
    if latitude is None or longitude is None:
        return None

    days = max(1, min(16, int(forecast_days or 1)))
    cache_key = ("forecast", round(float(latitude), 3), round(float(longitude), 3), days, timezone or "auto")
    cached = _cached_hourly_result(cache_key)
    if cached:
        return cached

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,pressure_msl,shortwave_radiation,soil_moisture_0_to_1cm",
        "forecast_days": days,
        "timezone": timezone or "auto",
    }
    url = f"{FORECAST_API}?{urlparse.urlencode(params)}"
    try:
        payload = _json_get(url)
    except RuntimeError:
        return None

    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return None

    result = {
        "latitude": payload.get("latitude", latitude),
        "longitude": payload.get("longitude", longitude),
        "timezone": payload.get("timezone", timezone),
        "source": "open_meteo_hourly_forecast",
        "hourly": hourly,
    }
    return _set_cached_hourly_result(cache_key, result)


def get_hourly_weather_archive(
    latitude: float,
    longitude: float,
    start_date: str | date,
    end_date: str | date,
    timezone: str = "auto",
) -> Optional[dict]:
    """Fetch hourly historical weather from Open-Meteo Archive."""
    if latitude is None or longitude is None:
        return None

    start_text = start_date.isoformat() if isinstance(start_date, date) else str(start_date)
    end_text = end_date.isoformat() if isinstance(end_date, date) else str(end_date)
    cache_key = ("archive", round(float(latitude), 3), round(float(longitude), 3), start_text, end_text, timezone or "auto")
    cached = _cached_hourly_result(cache_key)
    if cached:
        return cached

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start_text,
        "end_date": end_text,
        "hourly": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,pressure_msl,shortwave_radiation,soil_moisture_0_to_1cm",
        "timezone": timezone or "auto",
    }
    url = f"{ARCHIVE_API}?{urlparse.urlencode(params)}"
    try:
        payload = _json_get(url)
    except RuntimeError:
        return None

    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return None

    result = {
        "latitude": payload.get("latitude", latitude),
        "longitude": payload.get("longitude", longitude),
        "timezone": payload.get("timezone", timezone),
        "source": "open_meteo_hourly_archive",
        "hourly": hourly,
    }
    return _set_cached_hourly_result(cache_key, result)


def get_weather_for_timestamp(
    latitude: float,
    longitude: float,
    target_iso_time: str,
    timezone: str = "auto",
) -> Optional[dict]:
    """
    Fetch weather nearest to a target alert timestamp.
    Uses Open-Meteo archive hourly data for accurate historical context.
    """
    if latitude is None or longitude is None:
        return None

    if not target_iso_time:
        return get_current_weather(latitude=latitude, longitude=longitude, timezone=timezone)

    try:
        dt = datetime.fromisoformat(target_iso_time.replace("Z", "+00:00"))
    except ValueError:
        return get_current_weather(latitude=latitude, longitude=longitude, timezone=timezone)

    target_date = dt.date().isoformat()
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": target_date,
        "end_date": target_date,
        "hourly": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
        "timezone": timezone or "auto",
    }
    url = f"{ARCHIVE_API}?{urlparse.urlencode(params)}"
    try:
        payload = _json_get(url)
    except RuntimeError:
        return get_current_weather(latitude=latitude, longitude=longitude, timezone=timezone)
    hourly = payload.get("hourly") or {}
    hourly_times = hourly.get("time") or []
    if not hourly_times:
        return get_current_weather(latitude=latitude, longitude=longitude, timezone=timezone)

    # Pick the nearest hourly sample to target timestamp.
    nearest_index = 0
    smallest_delta = None
    for idx, time_str in enumerate(hourly_times):
        try:
            sample_dt = datetime.fromisoformat(time_str)
            delta = abs((sample_dt - dt.replace(tzinfo=None)).total_seconds())
        except Exception:
            continue
        if smallest_delta is None or delta < smallest_delta:
            smallest_delta = delta
            nearest_index = idx

    def _val(key: str):
        arr = hourly.get(key) or []
        return arr[nearest_index] if nearest_index < len(arr) else None

    return {
        "latitude": payload.get("latitude", latitude),
        "longitude": payload.get("longitude", longitude),
        "timezone": payload.get("timezone", timezone),
        "source": "archive_hourly",
        "target_time": target_iso_time,
        "matched_time": hourly_times[nearest_index],
        "temperature_2m": _val("temperature_2m"),
        "relative_humidity_2m": _val("relative_humidity_2m"),
        "apparent_temperature": _val("apparent_temperature"),
        "precipitation": _val("precipitation"),
        "weather_code": _val("weather_code"),
        "wind_speed_10m": _val("wind_speed_10m"),
    }

