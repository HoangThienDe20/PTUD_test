# Chức năng hệ thống CK4 hiện tại

Tài liệu này được viết lại bằng cách đọc code hiện tại trong thư mục dự án, không dựa vào các file `.md` cũ.

## 1. Tổng quan kiến trúc

Hệ thống được chia thành nhiều phần chạy độc lập nhưng phối hợp với nhau:

| Thành phần | Thư mục | Vai trò chính |
|---|---|---|
| Frontend | `frontend/` | Dashboard React cho người dùng/admin, hiển thị metric, IoT device, cảnh báo, server store, chat hỗ trợ, dự báo AI |
| App backend | `app/` | Backend trung gian cho frontend, xử lý auth, admin, server store, chat, proxy model backend và proxy IoT control |
| IoT backend | `iot_backend/` | Service IoT chuyên dụng, nhận dữ liệu cảm biến, MQTT ESP32, WebSocket realtime, quản lý IoT device, cảnh báo |
| Model backend | `model_backend/` | Service dự báo AI/ML, XGBoost, TFT, dự báo dashboard, đồng bộ dữ liệu thời tiết |
| Server backend | `server_backend/` | Metrics Central cho VPS con, nhận metric server, quản lý rental và task tạo/xóa SSH user |
| ESP32 firmware | `iot_backend/firmware/` | Firmware mẫu cho ESP32 DHT11 + MQTT + relay + đổi WiFi |
| Scripts | root scripts | Sinh dữ liệu mẫu, stream IoT, thu thập system metric |

Luồng chính:

```text
Frontend
  -> app backend : auth, admin, chat, server store, model proxy, IoT control proxy
  -> iot_backend : IoT metrics, IoT devices, alerts, websocket

ESP32
  -> MQTT broker
  -> iot_backend
  -> PostgreSQL + WebSocket
  -> Frontend

app backend
  -> model_backend : dự báo AI
  -> server_backend : danh sách VPS, rental, metadata server
  -> iot_backend : scan WiFi / đổi WiFi ESP32
```

## 2. Frontend

Frontend là app React/Vite, dùng `axios`, `recharts`, `lucide-react`, Tailwind CSS.

Các màn hình chính:

| Component | Chức năng |
|---|---|
| `Login.jsx` | Đăng nhập/đăng ký, lưu JWT vào `localStorage` |
| `Sidebar.jsx` | Menu điều hướng chính |
| `Dashboard.jsx` | Dashboard metric tổng hợp kiểu cũ |
| `UserDashboard.jsx` | Dashboard người dùng, chọn IoT device, xem lịch sử, forecast, TFT/weather pipeline |
| `AdminDashboard.jsx` | Tổng quan admin: server, user, alert, IoT device |
| `IoTDeviceManager.jsx` | Quản lý sensor/IoT device, thêm/sửa/xóa, trạng thái active, biểu đồ, alert threshold, AI context, notification target, WiFi ESP32 |
| `IoTMetrics.jsx` | Xem realtime/lịch sử metric IoT theo loại: temperature, humidity, soil_moisture, light_intensity, pressure |
| `Alerts.jsx` | Danh sách cảnh báo gần đây, gọi AI giải thích alert |
| `ServerStore.jsx` | Marketplace thuê server, request/confirm rental, tải private key, cancel rental, admin duyệt request và cấu hình giá |
| `SupportChat.jsx` | Chat bot/user/admin, escalate sang admin, admin reply/close conversation |
| `AdminPanel.jsx` | Admin duyệt user, quản lý user, quản lý device quyền truy cập |
| `ClientMonitor.jsx` | Theo dõi client WebSocket đang kết nối |
| `CPUMetrics.jsx` / `MemoryMetrics.jsx` | Biểu đồ CPU/RAM |

Frontend định tuyến API trong `frontend/src/api.js`:

| Nhóm URL | Backend đích |
|---|---|
| `/api/iot-devices`, `/api/metrics`, `/api/alerts`, `/api/admin/iot-devices`, `/api/health` | `iot_backend` |
| Các API còn lại | `app` backend |

Riêng API WiFi ESP32 hiện đi qua `app` backend:

| API frontend gọi | Ý nghĩa |
|---|---|
| `POST /api/iot-control/wifi-scan` | Yêu cầu ESP32 scan WiFi |
| `GET /api/iot-control/wifi-scan?sensor_id=...` | Lấy danh sách WiFi ESP32 gửi về |
| `POST /api/iot-control/wifi-config` | Gửi SSID/password mới xuống ESP32 |

## 3. App backend (`app/`)

App backend là FastAPI chính cho frontend local/core. Entry point: `app/main.py`.

Router đang được mount:

| Router | Prefix | Chức năng |
|---|---|---|
| `routes_auth` | `/api/auth` | Đăng ký, đăng nhập, JWT, profile, notification target |
| `routes_admin` | `/api/admin` | Admin duyệt user, quản lý device và quyền truy cập |
| `routes_servers` | `/api/servers` | Server store, remote VPS, rental, subscription request |
| `routes_chat` | `/api/chat` | Chat hỗ trợ user/bot/admin |
| `routes_model_proxy` | `/api/model`, `/api/dashboard` | Proxy sang `model_backend` |
| `routes_iot_proxy` | `/api/iot-control` | Proxy lệnh điều khiển WiFi sang `iot_backend` |

### 3.1 Auth và user

Chức năng:

| API | Ý nghĩa |
|---|---|
| `POST /api/auth/register` | Đăng ký user, mặc định cần admin duyệt |
| `POST /api/auth/login` | Đăng nhập, trả JWT |
| `GET /api/auth/me` | Lấy user hiện tại |
| `GET /api/auth/me/devices` | Lấy device user được phép xem |
| `GET /api/auth/users/{user_id}` | Lấy thông tin user theo id |

Thông báo:

| API | Ý nghĩa |
|---|---|
| `POST /api/auth/telegram/link` | Gắn Telegram chat id |
| `POST /api/auth/telegram/test` | Gửi test Telegram |
| `DELETE /api/auth/telegram/unlink` | Gỡ Telegram |
| `POST /api/auth/email/enable` | Bật email alert |
| `POST /api/auth/email/test` | Gửi test email |
| `GET /api/auth/email/status` | Xem trạng thái email |
| `PATCH /api/auth/email/toggle` | Bật/tắt email |
| `PATCH /api/auth/email/update` | Đổi email |
| `DELETE /api/auth/email/disable` | Tắt email |
| `GET/POST/PATCH/DELETE /api/auth/notifications/targets` | Quản lý nhiều target email/telegram |

### 3.2 Admin

Chức năng admin:

| API | Ý nghĩa |
|---|---|
| `GET /api/admin/users/pending` | Danh sách user chờ duyệt |
| `POST /api/admin/users/{id}/approve` | Duyệt user |
| `POST /api/admin/users/{id}/reject` | Từ chối user |
| `GET /api/admin/users` | Danh sách user |
| `DELETE /api/admin/users/{id}` | Xóa user |
| `POST /api/admin/devices` | Tạo device hệ thống |
| `GET /api/admin/devices` | Danh sách device |
| `PUT /api/admin/devices/{id}` | Sửa device |
| `PUT /api/admin/devices/{id}/toggle` | Bật/tắt device |
| `DELETE /api/admin/devices/{id}` | Xóa device |
| `POST /api/admin/users/{user_id}/devices/{device_id}/grant` | Cấp quyền xem device |
| `DELETE /api/admin/users/{user_id}/devices/{device_id}/revoke` | Thu hồi quyền |
| `GET /api/admin/users/{user_id}/devices` | Device user được cấp quyền |
| `GET /api/admin/devices/{device_id}/users` | User có quyền xem device |

### 3.3 Server store / rental VPS

`app/api/routes_servers.py` gọi sang `server_backend` qua `METRICS_CENTRAL_BASE_URL`.

Chức năng user:

| API | Ý nghĩa |
|---|---|
| `GET /api/servers` | Xem server đang có |
| `GET /api/servers/{server_id}/history` | Lịch sử CPU/RAM server |
| `POST /api/servers/rent/request` | Tạo mã xác nhận thuê server |
| `POST /api/servers/rent/confirm` | Xác nhận thuê server |
| `GET /api/servers/my-rentals` | Rental của user |
| `POST /api/servers/rentals/private-key/request` | Xin mã lấy private key |
| `POST /api/servers/rentals/private-key/confirm` | Xác nhận và nhận private key |
| `POST /api/servers/rentals/cancel/request` | Xin mã hủy rental |
| `POST /api/servers/rentals/cancel/confirm` | Xác nhận hủy rental |
| `POST /api/servers/requests` | Gửi yêu cầu subscribe server |
| `GET /api/servers/requests` | Danh sách request của user |
| `DELETE /api/servers/{server_id}/unsubscribe` | Hủy subscription |

Chức năng admin:

| API | Ý nghĩa |
|---|---|
| `GET /api/servers/admin/servers` | Danh sách server từ Metrics Central |
| `GET /api/servers/admin/requests/pending` | Request chờ duyệt |
| `PUT /api/servers/admin/requests/{id}/approve` | Duyệt request |
| `PUT /api/servers/admin/requests/{id}/reject` | Từ chối request |
| `GET /api/servers/rentals` | Tất cả rental |
| `GET /api/servers/admin/system-info` | Thông tin phần cứng backend local |
| `PUT /api/servers/admin/servers/{server_id}/price` | Cập nhật giá |
| `PATCH /api/servers/admin/servers/{server_id}` | Cập nhật metadata server |

### 3.4 Chat hỗ trợ

Chức năng:

| API | Ý nghĩa |
|---|---|
| `GET /api/chat/conversations` | Conversation của user |
| `POST /api/chat/conversations/new` | Tạo conversation |
| `GET /api/chat/conversations/{id}` | Xem message |
| `POST /api/chat/send` | User gửi message, bot trả lời nếu còn bot_active |
| `POST /api/chat/escalate` | Chuyển sang admin |
| `DELETE /api/chat/conversations/{id}` | Xóa conversation |
| `GET /api/chat/admin/conversations` | Admin xem conversation |
| `POST /api/chat/admin/conversations/{id}/reply` | Admin trả lời |
| `POST /api/chat/admin/conversations/{id}/close` | Đóng conversation |
| `GET/POST/PATCH/DELETE /api/chat/admin/issue-templates` | Admin quản lý mẫu vấn đề |

Bot chat có dùng `GEMINI_API_KEY` nếu có, và có fallback trả lời dựa trên context metric/device của user.

### 3.5 Proxy model backend

App backend không tự train/predict mà kiểm tra quyền user rồi gọi `model_backend`.

| API app | API model backend tương ứng | Ý nghĩa |
|---|---|---|
| `GET /api/model/health` | `/api/model/health` | Health |
| `GET /api/model/metrics/predict` | `/api/model/metrics/predict` | Dự báo ngắn hạn |
| `POST /api/model/metrics/train-xgboost` | `/api/model/metrics/train-xgboost` | Train XGBoost offline |
| `GET /api/dashboard/forecast` | `/api/model/dashboard/forecast` | Forecast dashboard |
| `GET /api/model/tft-training/devices/{id}/status` | cùng path | Xem dataset TFT |
| `POST /api/model/tft-training/devices/{id}/train` | cùng path | Train TFT |
| `POST /api/model/weather-pipeline/devices/{id}/sync` | cùng path | Đồng bộ weather history |

### 3.6 Proxy IoT WiFi

`app/api/routes_iot_proxy.py` forward JWT sang `iot_backend`.

| API app | API IoT backend | Ý nghĩa |
|---|---|---|
| `POST /api/iot-control/wifi-scan` | `POST /api/devices/wifi-scan` | Gửi lệnh scan WiFi |
| `GET /api/iot-control/wifi-scan?sensor_id=...` | `GET /api/devices/wifi-scan` | Lấy WiFi scan cache |
| `POST /api/iot-control/wifi-config` | `POST /api/devices/wifi-config` | Gửi SSID/password mới |

Cấu hình quan trọng:

```env
IOT_BACKEND_URL=http://<vps_ip>:8100
MODEL_BACKEND_URL=http://127.0.0.1:8200
METRICS_CENTRAL_BASE_URL=http://<metrics-central>:9000
```

`app/config.py` hiện ưu tiên đọc `app/.env`, rồi fallback sang `.env` ở root project.

## 4. IoT backend (`iot_backend/`)

IoT backend là FastAPI service chuyên cho dữ liệu IoT. Entry point: `iot_backend/main.py`, mặc định chạy port `8100`.

Router:

| Router | Prefix | Chức năng |
|---|---|---|
| `routes_metrics` | `/api` | Metric CRUD/read, health, sample data |
| `routes_alerts` | `/api` | Alert list/resolve/explain AI |
| `routes_auth` | `/api/auth` | Auth riêng cho IoT backend |
| `routes_admin_iot` | `/api/admin` | Admin quản lý IoT devices |
| `routes_iot_devices` | `/api/iot-devices` | User-owned IoT device |
| `routes_devices` | `/api/devices` | Điều khiển ESP32 relay/WiFi/MQTT status |
| `routes_websocket` | `/api/ws`, `/api/status` | WebSocket realtime và status client |

### 4.1 MQTT ESP32

`iot_backend/mqtt_service.py`:

| Thành phần | Ý nghĩa |
|---|---|
| `MQTT_SENSOR_TOPIC` | Topic nhận sensor data, mặc định `sensors/+/data` |
| `MQTT_COMMAND_TOPIC_PREFIX` | Prefix gửi lệnh ESP32, mặc định `ptdl/devices` |
| `MQTT_WIFI_LIST_TOPIC` | Topic nhận danh sách WiFi, mặc định `ptdl/devices/+/wifi-list` |
| `publish_commands` | Gửi lệnh relay/manual/auto |
| `publish_wifi_config` | Gửi cấu hình WiFi mới |
| `publish_wifi_scan_request` | Gửi yêu cầu scan WiFi |
| `wifi_scan_cache` | Cache danh sách WiFi theo `sensor_id` |

Luồng sensor:

```text
ESP32 publish sensors/<sensor_id>/data
  -> mqtt_service.parse_sensor_payload
  -> iot_backend.main.handle_mqtt_reading
  -> save_iot_metric_to_db
  -> PostgreSQL metrics
  -> WebSocket broadcast
  -> Frontend realtime
```

Luồng WiFi:

```text
Frontend modal WiFi
  -> app /api/iot-control/wifi-scan
  -> iot_backend /api/devices/wifi-scan
  -> MQTT ptdl/devices/<sensor_id>/commands {"scan_wifi": true}
  -> ESP32 scan nearby WiFi
  -> MQTT ptdl/devices/<sensor_id>/wifi-list
  -> iot_backend cache
  -> frontend dropdown
```

Lưu ý hiện trạng firmware:

Firmware trong `iot_backend/firmware/DHT11WifiPostgres.ino` có đổi WiFi qua MQTT payload `{"wifi":{"ssid":"...","password":"..."}}`, nhưng file này trong repo chưa thể hiện phần publish `wifi-list`. Backend/frontend đã có API scan WiFi; để dropdown có dữ liệu, firmware ESP32 đang nạp cần hỗ trợ lệnh `scan_wifi` và publish về `ptdl/devices/<sensor_id>/wifi-list`.

### 4.2 IoT device của user

`iot_backend/api/routes_iot_devices.py`:

| API | Ý nghĩa |
|---|---|
| `POST /api/iot-devices` | User tạo IoT device, đồng thời tạo record `Device` để metric map được |
| `GET /api/iot-devices` | User xem device của mình |
| `PUT /api/iot-devices/{id}` | Sửa tên, loại metric, location, trạng thái, AI context |
| `DELETE /api/iot-devices/{id}` | Xóa IoT device, disable device sinh metric |
| `PUT /api/iot-devices/{id}/alert-thresholds` | Bật/tắt threshold alert |
| `POST /api/iot-devices/geocode` | Geocode location ngoài trời |

Quan trọng:

`source` của IoT device phải khớp với `sensor_id` trong dữ liệu ESP32 nếu muốn metric, quyền truy cập và điều khiển map đúng. Ví dụ ESP32 publish `sensor_id = esp32_devkit_v1` thì nên tạo device với `source = esp32_devkit_v1`.

### 4.3 Metric và alert

Metric:

| API | Ý nghĩa |
|---|---|
| `GET /api/health` | Health |
| `POST /api/metrics` | Tạo metric |
| `POST /api/metrics/bulk` | Tạo nhiều metric |
| `GET /api/metrics/latest` | Metric mới nhất |
| `GET /api/metrics/history` | Lịch sử theo metric/source/minutes |
| `GET /api/metrics/history-by-date` | Lịch sử theo khoảng ngày |
| `GET /api/metrics/summary` | Trung bình trong N phút |
| `POST /api/dev/generate-sample-data` | Sinh dữ liệu mẫu |
| `POST /api/dev/generate-iot-data` | Sinh dữ liệu IoT mẫu |

Alert:

| API | Ý nghĩa |
|---|---|
| `POST /api/alerts` | Tạo alert |
| `GET /api/alerts` | Danh sách alert |
| `GET /api/alerts/recent` | Alert gần đây |
| `GET /api/alerts/unresolved` | Alert chưa resolve |
| `GET /api/alerts/by-metric/{metric_type}` | Alert theo loại metric |
| `PATCH /api/alerts/{id}/resolve` | Resolve alert |
| `DELETE /api/alerts/cleanup` | Xóa alert cũ |
| `GET /api/alerts/{id}/explain-ai` | Gọi Gemini giải thích alert |

Alert threshold của IoT device được kiểm tra khi WebSocket/MQTT lưu metric, sau đó gửi notification qua Telegram/email nếu user có target.

### 4.4 Điều khiển ESP32

`iot_backend/api/routes_devices.py`:

| API | Ý nghĩa |
|---|---|
| `GET /api/devices` | Trạng thái runtime relay/auto |
| `POST /api/devices` | Set manual fan/fog/lamp/auto |
| `POST /api/devices/toggle-fan` | Đảo trạng thái fan |
| `POST /api/devices/toggle-fog` | Đảo trạng thái fog |
| `POST /api/devices/toggle-lamp` | Đảo trạng thái lamp |
| `POST /api/devices/auto-mode` | Bật auto |
| `POST /api/devices/manual-mode` | Tắt auto |
| `GET /api/devices/mqtt-status` | Trạng thái MQTT, payload gần nhất |
| `POST /api/devices/wifi-config` | Gửi WiFi mới cho ESP32 |
| `POST /api/devices/wifi-scan` | Gửi lệnh scan WiFi |
| `GET /api/devices/wifi-scan` | Lấy kết quả scan WiFi |

Các API WiFi có kiểm tra quyền theo `IoTDevice.source == sensor_id`, admin được phép mọi sensor.

### 4.5 WebSocket realtime

`iot_backend/api/routes_websocket.py`:

| Endpoint | Ý nghĩa |
|---|---|
| `WS /api/ws/{client_id}?token=<JWT>` | Viewer có JWT nhận realtime metric theo quyền |
| `WS /api/ws/{client_id}` | Publisher không token có thể gửi metric |
| `GET /api/status` | Danh sách client WebSocket |
| `GET /api/status/{client_id}` | Chi tiết client |
| `GET /api/health` | Health WebSocket server |

Message IoT realtime có dạng:

```json
{
  "type": "iot_metric",
  "metric_type": "temperature",
  "value": 30.1,
  "source": "esp32_devkit_v1",
  "timestamp": "2026-05-22T..."
}
```

## 5. Model backend (`model_backend/`)

Model backend là FastAPI service riêng, mặc định port `8200`. Tất cả route `/api/model/*` yêu cầu header service token `X-Model-Token` nếu cấu hình.

Chức năng chính:

| API | Ý nghĩa |
|---|---|
| `GET /api/model/health` | Health |
| `GET /api/model/metrics/predict` | Dự báo ngắn hạn bằng XGBoost model nếu có, fallback trend nếu thiếu dữ liệu/model |
| `POST /api/model/metrics/train-xgboost` | Train model XGBoost offline cho source + metric_type |
| `GET /api/model/dashboard/forecast` | Dự báo dashboard theo device, ưu tiên weather/location context nếu phù hợp |
| `GET /api/model/tft-training/devices/{id}/status` | Tóm tắt dataset cho TFT |
| `POST /api/model/tft-training/devices/{id}/train` | Train TFT weather model |
| `POST /api/model/weather-pipeline/devices/{id}/sync` | Đồng bộ weather historical từ Meteostat/Open-Meteo style service |

Dữ liệu liên quan:

| Bảng/model | Ý nghĩa |
|---|---|
| `metrics` | Metric IoT thực tế |
| `iot_devices` | Metadata device, source, location, tọa độ |
| `weather_historical` | Dữ liệu thời tiết lịch sử theo device/source |
| `prediction_store` | Được tạo động bởi service lưu forecast |

Prediction service có nhiều lớp fallback:

```text
trained XGBoost model
  -> train on available metric/thongke data
  -> trend forecast
  -> fallback default value
```

## 6. Server backend (`server_backend/`)

Server backend là Metrics Central cho hệ thống server/VPS. Entry point: `server_backend/app/main.py`.

Chức năng:

| API | Ý nghĩa |
|---|---|
| `POST /api/servers/register` | Agent VPS con đăng ký metadata server |
| `POST /api/metrics` | Agent gửi CPU/RAM/disk hiện tại |
| `GET /api/metrics/history?server_id=...` | Lịch sử 2 giờ gần nhất trong RAM |
| `GET /api/servers` | Danh sách server + metadata |
| `PUT /api/servers/{server_id}/metadata` | Admin cập nhật tên hiển thị, giá, mô tả, availability |
| `POST /api/rentals/create` | Admin tạo rental, sinh task create SSH user |
| `POST /api/rentals/{rental_id}/cancel` | Admin hủy rental, sinh task delete SSH user |
| `GET /api/rentals` | Danh sách rental |
| `GET /api/agent/tasks/{server_id}` | Agent poll task pending |
| `POST /api/agent/tasks/{task_id}/result` | Agent báo kết quả task |

Agent VPS con nằm ở `server_backend/agent/agent.py`:

| Chức năng agent | Ý nghĩa |
|---|---|
| Register server | Gửi CPU cores, RAM, OS, architecture |
| Push metrics mỗi 5 giây | CPU/RAM/disk/uptime |
| Poll task | Nhận task tạo/xóa user SSH |
| Report task result | Cập nhật rental active/cancelled/failed |

Lưu ý: private key trong `server_backend/app/main.py` hiện là chuỗi fake placeholder cho flow demo.

## 7. Firmware ESP32 trong repo

File: `iot_backend/firmware/DHT11WifiPostgres.ino`.

Chức năng hiện thấy trong repo:

| Nhóm | Chức năng |
|---|---|
| WiFi | Kết nối WiFi mặc định, lưu SSID/password vào `Preferences`, đổi WiFi qua Serial |
| MQTT | Kết nối broker, publish sensor, subscribe command |
| Sensor | Đọc DHT11 temperature/humidity mỗi 5 giây |
| Relay | Điều khiển fan/fog/lamp theo command |
| MQTT command | Nhận `commands`, `serial`, hoặc `wifi` payload |
| WiFi MQTT update | Nhận `{"wifi":{"ssid":"...","password":"..."}}`, lưu và reconnect |

Topic firmware repo:

| Topic | Ý nghĩa |
|---|---|
| `sensors/esp32_devkit_v1/data` | ESP32 publish temperature/humidity |
| `ptdl/devices/esp32_devkit_v1/commands` | ESP32 nhận lệnh |

Điểm cần đồng bộ:

Backend hiện đã có chức năng scan WiFi và nhận `ptdl/devices/+/wifi-list`. Firmware trong repo chưa thấy phần xử lý `scan_wifi` và publish danh sách WiFi. Nếu muốn chức năng dropdown WiFi trên frontend chạy đủ, firmware nạp vào ESP32 cần là bản có:

```json
{"scan_wifi": true}
```

và publish kết quả:

```text
ptdl/devices/<sensor_id>/wifi-list
```

## 8. Database chính

Các bảng chung trong `app/models.py` và `iot_backend/models.py` gần như song song:

| Bảng | Ý nghĩa |
|---|---|
| `metrics` | Lưu metric theo `sensor_id`, `metric_type`, `metric_value`, `unit`, `event_ts` |
| `alerts` | Cảnh báo warning/critical, source, threshold, resolve |
| `users` | Tài khoản, role admin/user, trạng thái duyệt |
| `user_notification_targets` | Nhiều target Telegram/email |
| `devices` | Device do admin quản lý, dùng phân quyền metric |
| `user_device_permissions` | Quyền user xem device |
| `iot_devices` | Device IoT do user tạo, có source, location, alert threshold, AI context |
| `available_servers` | Server store kiểu cũ/local |
| `server_subscriptions` | Subscription server |
| `server_subscription_requests` | Request subscribe server |
| `chat_conversations` | Conversation hỗ trợ |
| `chat_messages` | Message chat |
| `chat_issue_templates` | Mẫu vấn đề chat |

Các bảng của `server_backend`:

| Bảng | Ý nghĩa |
|---|---|
| `servers` | Server/VPS agent đăng ký |
| `server_metadata` | Tên hiển thị, giá, mô tả, availability |
| `rentals` | Rental VPS |
| `tasks` | Task agent cần thực thi |

Các bảng của `model_backend`:

| Bảng | Ý nghĩa |
|---|---|
| `metrics` | Dữ liệu metric dùng train/predict |
| `iot_devices` | Metadata device để dự báo |
| `weather_historical` | Dữ liệu thời tiết lịch sử |

## 9. Scripts ở root

| File | Chức năng |
|---|---|
| `generate_iot_data.py` | Sinh dữ liệu IoT mẫu qua API/local |
| `generate_iot_postgres_data.py` | Sinh dữ liệu IoT trực tiếp PostgreSQL |
| `stream_iot_data_live.py` | Stream dữ liệu IoT live |
| `populate_metrics.py` | Seed metric |
| `collect_system_metrics.py` | Collector system metric cũ, gọi `/api/system/collect` nhưng endpoint hiện trả `410` |
| `Agent.py` | Agent/script cũ ở root |

Lưu ý: một số script cũ có text bị lỗi encoding và có endpoint đã bị deprecated, nên nên ưu tiên code service hiện tại khi vận hành.

## 10. Biến môi trường quan trọng

Root/app:

```env
DATABASE_URL=...
SECRET_KEY=...
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
IOT_BACKEND_URL=http://<vps_ip>:8100
MODEL_BACKEND_URL=http://127.0.0.1:8200
MODEL_BACKEND_TOKEN=...
METRICS_CENTRAL_BASE_URL=http://<metrics-central>:9000
METRICS_CENTRAL_TOKEN=...
METRICS_CENTRAL_ADMIN_TOKEN=...
GEMINI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
GMAIL_ADDRESS=...
GMAIL_APP_PASSWORD=...
```

IoT backend:

```env
DATABASE_URL=...
SECRET_KEY=...
MQTT_HOST=...
MQTT_PORT=1883
MQTT_USERNAME=sensor_user
MQTT_PASSWORD=...
MQTT_CLIENT_ID=iot-backend
MQTT_SENSOR_TOPIC=sensors/+/data
MQTT_COMMAND_TOPIC_PREFIX=ptdl/devices
MQTT_WIFI_LIST_TOPIC=ptdl/devices/+/wifi-list
```

Model backend:

```env
DATABASE_URL=...
MODEL_BACKEND_TOKEN=...
CORS_ORIGINS=...
XGBOOST_MODEL_DIR=...
TFT_MODEL_DIR=...
```

Server backend:

```env
DATABASE_URL=...
METRICS_TOKEN=...
ADMIN_TOKEN=...
```

Frontend:

```env
VITE_CORE_SERVER_IP=localhost
VITE_CORE_SERVER_PORT=8000
VITE_IOT_SERVER_IP=<vps_ip_or_localhost>
VITE_IOT_SERVER_PORT=8100
VITE_USE_SAME_ORIGIN_API=false
```

## 11. Các luồng nghiệp vụ chính

### User tạo IoT device

```text
Frontend IoTDeviceManager
  -> POST /api/iot-devices
  -> iot_backend tạo iot_devices
  -> tạo/enable devices tương ứng
  -> cấp permission cho user
```

Trường `source` là khóa quan trọng để map metric. Nó phải trùng `sensor_id` trong payload ESP32.

### ESP32 gửi dữ liệu

```text
ESP32 DHT11
  -> MQTT sensors/<sensor_id>/data
  -> iot_backend MQTT callback
  -> save metric vào PostgreSQL
  -> check alert threshold
  -> broadcast WebSocket
  -> frontend cập nhật realtime
```

### User đổi WiFi ESP32

```text
Frontend WiFi modal
  -> app /api/iot-control/wifi-config
  -> iot_backend /api/devices/wifi-config
  -> MQTT command {"wifi": {...}}
  -> ESP32 lưu Preferences
  -> ESP32 reconnect/restart tùy firmware
```

### Forecast AI

```text
Frontend UserDashboard / IoTDeviceManager
  -> app /api/model/...
  -> app kiểm tra user có quyền với source/device
  -> model_backend predict/train/sync
  -> trả predictions về frontend
```

### Thuê server

```text
Frontend ServerStore
  -> app /api/servers/rent/request
  -> user nhập mã confirm
  -> app gọi server_backend /api/rentals/create
  -> server_backend tạo rental + task
  -> agent VPS poll task và tạo SSH user
  -> agent báo result
  -> rental active
```

## 12. Ghi chú hiện trạng cần nhớ

| Vấn đề | Ghi chú |
|---|---|
| `sensor_id` vs `source` | Trong DB/frontend dùng `source`; trong metric payload dùng `sensor_id`. Hai giá trị cần trùng nhau để dữ liệu hiện đúng |
| WiFi scan | Backend/frontend đã có, nhưng firmware trong repo cần cập nhật nếu muốn publish `wifi-list` |
| API `/api/system/collect` | Hiện trả `410`, script `collect_system_metrics.py` là flow cũ |
| `app` và `iot_backend` có schema giống nhau | Có thể gây nhầm DB nếu chạy tách service; cần kiểm tra đúng `DATABASE_URL` |
| Frontend route `/api/metrics` | Đang được route sang `iot_backend` trong `api.js` |
| `IOT_BACKEND_URL` | Bắt buộc đúng trong app backend nếu dùng proxy WiFi |
| Metrics Central rental | Private key hiện là placeholder trong code server backend demo |

## 13. Cách chạy nhanh trong môi trường dev

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

App backend:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

IoT backend:

```powershell
python -m uvicorn iot_backend.main:app --host 0.0.0.0 --port 8100 --reload
```

Model backend:

```powershell
cd model_backend
python -m uvicorn main:app --host 0.0.0.0 --port 8200 --reload
```

Server backend:

```powershell
cd server_backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
```

## 14. Kiểm tra nhanh các service

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:8000/"
Invoke-RestMethod -Method GET -Uri "http://localhost:8100/"
Invoke-RestMethod -Method GET -Uri "http://localhost:8200/"
Invoke-RestMethod -Method GET -Uri "http://localhost:9000/"
```

Kiểm tra MQTT trong IoT backend:

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:8100/api/devices/mqtt-status" -Headers @{ Authorization = "Bearer <token>" }
```

Kiểm tra WiFi scan qua app:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:8000/api/iot-control/wifi-scan" -Headers @{ Authorization = "Bearer <token>" } -ContentType "application/json" -Body '{"sensor_id":"esp32_devkit_v1"}'
Invoke-RestMethod -Method GET -Uri "http://localhost:8000/api/iot-control/wifi-scan?sensor_id=esp32_devkit_v1" -Headers @{ Authorization = "Bearer <token>" }
```
