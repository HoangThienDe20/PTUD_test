# Hướng Dẫn VPS Trung Tâm + VPS Con + PostgreSQL

Tài liệu này kế thừa nội dung từ bản Azure SQL, nhưng chuyển toàn bộ phần cơ sở dữ liệu sang **PostgreSQL**.

## 1. Kiến trúc tổng quát

```text
VPS con 1, VPS con 2, VPS con 3...
        ↓ gửi metrics + nhận task
VPS trung tâm FastAPI
        ↓ lưu dữ liệu quan trọng
PostgreSQL Database
        ↓
Local backend / Frontend hiển thị, edit, thuê, hủy thuê
```

## 2. Bảng dữ liệu PostgreSQL

Sử dụng 4 bảng:

- `servers`
- `server_metadata`
- `rentals`
- `tasks`

Schema có sẵn tại:

```text
server_backend/sql/schema_postgresql.sql
```

## 3. Cài PostgreSQL client trên VPS trung tâm

```bash
sudo apt update
sudo apt install -y postgresql-client
```

## 4. Cấu hình `.env` trên VPS trung tâm

```env
METRICS_TOKEN=demo-secret-token
ADMIN_TOKEN=admin-demo-token

POSTGRES_HOST=<HOST>
POSTGRES_PORT=5432
POSTGRES_DB=metrics_central
POSTGRES_USER=<USER>
POSTGRES_PASSWORD=<PASSWORD>
```

## 5. Khởi tạo DB

```bash
psql -h <HOST> -U <USER> -d metrics_central -f sql/schema_postgresql.sql
```

## 6. Chạy backend trung tâm

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 7. API chính cho luồng agent/rental

- `POST /api/servers/register`
- `POST /api/metrics`
- `GET /api/agent/tasks/{server_id}`
- `POST /api/agent/tasks/{task_id}/result`
- `PUT /api/servers/{server_id}/metadata`
- `POST /api/rentals/create`
- `POST /api/rentals/{rental_id}/cancel`
- `GET /api/rentals`

## 8. Service files

- `systemd/metrics-central.service`
- `systemd/metrics-agent.service`

## 9. Agent trên VPS con

File mẫu:

```text
server_backend/agent/agent.py
```

Bắt buộc đổi theo từng máy:

```python
SERVER_ID = "vps-ubuntu-03"
SERVER_NAME = "vps-ubuntu-03"
```
