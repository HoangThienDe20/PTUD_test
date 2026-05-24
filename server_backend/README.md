# Server Backend (PostgreSQL)

Thư mục này được tạo từ tài liệu `HuongDan_AzureSQL_VPS.md`, nhưng đã chuyển từ **Azure SQL** sang **PostgreSQL**.

## Cấu trúc

- `docs/HuongDan_PostgreSQL_VPS.md`: Hướng dẫn triển khai đầy đủ (VPS trung tâm + VPS con + PostgreSQL).
- `sql/schema_postgresql.sql`: Schema PostgreSQL cho `servers`, `server_metadata`, `rentals`, `tasks`.
- `app/`: Backend FastAPI mẫu cho VPS trung tâm.
- `agent/agent.py`: Agent mẫu chạy trên VPS con.
- `systemd/`: Service file mẫu.
- `.env.example`: Biến môi trường.
- `requirements.txt`: Dependencies backend trung tâm.

## Chạy nhanh backend trung tâm

1. Tạo DB và chạy schema:
```bash
psql -h <host> -U <user> -d <db_name> -f sql/schema_postgresql.sql
```

2. Tạo môi trường:
```bash
python -m venv .venv
source .venv/bin/activate  # Linux
pip install -r requirements.txt
cp .env.example .env
```

3. Chạy server:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Ghi chú

- Backend mẫu ưu tiên đúng luồng nghiệp vụ trong tài liệu:
  - Agent register server
  - Agent gửi metrics
  - Agent poll task
  - Agent báo kết quả task
  - API tạo/hủy thuê VPS
- History CPU/RAM gần nhất được lưu RAM (in-memory), không ghi bảng lịch sử.
