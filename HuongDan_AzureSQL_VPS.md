# Hướng Dẫn VPS Trung Tâm + VPS Con + Azure SQL

Tài liệu này thay thế bản hướng dẫn cũ. Kiến trúc mới dùng **Azure SQL** để lưu dữ liệu quan trọng, còn history CPU/RAM 2 giờ gần nhất vẫn lưu tạm trong RAM để nhẹ hệ thống.

## 1\. Kiến trúc tổng quát

```text
VPS con 1, VPS con 2, VPS con 3...
        ↓ gửi metrics + nhận task
VPS trung tâm FastAPI
        ↓ lưu dữ liệu quan trọng
Azure SQL Database
        ↓
Local backend / Frontend hiển thị, edit, thuê, hủy thuê
```

## 2\. Vai trò từng phần

### VPS con

Mỗi VPS con chạy `agent.py`.

Agent làm 3 việc:

```text
1. Gửi thông tin tĩnh: server\_id, ip, os, cpu\_cores, ram\_total\_gb...
2. Gửi metrics động mỗi 5 giây: cpu, ram, disk, uptime...
3. Nhận task từ VPS trung tâm:
   - create\_ssh\_user
   - delete\_ssh\_user
```

### VPS trung tâm

VPS trung tâm chạy FastAPI tại:

```text
http://13.75.54.112:8000
```

Nhiệm vụ:

```text
1. Nhận metrics từ VPS con.
2. Ghi dữ liệu vào Azure SQL.
3. Trả danh sách VPS cho frontend/local backend.
4. Tạo task thuê VPS.
5. Tạo task hủy thuê VPS.
6. Quản lý metadata: tên hiển thị, cấu hình bán hàng, giá thuê.
```

### Azure SQL

Azure SQL lưu 4 bảng:

```text
servers
server\_metadata
rentals
tasks
```

Không cần bảng `metrics\_history` ở giai đoạn hiện tại. History 2 giờ gần nhất vẫn lưu RAM trên VPS trung tâm.

\---

## 3\. SSH nhanh vào 3 VPS hiện tại

### VPS trung tâm

```powershell
ssh -i "D:\\DuLieuCuaHuu\\HK2\_20252026\\PTUD\\CK\\VPS\\VMCenter\\.ssh\\vps-ubuntu-center\_key.pem" ubuntu@13.75.54.112
```

### VPS con 1

```powershell
ssh -i "D:\\DuLieuCuaHuu\\HK2\_20252026\\PTUD\\CK\\VPS\\VM1\\azure-vps-lab-key.pem" ubuntu@104.208.118.46
```

### VPS con 2

```powershell
ssh -i "D:\\DuLieuCuaHuu\\HK2\_20252026\\PTUD\\CK\\VPS\\VM2\\vps-ubuntu-02-key.pem" ubuntu@20.187.106.4
```

### VPS con 3

```powershell
ssh azureuser@20.214.247.102

password: Azure@12345678
```

### VPS con 4

```powershell
ssh azureuser@20.196.210.174

password: Azure@12345678
```



\---

## 4\. Nếu SSH báo lỗi quyền file `.pem`

Chạy PowerShell:

```powershell
$key = "D:\\DUONG\_DAN\_TOI\_FILE\_KEY\\ten-file-key.pem"

icacls $key /inheritance:r
icacls $key /remove "NT AUTHORITY\\Authenticated Users" "BUILTIN\\Users" "Everyone"
icacls $key /grant:r "$($env:USERNAME):R"
```

\---

# PHẦN A — Azure SQL

## 5\. Các bảng cần có

### `servers`

Lưu dữ liệu thật từ VPS con:

```text
server\_id
name
ip
cpu\_cores
cpu\_physical\_cores
ram\_total\_gb
os
architecture
note
cpu
ram
disk
ram\_used\_gb
ram\_available\_gb
uptime
registered\_at
last\_registered
last\_seen
last\_updated
```

### `server\_metadata`

Lưu dữ liệu admin edit trên frontend:

```text
server\_id
display\_name
specifications
price\_per\_month
description
is\_available
updated\_at
```

### `rentals`

Lưu lượt thuê VPS:

```text
rental\_id
server\_id
server\_name
server\_ip
username
private\_key
status
renter\_name
created\_at
activated\_at
cancel\_requested\_at
cancelled\_at
```

### `tasks`

Lưu task cho agent:

```text
task\_id
rental\_id
server\_id
action
username
public\_key
status
message
created\_at
picked\_at
finished\_at
```

## 6\. Trạng thái cần dùng

Rental status:

```text
creating
active
cancelling
cancelled
failed
cancel\_failed
```

Task status:

```text
pending
picked
success
failed
```

Task action:

```text
create\_ssh\_user
delete\_ssh\_user
```

\---

# PHẦN B — Cấu hình VPS trung tâm

## 7\. Mở firewall Azure SQL

Cho phép IP VPS trung tâm kết nối Azure SQL:

```text
13.75.54.112
```

Trên Azure:

```text
SQL server → Networking → Firewall rules
```

Thêm rule:

```text
Name: allow-vps-center
Start IP: 13.75.54.112
End IP: 13.75.54.112
```

Nếu local backend chạy trên máy cá nhân và cần kết nối Azure SQL, bấm thêm:

```text
Add your client IPv4 address
```

## 8\. Cài ODBC Driver 18 trên VPS trung tâm

```bash
sudo apt update
sudo apt install -y curl gnupg unixodbc unixodbc-dev

curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg

curl https://packages.microsoft.com/config/ubuntu/24.04/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list

sudo apt update
sudo ACCEPT\_EULA=Y apt install -y msodbcsql18
```

Cài Python package:

```bash
cd \~/metrics-central
source .venv/bin/activate
pip install pyodbc python-dotenv fastapi uvicorn pydantic
```

## 9\. File `.env` trên VPS trung tâm

```bash
cd \~/metrics-central
nano .env
```

Nội dung:

```env
METRICS\_TOKEN=demo-secret-token
ADMIN\_TOKEN=admin-demo-token

SQLSERVER\_HOST=YOUR\_SQL\_SERVER.database.windows.net
SQLSERVER\_PORT=1433
SQLSERVER\_DATABASE=YOUR\_DATABASE\_NAME
SQLSERVER\_USER=YOUR\_SQL\_USER
SQLSERVER\_PASSWORD=YOUR\_SQL\_PASSWORD
SQLSERVER\_DRIVER=ODBC Driver 18 for SQL Server
```

## 10\. Service VPS trung tâm

```bash
sudo nano /etc/systemd/system/metrics-central.service
```

Nội dung:

```ini
\[Unit]
Description=Metrics Central FastAPI
After=network.target

\[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/metrics-central
EnvironmentFile=/home/ubuntu/metrics-central/.env
ExecStart=/home/ubuntu/metrics-central/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

\[Install]
WantedBy=multi-user.target
```

Restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart metrics-central
sudo systemctl status metrics-central
```

Kiểm tra:

```text
http://13.75.54.112:8000/docs
http://13.75.54.112:8000/api/servers
```

\---

# PHẦN C — VPS con

## 11\. Cài agent trên VPS con

Trên mỗi VPS con:

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip curl

mkdir -p \~/metrics-agent
cd \~/metrics-agent

python3 -m venv .venv
source .venv/bin/activate

pip install psutil requests
```

## 12\. File `agent.py`

Tạo file:

```bash
cd \~/metrics-agent
nano agent.py
```

Lưu ý quan trọng: mỗi VPS con phải có `SERVER\_ID` khác nhau.

Ví dụ VPS 1:

```python
SERVER\_ID = "vps-ubuntu-01"
SERVER\_NAME = "vps-ubuntu-01"
```

Ví dụ VPS 2:

```python
SERVER\_ID = "vps-ubuntu-02"
SERVER\_NAME = "vps-ubuntu-02"
```

Ví dụ VPS 3:

```python
SERVER\_ID = "vps-ubuntu-03"
SERVER\_NAME = "vps-ubuntu-03"
```

Agent phải có đủ các nhóm hàm:

```text
- Gửi register: POST /api/servers/register
- Gửi metrics: POST /api/metrics
- Poll task: GET /api/agent/tasks/{server\_id}
- Báo kết quả task: POST /api/agent/tasks/{task\_id}/result
- Tạo user SSH: create\_ssh\_user
- Xóa user SSH: delete\_ssh\_user
```

## 13\. Service agent trên VPS con

```bash
sudo nano /etc/systemd/system/metrics-agent.service
```

Nội dung:

```ini
\[Unit]
Description=Metrics Agent Sender
After=network.target

\[Service]
User=root
WorkingDirectory=/home/ubuntu/metrics-agent
ExecStart=/home/ubuntu/metrics-agent/.venv/bin/python -u /home/ubuntu/metrics-agent/agent.py
Restart=always
RestartSec=5

\[Install]
WantedBy=multi-user.target
```

Bật service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable metrics-agent
sudo systemctl restart metrics-agent
sudo systemctl status metrics-agent
```

Xem log:

```bash
sudo journalctl -u metrics-agent -f
```

\---

# PHẦN D — Bắt buộc: Cách thêm 1 VPS con mới vào hệ thống

Phần này dùng cho VPS 3, VPS 4, VPS 5...

## 14\. Bước 1 — Tạo VPS mới

Khi tạo VPS mới trên Azure:

```text
Image: Ubuntu Server 24.04 LTS
Username: ubuntu
Authentication: SSH public key
Public IP: có nếu muốn SSH trực tiếp
Inbound port: SSH 22
```

Sau khi tạo xong, ghi lại:

```text
Tên VPS mới
Public IP
Đường dẫn file .pem
SERVER\_ID muốn dùng
```

Ví dụ:

```text
Tên VPS mới: vps-ubuntu-03
Public IP: 1.2.3.4
Key file: D:\\...\\VM3\\vps-ubuntu-03-key.pem
SERVER\_ID: vps-ubuntu-03
```

## 15\. Bước 2 — SSH vào VPS mới

```powershell
ssh -i "D:\\DUONG\_DAN\_KEY\\VM3\\vps-ubuntu-03-key.pem" ubuntu@PUBLIC\_IP\_VPS\_3
```

Nếu báo lỗi quyền file `.pem`, sửa theo phần 4.

## 16\. Bước 3 — Kiểm tra VPS mới gọi được VPS trung tâm

Trên VPS mới:

```bash
curl http://13.75.54.112:8000/
```

Nếu có response từ FastAPI là kết nối được.

## 17\. Bước 4 — Cài môi trường agent

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip curl

mkdir -p \~/metrics-agent
cd \~/metrics-agent

python3 -m venv .venv
source .venv/bin/activate

pip install psutil requests
```

## 18\. Bước 5 — Tạo `agent.py`

```bash
cd \~/metrics-agent
nano agent.py
```

Dán code agent đang dùng cho VPS con.

Bắt buộc sửa:

```python
SERVER\_ID = "vps-ubuntu-03"
SERVER\_NAME = "vps-ubuntu-03"
```

Nếu thêm VPS 4:

```python
SERVER\_ID = "vps-ubuntu-04"
SERVER\_NAME = "vps-ubuntu-04"
```

Nếu thêm VPS 5:

```python
SERVER\_ID = "vps-ubuntu-05"
SERVER\_NAME = "vps-ubuntu-05"
```

## 19\. Bước 6 — Chạy thử agent

```bash
cd \~/metrics-agent
source .venv/bin/activate
python3 agent.py
```

Nếu đúng sẽ thấy:

```text
Register: {...} Status: 200
Metric: {...} Status: 200
```

Mở:

```text
http://13.75.54.112:8000/api/servers
```

Nếu thấy `vps-ubuntu-03` xuất hiện là VPS mới đã vào hệ thống.

Dừng chạy thử:

```text
Ctrl + C
```

## 20\. Bước 7 — Tạo service chạy nền

```bash
sudo nano /etc/systemd/system/metrics-agent.service
```

Dán:

```ini
\[Unit]
Description=Metrics Agent Sender
After=network.target

\[Service]
User=root
WorkingDirectory=/home/ubuntu/metrics-agent
ExecStart=/home/ubuntu/metrics-agent/.venv/bin/python -u /home/ubuntu/metrics-agent/agent.py
Restart=always
RestartSec=5

\[Install]
WantedBy=multi-user.target
```

Bật service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable metrics-agent
sudo systemctl restart metrics-agent
sudo systemctl status metrics-agent
```

Nếu thấy:

```text
Active: active (running)
```

là thành công.

## 21\. Bước 8 — Thêm metadata cho VPS mới

Sau khi VPS mới xuất hiện ở `/api/servers`, thêm metadata để frontend có tên/gói/giá.

Chạy PowerShell:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "X-Admin-Key" = "admin-demo-token"
}

$body = @{
  display\_name = "VPS Basic 03"
  specifications = "2 vCPU / 1GB RAM / Ubuntu 24.04"
  price\_per\_month = 5.99
  description = "VPS demo cho thuê"
  is\_available = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://13.75.54.112:8000/api/servers/vps-ubuntu-03/metadata" -Method PUT -Headers $headers -Body $body
```

Kiểm tra:

```text
http://13.75.54.112:8000/api/servers
```

## 22\. Bước 9 — Test thuê VPS mới

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "X-Admin-Key" = "admin-demo-token"
}

$body = @{
  server\_id = "vps-ubuntu-03"
  renter\_name = "test-user-vps3"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://13.75.54.112:8000/api/rentals/create" -Method POST -Headers $headers -Body $body
```

Nếu thành công, API trả về:

```text
rental\_id
server\_id
ip
port
username
private\_key\_filename
private\_key
ssh\_command
```

## 23\. Checklist thêm VPS mới

```text
\[ ] Tạo VPS Ubuntu mới.
\[ ] Có Public IP nếu muốn SSH trực tiếp.
\[ ] Mở SSH port 22.
\[ ] SSH vào VPS mới.
\[ ] Cài python3-venv, python3-pip, curl.
\[ ] Tạo thư mục \~/metrics-agent.
\[ ] Tạo .venv.
\[ ] Cài psutil, requests.
\[ ] Tạo agent.py.
\[ ] Đổi SERVER\_ID và SERVER\_NAME.
\[ ] Chạy thử python3 agent.py thấy Status: 200.
\[ ] Tạo metrics-agent.service.
\[ ] Service active running.
\[ ] Kiểm tra /api/servers thấy VPS mới.
\[ ] Thêm metadata cho VPS mới.
\[ ] Test thuê VPS mới nếu cần.
```

\---

# PHẦN E — Test thuê và hủy thuê

## 24\. Test thuê VPS

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "X-Admin-Key" = "admin-demo-token"
}

$body = @{
  server\_id = "vps-ubuntu-01"
  renter\_name = "test-user-01"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://13.75.54.112:8000/api/rentals/create" -Method POST -Headers $headers -Body $body
```

## 25\. Test hủy thuê VPS

Thay `RENTAL\_ID` bằng rental thật:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "X-Admin-Key" = "admin-demo-token"
}

Invoke-RestMethod -Uri "http://13.75.54.112:8000/api/rentals/RENTAL\_ID/cancel" -Method POST -Headers $headers
```

Xem rental:

```powershell
$headers = @{
  "X-Admin-Key" = "admin-demo-token"
}

Invoke-RestMethod -Uri "http://13.75.54.112:8000/api/rentals" -Method GET -Headers $headers
```

\---

# PHẦN F — Frontend và Local Backend

## 26\. Frontend gọi API nào?

Nếu frontend gọi thẳng VPS trung tâm:

```env
VITE\_SERVER\_API\_URL=http://13.75.54.112:8000
```

Nếu frontend gọi local backend proxy:

```env
VITE\_SERVER\_API\_URL=http://localhost:8000
```

## 27\. Edit server trên frontend

Cho edit:

```text
Server Name       → display\_name
Specifications    → specifications
Price per Month   → price\_per\_month
Description       → description
Available         → is\_available
```

Không cho edit:

```text
CPU
RAM
Disk
CPU Cores
RAM Total
OS
IP
Uptime
Online/Offline
```

Endpoint edit:

```text
PUT /api/servers/{server\_id}/metadata
```

Body:

```json
{
  "display\_name": "VPS Basic 01",
  "specifications": "2 vCPU / 1GB RAM / Ubuntu 24.04",
  "price\_per\_month": 5.99,
  "description": "VPS demo cho thuê",
  "is\_available": true
}
```

\---

# PHẦN G — Lệnh quản lý nhanh

## VPS trung tâm

```bash
sudo systemctl status metrics-central
sudo systemctl restart metrics-central
sudo journalctl -u metrics-central -f
```

## VPS con

```bash
sudo systemctl status metrics-agent
sudo systemctl restart metrics-agent
sudo journalctl -u metrics-agent -f
```

\---

## Kết luận

Thiết kế cuối cùng:

```text
VPS con:
- Gửi register
- Gửi metrics
- Nhận task tạo/xóa user

VPS trung tâm:
- Nhận dữ liệu
- Kết nối Azure SQL
- Quản lý server, metadata, rentals, tasks
- Điều phối task cho agent

Azure SQL:
- Lưu servers
- Lưu server\_metadata
- Lưu rentals
- Lưu tasks

RAM VPS trung tâm:
- Chỉ lưu history 2 giờ gần nhất
```

Quy trình thêm VPS con mới bắt buộc gồm:

```text
1. Tạo VPS mới.
2. Cài agent.
3. Đổi SERVER\_ID và SERVER\_NAME.
4. Chạy thử agent.
5. Tạo service.
6. Kiểm tra /api/servers.
7. Thêm metadata.
8. Test thuê VPS mới nếu cần.
```

