# HomeSpace Chat Service

NestJS service dành cho miền chat của HomeSpace. Service nhận identity đã được xác thực từ API Gateway và đăng ký vào Eureka.

## Chạy local

```bash
copy .env.example .env.dev
npm install
npm run start:dev
```

Yêu cầu MongoDB tại `localhost:27017` và Eureka tại `localhost:8761`.

## Endpoint kiểm tra

- Trực tiếp: `GET http://localhost:8082/ping`
- Qua Gateway: `GET http://localhost:8080/api/v1/chat/ping`
- Có xác thực qua Gateway: `GET http://localhost:8080/api/v1/chat/auth/me`

Endpoint `auth/me` không tự verify JWT. Gateway verify JWT và chuyển identity qua `X-User-Id`, `X-User-Email`, `X-User-Role`, `X-User-Authorities`, giống contract của các Java service.

`EUREKA_INSTANCE_HOSTNAME=localhost` bật chế độ tự tìm IPv4 physical để đăng ký Eureka, tương đương `eureka.instance.prefer-ip-address=true` của các Java service. Có thể đặt IP/hostname cụ thể để override khi chạy trong Docker hoặc VM.
