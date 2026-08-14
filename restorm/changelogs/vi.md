# Changelog

## v1.0.2

**Token CLI/CI của bạn, không cần rời ứng dụng.**

- **Tạo, xem và thu hồi token ngay trong Restorm** — dành cho người dùng Pro và Enterprise, từ nút tài khoản trên thanh tiêu đề. Không còn phải sang bảng điều khiển để lấy token cho pipeline bạn đang viết.
- **Token có thể hết hạn.** Chọn thời hạn khi tạo: 7 đến 365 ngày, hoặc không hết hạn như trước. Token hết hạn bị từ chối giống như token đã thu hồi.
- **Tổ chức của bạn có thể ủy quyền.** Quản trị viên có thể cho phép một thành viên cụ thể tạo token, và riêng biệt cấp quyền xem nhật ký kiểm toán, mà không cần biến họ thành quản trị viên.

## v1.0.1

**Bản vá đầu tiên: di chuyển trong thanh bên, tên thẻ và báo cáo sự cố.**

- **Di chuyển một mục trong thanh bên không còn làm hỏng ứng dụng.** Khi mở trình duyệt mini, Cài đặt hoặc nhật ký MCP, mọi thao tác kéo trong thanh bên đều phá vỡ giao diện và chỉ khởi động lại mới khôi phục được.
- **Đổi tên một mục giờ cập nhật mọi thẻ đang mở** — kể cả thẻ trong khung chia đôi và thẻ của mọi loại yêu cầu (gRPC, GraphQL, Redis…), vốn giữ tên cũ cho đến khi mở lại.
- **Báo cáo sự cố lại đến được với chúng tôi.** Dù bật gửi báo cáo, 1.0.0 vẫn âm thầm không gửi gì: sự cố bạn gặp phải không cho chúng tôi biết điều gì.
- **Hình minh họa “ngôn ngữ lập trình” hiển thị lại các logo.**

## v1.0.0

**Restorm 1.0 — ứng dụng khách API ưu tiên cục bộ đã ra mắt.**

Restorm là một ứng dụng khách trên máy tính, nhanh và ưu tiên hoạt động ngoại tuyến, để kiểm thử và điều khiển API trên mọi giao thức chính.

- **Giao thức**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Kịch bản**: liên kết các yêu cầu một cách trực quan, rẽ nhánh/lặp, trích xuất và tái sử dụng giá trị, chạy không giao diện trong CI.
- **Môi trường & biến**: `{{handlebars}}` ở mọi nơi, secret có kiểu, môi trường theo từng thư mục.
- **Nhập/Xuất**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, xuất mã nguồn.
- **Dự án thuần Git**: dự án `.restorm` của bạn là một tệp thông thường — quản lý phiên bản, so sánh và giải quyết xung đột ngay trong ứng dụng.
- **Ưu tiên cục bộ & riêng tư**: mọi thứ chạy trên máy của bạn; tường lửa đầu ra kiểm soát mọi lệnh gọi bên ngoài.
- **Đa nền tảng**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Bản Community miễn phí, cùng Pro & Enterprise cho nhóm.
