"""HTTP client for calling model_backend from CK_full app backend."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests

from app.config import MODEL_BACKEND_TIMEOUT, MODEL_BACKEND_TOKEN, MODEL_BACKEND_URL


logger = logging.getLogger("app.model_client")


@dataclass
class ModelClientError(Exception):
    status_code: int
    detail: str
    upstream_status: Optional[int] = None


class ModelClient:
    def __init__(
        self,
        base_url: str = MODEL_BACKEND_URL,
        token: str = MODEL_BACKEND_TOKEN,
        timeout: float = MODEL_BACKEND_TIMEOUT,
        max_retries: int = 1,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = max(1.0, float(timeout))
        self.max_retries = max(0, int(max_retries))

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["X-Model-Token"] = self.token
        return headers

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict[str, Any]] = None,
        *,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        request_timeout = max(1.0, float(timeout if timeout is not None else self.timeout))
        retry_count = self.max_retries if max_retries is None else max(0, int(max_retries))
        attempts = retry_count + 1
        last_exception: Optional[Exception] = None

        for attempt in range(1, attempts + 1):
            started = time.perf_counter()
            try:
                response = requests.request(
                    method=method.upper(),
                    url=url,
                    params=params or {},
                    headers=self._headers(),
                    timeout=request_timeout,
                )
                latency_ms = round((time.perf_counter() - started) * 1000, 2)
                logger.info("model_call method=%s path=%s status=%s latency_ms=%s", method.upper(), path, response.status_code, latency_ms)

                if response.status_code == 401:
                    raise ModelClientError(
                        status_code=500,
                        detail="Model backend rejected internal token. Check MODEL_BACKEND_TOKEN / SECRET_KEY.",
                        upstream_status=401,
                    )
                if 400 <= response.status_code < 500:
                    raise ModelClientError(
                        status_code=response.status_code,
                        detail=_extract_error_detail(response),
                        upstream_status=response.status_code,
                    )
                if response.status_code >= 500:
                    if attempt < attempts:
                        time.sleep(0.3 * attempt)
                        continue
                    raise ModelClientError(status_code=503, detail="Model service unavailable", upstream_status=response.status_code)
                return response.json()
            except requests.Timeout as exc:
                last_exception = exc
                logger.warning("model_call timeout method=%s path=%s attempt=%s", method.upper(), path, attempt)
                if attempt < attempts:
                    time.sleep(0.3 * attempt)
                    continue
            except requests.RequestException as exc:
                last_exception = exc
                logger.warning("model_call network_error method=%s path=%s attempt=%s err=%s", method.upper(), path, attempt, exc)
                if attempt < attempts:
                    time.sleep(0.3 * attempt)
                    continue
            except ValueError as exc:
                raise ModelClientError(status_code=502, detail=f"Invalid JSON from model backend: {exc}") from exc

        raise ModelClientError(status_code=503, detail=f"Model service unavailable: {last_exception}")

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/model/health")

    def predict_metrics(self, *, source: str, metric_type: str, horizon_minutes: int, step_minutes: int, history_days: int) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/model/metrics/predict",
            params={
                "source": source,
                "metric_type": metric_type,
                "horizon_minutes": horizon_minutes,
                "step_minutes": step_minutes,
                "history_days": history_days,
            },
        )

    def dashboard_forecast(self, *, device_id: int, horizon_days: int, history_days: int) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/model/dashboard/forecast",
            params={"device_id": device_id, "horizon_days": horizon_days, "history_days": history_days},
        )

    def train_xgboost(self, *, source: str, metric_type: str, history_days: int, step_minutes: int) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/model/metrics/train-xgboost",
            params={"source": source, "metric_type": metric_type, "history_days": history_days, "step_minutes": step_minutes},
        )

    def tft_training_status(self, *, device_id: int, target_column: Optional[str]) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if target_column:
            params["target_column"] = target_column
        return self._request("GET", f"/api/model/tft-training/devices/{device_id}/status", params=params, timeout=30, max_retries=0)

    def tft_train(
        self,
        *,
        device_id: int,
        target_column: Optional[str],
        horizon_hours: int,
        encoder_hours: int,
        max_epochs: int,
        batch_size: int,
        learning_rate: float,
        hidden_size: int,
        attention_head_size: int,
        min_rows: int,
        early_stopping_patience: int,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "horizon_hours": horizon_hours,
            "encoder_hours": encoder_hours,
            "max_epochs": max_epochs,
            "batch_size": batch_size,
            "learning_rate": learning_rate,
            "hidden_size": hidden_size,
            "attention_head_size": attention_head_size,
            "min_rows": min_rows,
            "early_stopping_patience": early_stopping_patience,
        }
        if target_column:
            params["target_column"] = target_column
        return self._request(
            "POST",
            f"/api/model/tft-training/devices/{device_id}/train",
            params=params,
            timeout=900,
            max_retries=0,
        )

    def weather_pipeline_sync(self, *, device_id: int, start_date: Optional[str], end_date: Optional[str]) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        return self._request(
            "POST",
            f"/api/model/weather-pipeline/devices/{device_id}/sync",
            params=params,
            timeout=180,
            max_retries=0,
        )


def _extract_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return f"Model backend returned HTTP {response.status_code}"
    detail = payload.get("detail")
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    return f"Model backend returned HTTP {response.status_code}"


model_client = ModelClient()
