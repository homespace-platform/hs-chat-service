# Chat Service: Dokploy Compose riêng

Luồng: push `master` → GitHub Actions lint/test/build → Docker Hub → Docker Hub webhook → Dokploy cập nhật riêng Chat Service.

## 1. File đã chuẩn bị

- `Dockerfile`: Node 24, NestJS build, production dependencies, user `node`, port `8082`, healthcheck `/ping`.
- `.dockerignore`: chỉ đưa build inputs vào image, loại env/key/credential files.
- `.github/workflows/publish-image.yml`: lint, unit tests, Docker build; push tag Git SHA và `latest` trên `master`, không publish từ pull request.
- `.env.prod`: file riêng tư, Git ignore. Giữ Agora/S3 credentials từ `.env` hiện tại, chuyển địa chỉ hạ tầng sang production. `.env` local được giữ nguyên.
- `compose.production.yml`: service `hs-chat-service`, image từ `${CHAT_IMAGE:?}`, memory limit 512 MiB, tự tham gia external `hs-network`. Không có host port hoặc volume; healthcheck kế thừa từ image. Không cần alias hoặc Advanced → Networks.

## 2. Hạ tầng và env production

MongoDB, Kafka, Discovery, Gateway phải chạy trước. Notification Service cần chạy để xử lý push chat; gửi/lưu tin nhắn thuộc Chat Service.

| Biến | Giá trị / nguồn |
| --- | --- |
| `CHAT_IMAGE` | `nvminh162/hs-chat-service:latest`, đặt ở dòng đầu `.env.prod`; chỉ dùng để chọn image |
| `NODE_ENV` | `production` |
| `PORT` | `8082` |
| `SERVICE_NAME` | `hs-chat-service`, đúng tên Gateway khám phá qua Eureka |
| `MONGODB_URI` | Host `mongodb:27017`, database riêng `homespace_chat`, authSource `admin`; dùng credential infra production |
| `EUREKA_CLIENT_SERVICE_URL` | `http://hs-discovery-server:8761/eureka/` |
| `EUREKA_INSTANCE_HOSTNAME` | `hs-chat-service`: DNS từ tên service Compose trên mạng chung |
| `KAFKA_BROKERS` | `kafka:19092`, listener nội bộ |
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Giữ giá trị cũ cho voice/video calls |
| `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Giữ cấu hình S3 riêng của Chat hiện có |

File env dùng single quote hợp lệ với dotenv; dán nguyên vào Dokploy Environment. Không dùng nguyên file này với `docker run --env-file` vì Docker CLI xử lý dấu quote khác dotenv.

Compose yêu cầu biến image và đủ 13 biến runtime trong `.env.prod` bằng `${VARIABLE:?}`: thiếu hoặc rỗng sẽ báo lỗi, không có fallback. Giữ nguyên `.env` và `.env.example` của dev; không thêm biến image vào hai file đó.

Chat publisher đang dùng topic `homespace.notification.events.v1` trong code; không thêm biến topic không được sử dụng. Topic này phải đã được infra tạo và Notification Service tiêu thụ. Notification không đưa CHAT vào chuông/số chưa đọc của chuông; unread hội thoại do Chat Service quản lý.

Kiểm tra MongoDB có DNS `mongodb`, Kafka có DNS `kafka`, Discovery Compose có service name `hs-discovery-server` trên `hs-network`. Env dùng `http://hs-discovery-server:8761/eureka/`; DNS lấy từ tên service trong YAML, không phụ thuộc tên container sinh ngẫu nhiên. Tên hiển thị trên Dokploy không thay thế tên service trong YAML. Giữ infra, network và volumes hiện có.

## 3. Docker Hub và GitHub Actions

Kiểm tra local: 60 unit tests pass, Docker build và validation env production trong image pass. Lint có một warning cũ. `npm audit --omit=dev` hiện báo 6 cảnh báo runtime (1 critical, 4 high, 1 moderate), liên quan `proxy-addr`, `@nestjs/platform-express`, `body-parser`, `multer`, `mongoose`, `qs`; dependencies chưa được nâng trong thay đổi deploy này. Cần review/nâng bản vá và chạy lại kiểm tra trước khi đưa lên production.

1. Docker Hub → Create repository → namespace **`nvminh162`**, name **`hs-chat-service`**.
2. GitHub → `homespace-platform/hs-chat-service` → Settings → Secrets and variables → Actions.
3. Thêm hoặc cấp quyền dùng org secrets:
   - `DOCKERHUB_USERNAME`: tài khoản có quyền push vào namespace `nvminh162`.
   - `DOCKERHUB_TOKEN`: Docker Hub access token Read & Write.
4. Review rồi commit/push file deploy lên `master`; `.env.prod` không thuộc commit.
5. Actions → **Build and publish Chat Service** → chờ thành công. Có thể dùng Run workflow trên `master` sau khi workflow đã lên GitHub.

Image: **`nvminh162/hs-chat-service:latest`** và tag Git SHA. Không cần Agora/AWS/MongoDB secret trong GitHub Actions, không cần `DOKPLOY_DEPLOY_WEBHOOK` ở GitHub.

## 4. Setup trên Dokploy

1. Nếu đang có Application Chat cũ, lưu lại cấu hình/webhook rồi Stop trước khi chạy Compose mới; không chạy hai bản song song. Không xóa infra hoặc dữ liệu.
2. Projects → **homespace → production → Create Service → Docker Compose**, tên `hs-chat-service`, cùng server với infra.
3. General → Provider **Raw**, dán toàn bộ [compose.production.yml](../compose.production.yml), chọn Compose Type **Docker Compose**, không chọn Stack → **Save**. Dokploy pull image đã build, không dùng Nixpacks.
4. **Environment**: dán đầy đủ `.env.prod`, có `CHAT_IMAGE` ở dòng đầu → **Save**. File local không tự cập nhật Dokploy.
5. **Preview Compose** phải có service `hs-chat-service`, đúng image và default network external `hs-network`. Giữ tắt Isolated Deployment và xác nhận Preview vẫn giữ mạng chung; không cần Advanced → Networks.
6. Chỉ chạy **một instance**. Chat presence, rooms và call signaling dùng trạng thái trong bộ nhớ; cần shared adapter trước khi scale nhiều replica. Memory limit khởi đầu 512 MiB nằm trong YAML.
7. **Không thêm domain**, không publish port `8082` ra host. Service tin identity headers đã xác thực từ Gateway, nên mọi truy cập public phải đi qua Gateway.
8. General → **Deploy**. Chờ healthy; Logs có `Registered ... with Eureka`, không có lỗi MongoDB/DNS. Healthcheck `/ping` không chứng minh S3/Agora/Kafka hoạt động đầy đủ.

## 5. Docker Hub webhook để CD

1. Dokploy Compose Chat → bật **Autodeploy** sau khi deploy thủ công thành công.
2. Deployments → copy **Webhook URL của chính Compose Chat**, dạng `/api/deploy/compose/TOKEN`.
3. Docker Hub → `nvminh162/hs-chat-service` → Webhooks → New webhook.
4. Name: **`dokploy-chat`**, URL: dán webhook vừa copy → Save.
5. Chạy lại workflow trên `master` để thử chuỗi tự động. Docker Hub gọi Dokploy; Compose có `pull_policy: always` để pull image trước khi chạy.

Raw Compose trên Dokploy v0.31.4 không lọc tag như Application Docker; push cả SHA và `latest` có thể gây hai delivery/deploy. Kiểm tra lịch sử delivery Docker Hub và Deployments trên Dokploy. Dùng webhook riêng của Chat, không dùng webhook Notification/infra/Core hoặc URL Application cũ. Raw không tự lấy YAML từ Git: khi sửa Compose phải dán lại YAML rồi Save. Giữ kín webhook token. Xem [Dokploy Auto Deploy](https://docs.dokploy.com/docs/core/auto-deploy).

## 6. Kiểm tra REST, realtime, media và calls

Trên EC2:

```bash
sudo docker ps --filter label=com.docker.compose.service=hs-chat-service --format '{{.Names}} {{.Status}}'
curl --fail --silent --show-error --max-time 10 https://api.homespace.id.vn/api/v1/chat/ping
```

Kết quả `pong`; Eureka có **HS-CHAT-SERVICE — UP**. Gateway có thể cần 30–60 giây để cập nhật registry.

```bash
curl --silent --output /dev/null --write-out 'HTTP %{http_code}\n' --max-time 10 https://api.homespace.id.vn/api/v1/chat/conversations
```

Chưa đăng nhập phải trả `401`. Đăng nhập frontend bằng hai tài khoản có cùng cuộc trò chuyện:

1. Gửi/nhận tin nhắn, reload để kiểm tra lưu MongoDB; unread chỉ thuộc hội thoại đó.
2. DevTools → Network: WebSocket `/api/v1/chat/socket.io/` upgrade `101`; kiểm tra presence online/offline và read state. Gateway xác thực kết nối và chuyển identity vào Chat Service.
3. Upload ảnh/file, gửi và mở từ tài khoản thành viên; người ngoài hội thoại không được truy cập media API.
4. Thử voice/video call với Agora, cấp quyền micro/camera; kiểm tra hai phía có âm thanh/hình ảnh.
5. Khi Notification Service đang chạy, kiểm tra push chat từ Kafka; không kỳ vọng tin chat xuất hiện trong chuông notification.

S3 dùng prefix `private/chat/*`. Giữ bucket private; IAM Chat cần quyền upload/read đúng prefix. Bucket CORS phải cho origin frontend production thực tế (web/admin), methods `PUT`, `GET`, `HEAD`, headers cần cho presigned upload. Không đổi bucket thành public để sửa lỗi CORS; đối chiếu policy thực tế trên AWS trước khi thử media.

## 7. Lỗi thường gặp và rollback

- **Image not found**: chờ workflow publish xong, kiểm tra image/tag hoặc credential pull.
- **MongoDB UnknownHost/authentication failed**: kiểm tra network, alias, password và `authSource=admin`; không reset volume.
- **Eureka không có Chat**: kiểm tra URL Discovery và DNS `hs-chat-service` mà Gateway truy cập được trên `hs-network`.
- **WebSocket lỗi/không có presence**: kiểm tra Gateway đã có route Chat websocket, request đi qua `/api/v1/chat/socket.io/`, JWT còn hạn; không truy cập port Chat trực tiếp từ browser.
- **Upload lỗi**: kiểm tra S3 IAM prefix, bucket region và CORS; Agora secret không liên quan upload.
- **Agora is not configured/call thất bại**: kiểm tra app ID/certificate thuộc cùng Agora project và browser permissions.
- **Chat chạy nhưng push lỗi**: kiểm tra `kafka:19092`, topic notification và Notification consumer; không đổi topic hoặc xóa dữ liệu để thử.

Rollback: đổi `CHAT_IMAGE` trong Environment sang `nvminh162/hs-chat-service:<SHA-tốt>`, Save → Deploy; tạm tắt Autodeploy trong lúc pin tag. Không xóa MongoDB hoặc Kafka data để rollback code.
