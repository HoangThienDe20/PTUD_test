# IoT Backend Split - Implementation Guide

This repo now includes a standalone IoT backend service at `iot_backend/` while keeping the existing core backend unchanged.

## What was implemented

- New standalone IoT app entrypoint: `iot_backend/main.py`
- MQTT ingestor process: `iot_backend/mqtt_consumer.py`
- WebSocket auth + role-based filtering added in `app/api/routes_websocket.py`
- Connection metadata support in `app/websocket_manager.py`
- Nginx routing template: `deploy/nginx_iot_split.conf`

## Run services

### 1) Core backend (unchanged)

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) IoT backend (new)

```bash
uvicorn iot_backend.main:app --host 0.0.0.0 --port 8100 --reload
```

### 3) MQTT -> IoT bridge

Required env vars:

- `MQTT_HOST`
- `MQTT_PORT` (default 1883)
- `MQTT_USERNAME` (optional)
- `MQTT_PASSWORD` (optional)
- `MQTT_TOPIC` (default `iot/metrics/#`)
- `IOT_WS_INGEST_URL` (default `ws://127.0.0.1:8100/api/ws/mqtt_ingestor`)

Run:

```bash
python -m iot_backend.mqtt_consumer
```

## WebSocket auth behavior

- Viewer clients should connect with `?token=<JWT>`
- JWT is verified using shared `SECRET_KEY` + `ALGORITHM`
- `admin` receives all IoT sources
- `user` receives only allowed sources from DB permissions
- Connections without token are treated as publishers-only (can send metrics, do not receive broadcasts)

Example viewer URL:

```text
ws://<domain>/api/ws/frontend_123?token=<access_token>
```

## Frontend compatibility

If Nginx route is applied from `deploy/nginx_iot_split.conf`, frontend can keep existing API and WS URLs.

## Recommended cutover

1. Start both backends in parallel.
2. Start MQTT consumer and validate data flow into IoT backend.
3. Apply Nginx routing rules for IoT paths.
4. Verify admin/user data visibility on realtime and REST endpoints.
5. Keep core backend for auth/admin/server/chat.
