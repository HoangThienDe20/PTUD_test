# model_backend

Standalone prediction backend extracted from `Model_full`.

Deployment guide:
- `HUONG_DAN_DEPLOY_VPS.md`

## Scope
- XGBoost short-horizon prediction
- Dashboard multi-day forecast (TFT + fallback)
- TFT dataset status
- Meteostat weather sync pipeline

## Endpoints
- `GET /api/model/health`
- `GET /api/model/metrics/predict`
- `POST /api/model/metrics/train-xgboost`
- `GET /api/model/dashboard/forecast`
- `GET /api/model/tft-training/devices/{device_id}/status`
- `POST /api/model/tft-training/devices/{device_id}/train`
- `POST /api/model/weather-pipeline/devices/{device_id}/sync`

All endpoints require header `X-Model-Token` when `SECRET_KEY` is set.

## Prediction persistence

`/metrics/predict` and `/dashboard/forecast` can persist predictions into PostgreSQL table `model_predictions`.

Overwrite strategy:
- For each request scope (`prediction_kind + source + device_id + metric_type`),
  service deletes old rows first, then inserts the new prediction points.
- This keeps only the latest forecast set for each scope, no historical buildup.

Config:
- `SAVE_PREDICTIONS=true|false`

## Setup
```bash
cd model_backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

## Run
```bash
uvicorn main:app --host 0.0.0.0 --port 8200
```

## Models directory
Put trained model artifacts here:
- `model_backend/models/xgboost_iot/*.model.json` + `*.meta.json`
- `model_backend/models/tft_dashboard/*.ckpt` + `*.json`

Default service code expects relative paths `models/xgboost_iot` and `models/tft_dashboard` from project root.


## Cleanup old model files

Dry-run (recommended first):
```bash
python cleanup_models.py
```

Delete for real:
```bash
python cleanup_models.py --execute
```

Custom policy:
```bash
python cleanup_models.py --keep-xgb 5 --keep-tft 3 --max-age-days 60 --execute
```

## Auto cleanup daily (systemd timer)

Files:
- `deploy/systemd/model-backend-cleanup.service`
- `deploy/systemd/model-backend-cleanup.timer`

Install on VPS (Linux):
```bash
sudo cp deploy/systemd/model-backend-cleanup.service /etc/systemd/system/
sudo cp deploy/systemd/model-backend-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now model-backend-cleanup.timer
sudo systemctl list-timers | grep model-backend-cleanup
```

Check logs:
```bash
journalctl -u model-backend-cleanup.service -n 100 --no-pager
```

