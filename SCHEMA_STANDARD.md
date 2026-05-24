# Tieu chuan Schema CSDL

Tai lieu nay dinh nghia nghia chuan cua cac bang va cot quan trong duoc dung chung giua `app`, `iot_backend`, `model_backend` va `server_backend`.

## Nguyen tac chung

- Moi bang dung chung chi duoc co mot schema chuan.
- Cot tuong thich nguoc co the tam thoi ton tai trong PostgreSQL, nhung code moi chi duoc ghi vao cot chuan.
- Khong tron lan nhan vi tri de quan ly voi dia danh dung cho geocoding/weather.
- Neu co du lieu cu, uu tien backfill sang cot chuan truoc khi xoa cot legacy.

## `metrics`

### Cot chuan

- `id`
- `event_ts`
- `sensor_id`
- `location`
- `metric_type`
- `metric_value`
- `unit`

### Y nghia chuan

- `sensor_id`: ma nguon du lieu cua sensor/device trong bang metric.
- `location`: nhan vi tri do nguoi dung dat de de quan ly va hien thi.
  Vi du: `Living Room`, `Goc duoi vuon`, `Balcony`.
- `location` khong duoc luu dia danh weather/geocoding nhu `Ho Chi Minh City, Vietnam`.

### Quy tac ghi du lieu

Khi ghi `metrics.location`, uu tien theo thu tu:

1. `iot_devices.location`
2. `devices.location`
3. `location` tu payload neu va chi neu khong tim thay vi tri chuan trong DB

Can bo qua cac gia tri gia/placeholder nhu:

- `Unknown`
- `N/A`
- `null`
- `none`

## `iot_devices`

### Cot chuan

- `id`
- `user_id`
- `name`
- `device_type`
- `source`
- `location`
- `is_active`
- `alert_enabled`
- `environment_type`
- `location_query`
- `latitude`
- `longitude`
- `timezone_name`
- `task_description`
- `priority_level`
- `action_hint`
- `unit`
- `min_threshold`
- `max_threshold`
- `created_at`

### Cot legacy can bo dan

- `lower_threshold`
- `upper_threshold`
- `created_by`

### Y nghia chuan

- `location`: nhan vi tri de quan ly do nguoi dung dat.
  Vi du: `Phong khach`, `Goc duoi vuon`, `Ban cong tang 2`.
- `location_query`: chuoi dia danh dung cho geocoding/weather, dac biet voi sensor `outdoor`.
  Vi du: `Ho Chi Minh City, Vietnam`.
- `environment_type`: `indoor` hoac `outdoor`.
- `min_threshold` va `max_threshold`: nguong canh bao chuan cua sensor.

### Rang buoc

- Khoa unique chuan phai la `(source, device_type)`.

## `alerts`

### Cot chuan

- `id`
- `metric_type`
- `status`
- `current_value`
- `threshold`
- `message`
- `source`
- `device_id`
- `device_name`
- `unit`
- `min_threshold`
- `max_threshold`
- `created_at`
- `resolved_at`

### Y nghia chuan

- Alert phai luu du metadata de debug va hien thi lai nguong da vi pham.
- `device_name`, `unit`, `min_threshold`, `max_threshold` khong phai cot phu, ma la mot phan cua schema chuan.

## `users`

### Cot tai khoan chuan

- `id`
- `username`
- `email`
- `hashed_password`
- `role`
- `is_active`
- `is_approved`
- `approved_by`
- `approved_at`
- `created_at`

### Cot notification default van con dung

- `notification_email`
- `email_enabled`
- `telegram_chat_id`
- `telegram_enabled`

### Quy tac

- `user_notification_targets` la bang chuan cho multi-target.
- Cac cot notification trong `users` duoc xem la target mac dinh/fallback.

## `user_notification_targets`

### Cot chuan

- `id`
- `user_id`
- `target_type`
- `target_value`
- `is_enabled`
- `created_at`

## `chat_conversations`

### Cot chuan

- `id`
- `user_id`
- `assigned_admin_id`
- `status`
- `subject`
- `created_at`
- `updated_at`
- `last_read_by_user_at`
- `last_read_by_admin_at`

## `weather_historical`

### Cot chuan

- `id`
- `device_id`
- `source`
- `provider`
- `station_id`
- `event_ts`
- `latitude`
- `longitude`
- `timezone_name`
- `temperature_c`
- `dew_point_c`
- `relative_humidity`
- `precipitation_mm`
- `snow_mm`
- `wind_direction_deg`
- `wind_speed_kmh`
- `wind_peak_kmh`
- `pressure_hpa`
- `sunshine_minutes`
- `condition_code`
- `created_at`
- `updated_at`

### Rang buoc

- Khoa unique chuan phai la `(device_id, provider, event_ts)` voi ten `uq_weather_device_provider_ts`.

## `model_predictions`

### Cot chuan

- `id`
- `prediction_kind`
- `source`
- `device_id`
- `metric_type`
- `method`
- `model_status`
- `generated_at`
- `horizon_minutes`
- `horizon_days`
- `step_minutes`
- `target_ts`
- `predicted_value`
- `confidence_score`
- `quality_label`
- `metadata`
- `created_at`

### Quy tac

- `metadata` la payload metadata tuy chon cua model, duoc luu dang text hoac JSON serialize.

## `servers`

### Y nghia chuan

- Bang luu trang thai runtime/technical do agent server day len.

## `server_metadata`

### Y nghia chuan

- Bang luu metadata hien thi/business do admin quan ly.

## `rentals`

### Y nghia chuan

- Bang theo doi vong doi thue server.
- `server_name` va `server_ip` duoc chap nhan la gia tri snapshot tai thoi diem tao rental.

## `tasks`

### Y nghia chuan

- Hang doi task cho agent va lich su thuc thi task.
