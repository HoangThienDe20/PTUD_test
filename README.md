# 🌐 Hệ Thống Giám Sát Dữ Liệu IoT Thời Gian Thực

**Real-Time IoT Data Monitoring System**

---

## 📋 Thông Tin Cơ Bản

### Tên Đề Tài
**Hệ Thống Giám Sát Dữ Liệu IoT Thời Gian Thực với Giao Diện Web Tương Tác**

**Mô tả**: Một nền tảng hoàn chỉnh để theo dõi, quản lý và phân tích dữ liệu từ các cảm biến IoT (Internet of Things). Hệ thống sử dụng WebSocket để streaming 100% dữ liệu real-time đến dashboard, đồng thời thực hiện lọc thông minh để lưu trữ (~33% dữ liệu quan trọng) vào cơ sở dữ liệu, giảm thiểu dung lượng lưu trữ mà vẫn đảm bảo tính liên tục của dữ liệu phân tích.

### 👥 Thành Viên Nhóm

| STT | Họ Tên | MSSV | Vai Trò |
|-----|--------|------|---------|
| 1 | **Lê Trung Hữu** | 23666491 | Trưởng nhóm, Backend architecture |
| 2 | **Huỳnh Nhật Hào** | 23663871 | Backend WebSocket, Database |
| 3 | **Phan Gia Huy** | 23674141 | Frontend React, UI/UX |
| 4 | **Trần Quốc Huy** | 23637731 | Testing, Documentation |

**Lớp**: PTUD_CE_01 | **HK**: 2, năm 2025-2026 | **Tiến độ**: 100% ✅

---

## 📖 Tổng Quan Đề Tài

### Bài Toán Đặt Ra
Trong xu thế Internet of Things (IoT), việc giám sát và quản lý các dữ liệu từ hàng ngàn cảm biến đồng thời trở nên phức tạp. Các thách thức chính bao gồm:

1. **Tính thời gian thực**: Dữ liệu từ cảm biến cần được hiển thị ngay lập tức trên dashboard
2. **Khối lượng dữ liệu lớn**: Lưu trữ 100% dữ liệu gây tốn dung lượng database
3. **Phân quyền truy cập**: Cần quản lý quyền cho admin và người dùng bình thường
4. **Cảnh báo thông minh**: Tự động phát hiện và thông báo khi dữ liệu vượt ngưỡng
5. **Phân tích lịch sử**: Cần công cụ để xem xu hướng dữ liệu trong thời gian dài

### Giải Pháp Đề Xuất
Xây dựng một hệ thống gồm:
- **Backend FastAPI**: Cung cấp API, WebSocket streaming, logic kinh doanh
- **Frontend React**: Dashboard tương tác, biểu đồ động, quản lý device
- **Cơ sở dữ liệu Azure SQL**: Lưu trữ dữ liệu quan trọng + thông tin hệ thống
- **Dual-Layer Architecture**: 
  - Layer 1 (Real-time): 100% dữ liệu stream qua WebSocket → Dashboard
  - Layer 2 (Storage): ~33% dữ liệu lừa chọn save vào Database

### Ưu Điểm
✅ **Khách hàng thấy 100% dữ liệu không bị lag/delay**  
✅ **Database tiết kiệm dung lượng (chỉ lưu dữ liệu thay đổi)**  
✅ **Phân tích lịch sử chính xác từ dữ liệu lưu trữ**  
✅ **Dễ bảo trì, mở rộng**  
✅ **Hỗ trợ multi-user với role-based access**

---

## ✨ Những Tính Năng Đã Thực Hiện

### 1. **🔐 Xác Thực & Phân Quyền**
- ✅ System đăng ký tài khoản (Signup/Registration)
- ✅ Đăng nhập với JWT tokens (JWT-based authentication)
- ✅ Hai vai trò người dùng: Admin & Regular User
- ✅ Approval workflow: Admin phê duyệt người dùng mới
- ✅ Mã hóa mật khẩu an toàn (bcrypt hashing)
- ✅ Token expiration & refresh logic

### 2. **📱 Quản Lý Thiết Bị IoT (User-Owned Devices)**
- ✅ Users tạo device mới với sensor type (temperature, humidity, soil_moisture, light_intensity, pressure)
- ✅ Chỉnh sửa thông tin device (name, location, status)
- ✅ Xóa device
- ✅ Auto-sync: Tạo device trong bảng `iot_devices` (user view) + `devices` (metrics generation)
- ✅ Mỗi device có `source` duy nhất để tracking metrics
- ✅ Device có thể bật/tắt (is_active flag)

### 3. **🎯 Hệ Thống Cảnh Báo (Alert System)**
- ✅ Threshold-based alerts: Lower threshold (min) & Upper threshold (max)
- ✅ Tự động trigger when: `value < lower_threshold` OR `value > upper_threshold`
- ✅ Visual feedback: Red border khi triggered, cyan border bình thường
- ✅ Lưu trữ alert history: Xem cảnh báo cũ với timestamp
- ✅ Resolve alerts: Đánh dấu alert đã xử lý
- ✅ Auto-cleanup: Xóa alert cũ (> 15 ngày) tự động

### 4. **📊 Dashboard & Biểu Đồ Dữ Liệu**
- ✅ **User Dashboard** với:
  - Device selector dropdown (chọn cảm biến để xem)
  - Date range picker (từ ngày → đến ngày)
  - **Hourly aggregation** (1 ngày → 24 điểm/giờ)
  - **Daily aggregation** (2+ ngày → N điểm/ngày)
  - Recharts LineChart visualization
  - Loading states & empty states
  - Debug logging
  
- ✅ **Admin Dashboard** với:
  - Total servers, users, pending users
  - Total devices, alerts, monthly revenue
  - Auto-refresh mỗi 30 giây

- ✅ **Device Manager**:
  - Grid layout hiển thị tất cả devices
  - Real-time metrics values
  - Chart modal với history data
  - Alert threshold editor

### 5. **🔄 Real-Time Streaming (WebSocket)**
- ✅ Endpoint: `WS /api/ws/{client_id}`
- ✅ 100% metrics broadcast đến tất cả connected clients
- ✅ Smart filtering: Chỉ save DB nếu `saved=true`
- ✅ Dual-layer:
  - Layer 1: Realtime stream (100% data) → Frontend dashboard
  - Layer 2: Smart DB save (~33% data) → Persistent storage
- ✅ Connection management (connect/disconnect/broadcast)

### 6. **📈 API History Queries** (✅ **FIXED**)
- ✅ `GET /api/metrics/history-by-date` endpoint
- ✅ Params: `metric_type`, `source`, `from_date`, `to_date`
- ✅ **FIX Applied**: Dùng date-range query tương thích đa hệ CSDL (bao gồm Azure SQL)
- ✅ Hoạt động chính xác cho:
  - Today (1-day view): 86+ records ✅
  - Past dates (2026-04-05): 12 records ✅
  - Date ranges (2026-04-04 to 2026-04-05): 28 records ✅
- ✅ Role-based access control: Mỗi user chỉ thấy devices của mình

### 7. **👨‍💼 Admin Management**
- ✅ Approve/Reject pending users
- ✅ Delete users
- ✅ View all users & devices
- ✅ View user summary statistics
- ✅ Disconnect/Reconnect devices
- ✅ Cannot edit user data (designed limitation)

### 8. **💾 Database & Data Storage**
- ✅ Azure SQL database
- ✅ 8 models: User, Device, Metric, Alert, IoTDevice, AvailableServer, ServerSubscription, Request
- ✅ Foreign key support
- ✅ Indexes for performance (metric_type, timestamp)
- ✅ 2,977 test records (14-day historical data)
- ✅ Timezone-aware (Vietnam TZ: UTC+7)
- ✅ ISO 8601 timestamp format

### 9. **🎨 Frontend UI/UX**
- ✅ Dark theme with neon colors (cyan, purple, orange, red, green, yellow)
- ✅ Responsive design (mobile-friendly)
- ✅ React 18 with Hooks (useState, useEffect, useContext)
- ✅ Context API for state management (AuthContext, DeviceContext)
- ✅ Recharts for data visualization
- ✅ Tailwind CSS for styling
- ✅ Lucide icons for UI elements
- ✅ Modal dialogs for add/edit operations
- ✅ Loading states, error handling, empty states

### 10. **🗂️ Project Structure & Organization**
- ✅ Clean folder structure (app/, frontend/, scripts)
- ✅ Separation of concerns (models, schemas, crud, routes, services)
- ✅ API versioning
- ✅ Configuration management
- ✅ Error handling middleware
- ✅ CORS enabled for frontend

### 11. **🧪 Test Data & Development**
- ✅ Demo accounts (admin/user with credentials)
- ✅ Demo servers & devices on startup
- ✅ `populate_metrics.py`: Generate 14-day historical data (6 records/hour)
- ✅ `stream_iot_data_live.py`: Continuous streaming for testing
- ✅ Test scripts for API validation

### 12. **📐 Fixed Issues During Development**
1. ✅ **Single-day query returns 0 records** → Fixed using date-range query chuẩn SQLAlchemy
2. ✅ **Alert colors not changing** → Fixed alert trigger logic & metrics fetching
3. ✅ **Default dashboard shows 7 days** → Changed to show today (1-day view)
4. ✅ **Demo devices auto-creation** → Removed unnecessary startup code

---

## 🛠️ Tech Stack

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.11 | Programming language |
| **FastAPI** | 0.104.1 | Web framework, async support |
| **Uvicorn** | 0.24.0 | ASGI server |
| **SQLAlchemy** | 2.0.23 | ORM for database |
| **Pydantic** | 2.5.0 | Data validation |
| **WebSockets** | 12.0 | Real-time communication |
| **JWT (python-jose)** | 3.3.0 | Authentication tokens |
| **bcrypt (passlib)** | 1.7.4 | Password hashing |
| **psutil** | 5.9.6 | System metrics |
| **Azure SQL Database** | - | Database |

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 18 | UI framework |
| **Vite** | Latest | Build tool |
| **Axios** | Latest | HTTP client |
| **Recharts** | Latest | Data visualization |
| **Tailwind CSS** | Latest | Styling |
| **Lucide React** | Latest | Icons |
| **React Context** | - | State management |

### Infrastructure
| Tool | Purpose |
|------|---------|
| **Git** | Version control |
| **npm** | Package manager (frontend) |
| **pip** | Package manager (backend) |
| **Vite Dev Server** | Frontend development |

---

## 📊 Kiến Trúc Hệ Thống

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React 18)                          │
│  - User Dashboard (date range, sensor selector, charts)         │
│  - Admin Dashboard (stats, user management)                     │
│  - Device Manager (CRUD, alerts, real-time metrics)             │
│  - Login/Signup                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │ Axios HTTP + WebSocket
                         │
┌────────────────────────┴────────────────────────────────────────┐
│              BACKEND (FastAPI + WebSocket)                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ API Routes                                              │   │
│  │ - /api/auth (login, register)                          │   │
│  │ - /api/iot-devices (CRUD)                              │   │
│  │ - /api/metrics/history-by-date (date range query)      │   │
│  │ - /api/alerts (CRUD)                                   │   │
│  │ - /api/admin (user/device management)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ WebSocket Endpoint: /api/ws/{client_id}                │   │
│  │ - 100% data broadcast to all connected clients         │   │
│  │ - Smart DB filtering (save ~33% of data)              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ CRUD Operations (app/crud.py)                           │   │
│  │ - User management, Device CRUD, Metrics queries         │   │
│  │ - Permissions & Access control                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ SQLAlchemy ORM
                         │
┌────────────────────────┴────────────────────────────────────────┐
│            DATABASE (Azure SQL Database)                        │
│  - metrics (2,977 records, 14-day history)                      │
│  - users, iot_devices, alerts, servers, subscriptions           │
│  - indexes on (metric_type, timestamp) for fast queries         │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow (Dual-Layer Architecture)
```
IoT Sensor Generator
        │
        ├─── WebSocket Send (IotMetricsData)
        │
        ▼
┌──────────────────────┐
│ Backend /ws endpoint │
└──────────────────────┘
        │
        ├─ Branch 1 (Real-time):
        │   └─ Broadcast 100% to all connected frontend clients
        │      └─ Immediate chart update (no delay)
        │
        └─ Branch 2 (Storage):
            └─ Check "saved" flag
            └── YES: Save to Database (~33% important data)
            └── NO: Skip (reduces DB size)
```

### Alert Trigger Logic
```
Device Settings:
  ├─ alert_enabled: boolean
  ├─ lower_threshold: float (min value)
  └─ upper_threshold: float (max value)

When new metric arrives:
  if (value < lower_threshold) OR (value > upper_threshold):
      └─ ALERT TRIGGERED ❌ (Red border)
  else:
      └─ Normal status ✅ (Cyan border)

Alert stored in:
  └─ alerts table (timestamp, value, threshold, status)
  └─ Auto-cleanup old alerts (> 15 days)
```

---

## 🚀 Hướng Dẫn Chạy Hệ Thống

### Yêu Cầu Tiên Quyết
- **Python**: 3.8+
- **Node.js**: 16+ với npm
- **Terminal** hoặc Command Prompt
- **Text Editor** hoặc IDE (VSCode, PyCharm, etc.)

### Installation Steps

#### 1️⃣ Backend Setup
```bash
# Clone/Navigate to project
cd test_CK_PTUD-main

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

#### 2️⃣ Frontend Setup
```bash
cd frontend
npm install
```

#### 3️⃣ Database Setup (Optional - Auto-creates)
```bash
# Database auto-creates on first backend run
# Populate with test data:
python populate_metrics.py
```

### Running the System

**Terminal 1: Start Backend Server**
```bash
python -m uvicorn app.main:app --reload --port 8000
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Output:
# INFO:     Uvicorn running on http://127.0.0.1:8000
# INFO:     Application startup complete
# 
# Access API docs: http://localhost:8000/docs
```

**Terminal 2: Start Frontend Dev Server**
```bash
cd frontend
npm run dev

# Output:
# VITE v4.x.x  ready in xxx ms
# ➜  Local:   http://localhost:5173/
```

**Terminal 3 (Optional): Start Continuous Data Streaming**
```bash
python stream_iot_data_live.py

python stream_iot_data_live.py --broker 20.214.247.102 --port 1883 --topic sensors/sensor-01/data

python stream_iot_data_live.py `
  --broker 20.214.247.102 `
  --port 1883 `
  --username sensor_user `
  --password 123456 `
  --topic-template 'sensors/{source}/data'


# Output:
# [14:30:45] Batch #1 | Generated: 5 | Sent: 5 | Saved: 1
#   ✅ SEND temperature = 24.50 °C
#   ⏭️  SKIP humidity = 65.20 %
```

### Default Credentials
- **Admin Account**:
  - Username: `letrunghuu`
  - Password: `123456789`
  
- **User Account**:
  - Email: `user@example.com`
  - Password: `user123`

### Access URLs
- **Backend API**: http://localhost:8000
- **API Docs (Swagger)**: http://localhost:8000/docs
- **Frontend Dashboard**: http://localhost:5173

---

## 📈 Hướng Phát Triển Tương Lai

### Phase 2: Enhanced Features
- 🔄 **Data Export**: Export metrics to CSV/PDF
- 📧 **Email Notifications**: Send alerts via email when threshold exceeded
- 🌍 **Multi-language**: Support Vietnamese, English, Chinese
- 🔔 **Push Notifications**: Mobile push alerts for critical incidents
- 📱 **Mobile App**: Native mobile app using React Native

### Phase 3: Advanced Analytics
- 🤖 **Machine Learning**: Predictive analytics for anomaly detection
- 📊 **Advanced Reports**: Custom reporting & business intelligence
- 💹 **Data Aggregation**: Combine metrics from multiple sources
- 📉 **Trend Analysis**: Automatic trend detection & forecasting
- 🔍 **Data Search**: Full-text search across historical data

### Phase 4: Scalability & Performance
- ☁️ **Cloud Deployment**: Deploy to AWS/Azure/GCP
- 🗄️ **PostgreSQL Migration**: (Optional) add PostgreSQL support for multi-cloud flexibility
- ⚡ **Redis Caching**: In-memory caching for faster queries
- 🔀 **Load Balancing**: Multiple backend instances
- 📦 **Docker Containerization**: Docker & Kubernetes deployment
- 🟢 **GraphQL API**: Alternative to REST for flexible queries

### Phase 5: Enterprise Features
- 🔐 **Advanced Security**: 2FA, OAuth2, SAML integration
- 🎯 **RBAC**: Fine-grained role-based access control
- 🌐 **Geo-Mapping**: Map-based device visualization
- 📡 **IoT Integration**: Direct integration with popular IoT platforms (Azure IoT Hub, AWS IoT Core)
- 💼 **White-label Solution**: Customizable branding
- 🔔 **Webhook Support**: External system integrations
- 📊 **Data Stream Processing**: Apache Kafka for high-volume streaming
- 🛡️ **Audit Logging**: Comprehensive audit trails

### Phase 6: Developer Experience
- 📚 **SDK/Libraries**: Official SDKs for popular languages (Python, JS, Go)
- 🧪 **Comprehensive Testing**: Unit tests, integration tests, E2E tests
- 📖 **API Documentation**: OpenAPI/Swagger documentation
- 🎓 **Training Materials**: Video tutorials, blog posts, courses
- 🔧 **CLI Tool**: Command-line tool for system management

---

## 📝 Ghi Chú Kỹ Thuật

### Database Statistics
- **Current Records**: 2,977 metrics
- **Date Range**: 2026-03-30 to 2026-04-13 (14 days)
- **Sensor Types**: 5 types (temperature, humidity, soil_moisture, light_intensity, pressure)
- **Distribution**: 6 records/hour × 24 hours × 14 days
- **Storage**: Managed on Azure SQL Database

### Performance Metrics
- **WebSocket Latency**: <100ms (local network)
- **API Response Time**: <50ms (typical)
- **Streaming Rate**: 5 metrics/batch, ~60 metrics/minute
- **Database Queries**: Indexed for O(log n) complexity
- **Memory Usage**: ~150MB (backend + frontend)

### Security Features
- ✅ JWT-based authentication with token expiration
- ✅ Password hashing using bcrypt
- ✅ CORS enabled for controlled frontend access
- ✅ Input validation using Pydantic schemas
- ✅ SQL injection prevention (SQLAlchemy parameterized queries)
- ✅ Role-based access control (RBAC)

### Known Limitations
- Azure SQL introduces cloud dependency and network latency considerations
- Basic authentication (no 2FA or OAuth)
- Limited to local network WebSocket connections
- Historical data aggregation done in-memory (not database-level)

---

## 📞 Liên Hệ & Hỗ Trợ

### Thắc Mắc Kỹ Thuật
- Liên hệ trưởng nhóm (Lê Trung Hữu - 23666491)
- Hoặc check repo GitHub (nếu có)

### Báo Cáo Lỗi (Bug Report)
1. Mô tả rõ lỗi xảy ra
2. Cung cấp reproduction steps
3. Screenshots/logs nếu có thể
4. Phiên bản Python/Node/React của bạn

---

## 📄 License

Dự án này được phát triển cho mục đích học tập.  
Tự do sử dụng, sửa đổi cho mục đích giáo dục.

---

## 🙏 Cảm Ơn

Cảm ơn thầy cô đã hướng dẫn dự án này.  
Cảm ơn toàn bộ bạn bè trong nhóm vì sự cố gắng và dedications! 💪

---

**Last Updated**: April 13, 2026  
**Version**: 2.0.0  
**Status**: ✅ 100% Complete & Functional

---

## PostgreSQL Quick Setup

Hệ thống hiện dùng PostgreSQL:

1. Cài PostgreSQL và tạo database trước (ví dụ `metrics_db`).
2. Cài dependencies:
```bash
pip install -r requirements.txt
```
3. Mở `.env`, cấu hình các biến DB:
```env
DB_HOST=<postgres-host>
DB_PORT=5432
DB_DATABASE=<database>
DB_USERNAME=<username>
DB_PASSWORD=<password>
# Optional:
# DATABASE_URL=postgresql+psycopg2://<username>:<password>@<postgres-host>:5432/<database>
```
4. Khởi chạy backend bình thường, app sẽ đọc cấu hình DB từ các biến trên.
5. (Tuỳ chọn) migrate dữ liệu cũ từ SQLite:
```bash
python migrate_sqlite_to_target_db.py
```
