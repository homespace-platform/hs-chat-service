# HomeSpace Chat Service

NestJS service dành cho miền chat của HomeSpace. Service nhận identity đã được xác thực từ API Gateway và đăng ký vào Eureka.

## Chạy local

```bash
copy .env.example .env.dev
npm install
npm run start:dev
```

Để bật gọi thoại/video, tạo project Agora rồi đặt `AGORA_APP_ID` và
`AGORA_APP_CERTIFICATE` trong `.env.dev`.

Yêu cầu MongoDB tại `localhost:27017` và Eureka tại `localhost:8761`. Chat
service dùng database riêng `homespace_chat`; có thể drop database này khi
reset dữ liệu local:

```bash
mongosh "mongodb://homespace:homespace123@localhost:27017/?authSource=admin" --eval "db.getSiblingDB('homespace_chat').dropDatabase()"
```

## Endpoint kiểm tra

- Trực tiếp: `GET http://localhost:8082/ping`
- Qua Gateway: `GET http://localhost:8080/api/v1/chat/ping`
- Có xác thực qua Gateway: `GET http://localhost:8080/api/v1/chat/auth/me`

## REST chat API

Controller local dùng prefix `/`; qua Gateway dùng prefix
`/api/v1/chat`. Các endpoint chat đều yêu cầu JWT hợp lệ qua Gateway.

| Method | Local path | Mục đích |
| --- | --- | --- |
| `GET` | `/conversations?limit=30` | Danh sách cuộc trò chuyện |
| `POST` | `/conversations` | Tạo hoặc lấy lại cuộc trò chuyện |
| `GET` | `/conversations/:id/messages?limit=50&before=<ISO timestamp>` | Lấy lịch sử tin nhắn |
| `POST` | `/conversations/:id/messages` | Gửi tin nhắn |
| `PATCH` | `/conversations/:id/read` | Đánh dấu đã đọc |
| `POST` | `/conversations/:id/call-token` | Tạo Agora token cho thành viên cuộc trò chuyện |

Tạo conversation:

```json
{
  "participantId": "user-owner-123",
  "listing": {
    "id": "listing-123",
    "title": "Căn hộ 2PN",
    "price": "16.500.000 đ/tháng",
    "location": "Bình Thạnh",
    "image": "https://example.com/image.jpg",
    "bedrooms": 2,
    "area": 75,
    "verified": true
  }
}
```

Gửi tin nhắn:

```json
{
  "content": "Chào anh, căn này còn trống không ạ?",
  "listing": {
    "id": "listing-123",
    "title": "Căn hộ 2PN",
    "price": "16.500.000 đ/tháng",
    "location": "Bình Thạnh",
    "image": "https://example.com/image.jpg"
  }
}
```

Response thành công giữ format chung `{ "code": 1000, "result": ... }`.
Gateway chuyển identity qua các header `X-User-Id`, `X-User-Email`,
`X-User-Role`, `X-User-Authorities`; sender luôn lấy từ `X-User-Id`.

Endpoint `auth/me` không tự verify JWT. Gateway verify JWT và chuyển identity qua `X-User-Id`, `X-User-Email`, `X-User-Role`, `X-User-Authorities`, giống contract của các Java service.

`EUREKA_INSTANCE_HOSTNAME=localhost` bật chế độ tự tìm IPv4 physical để đăng ký Eureka, tương đương `eureka.instance.prefer-ip-address=true` của các Java service. Có thể đặt IP/hostname cụ thể để override khi chạy trong Docker hoặc VM.
