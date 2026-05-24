# Huong Dan Deploy model_backend Len VPS

Tai lieu nay huong dan deploy `model_backend` len VPS Linux (Ubuntu), chay doc lap va dung chung PostgreSQL.

## 1) Chuan bi tren VPS

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
```

Tao thu muc deploy:

```bash
sudo mkdir -p /opt/model_backend
sudo chown -R $USER:$USER /opt/model_backend
```

## 2) Upload ma nguon

Copy toan bo thu muc `model_backend/` len VPS vao `/opt/model_backend`.

Sau khi copy xong, cau truc can co:
- `/opt/model_backend/main.py`
- `/opt/model_backend/api/`
- `/opt/model_backend/services/`
- `/opt/model_backend/models/`
- `/opt/model_backend/requirements.txt`
- `/opt/model_backend/.env`

## 3) Tao virtualenv va cai dependencies

```bash
cd /opt/model_backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4) Cau hinh `.env`

Tao file `/opt/model_backend/.env` (co the copy tu `.env.example`) va set toi thieu:

```env
DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/dbname
SECRET_KEY=your-secret-token
SAVE_PREDICTIONS=true
CORS_ORIGINS=*
```

Luu y:
- DB user nen co quyen tao bang (de tao `model_predictions` lan dau).
- Neu khong muon auto tao bang, ban tao bang thu cong truoc.

## 5) Copy artifacts model

Copy model da train:
- `/opt/model_backend/models/xgboost_iot/*.model.json` + `*.meta.json`
- `/opt/model_backend/models/tft_dashboard/*.ckpt` + `*.json`

## 6) Test chay thu cong

```bash
cd /opt/model_backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8200
```

Test health:

```bash
curl http://127.0.0.1:8200/api/model/health
```

## 7) Chay bang systemd (service API)

Copy service file:

```bash
sudo cp deploy/systemd/model-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now model-backend.service
```

Kiem tra:

```bash
sudo systemctl status model-backend.service
journalctl -u model-backend.service -n 100 --no-pager
```

## 8) Bat cleanup tu dong hang ngay

Copy service + timer:

```bash
sudo cp deploy/systemd/model-backend-cleanup.service /etc/systemd/system/
sudo cp deploy/systemd/model-backend-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now model-backend-cleanup.timer
sudo systemctl list-timers | grep model-backend-cleanup
```

Log cleanup:

```bash
journalctl -u model-backend-cleanup.service -n 100 --no-pager
```

## 9) Mo firewall / reverse proxy (neu can)

Neu VPS nay duoc goi tu VPS khac:
- Mo port `8200` noi bo, hoac
- Dat Nginx reverse proxy + chi cho phep IP trusted.

Khuyen nghi:
- Khong public rong internet.
- Luon gui header `X-Model-Token` khi goi API model.

## 10) Luu y van hanh

- Neu loi save prediction vao PostgreSQL, API predict van tra ket qua model (chi bao loi o truong `storage`).
- `model_predictions` dang luu theo co che ghi de theo scope:
  `prediction_kind + source + device_id + metric_type`.
- Nghia la moi lan predict moi se xoa bo cu cung scope va ghi bo moi.

