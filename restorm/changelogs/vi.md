# Changelog

## v1.1.0

**Thiết kế API của bạn, phục vụ nó như một mock, và tạo các client của nó — mà không rời khỏi Restorm.**

- **Trình thiết kế API trực quan.** Mô hình hóa API của bạn bằng tay — model, enum, route, ví dụ có tên, ràng buộc — mà không viết một dòng đặc tả nào.
- **Phục vụ nó như một mock, chỉ với một cú nhấp, trên 5 giao thức cùng lúc.** Thiết kế trở thành một máy chủ trả lời đồng thời bằng HTTP, GraphQL, SOAP, OData và gRPC. Các phản hồi đến từ những ví dụ có tên của bạn (hoặc dữ liệu thực tế được tạo từ các model của bạn), kèm xác thực ràng buộc, độ trễ mô phỏng và chế độ có trạng thái.
- **Các client sẵn sàng chạy, được tạo tự động.** Trong khi mock đang chạy, mục Clients tạo ra những request thật, chạy được cho từng giao thức đã bật, trỏ đến các endpoint của mock. Một cú nhấp mở một request và gọi thẳng máy chủ — không còn phải nhập lại API của bạn ở nơi khác để kiểm thử.
- **Xuất bộ mô tả** (OpenAPI và các loại khác) và **tạo mã** từ thiết kế của bạn, được kết xuất trong một sandbox và chỉ ghi ra đĩa sau khi bạn xác nhận.
- **Khi nhập, phần thân request được điền sẵn**: GraphQL chọn các trường vô hướng của kiểu trả về, gRPC bung các thông điệp lồng nhau — request chạy được ngay.

## v1.0.6

Sửa lỗi:

- **Một dự án rất lớn giờ đây không lưu được kèm thông báo rõ ràng thay vì bị treo.** Nếu một dự án trở nên quá lớn để ghi vào đĩa trong một lần — điều có thể xảy ra sau khi nhập một lược đồ API lớn bất thường — Restorm sẽ báo rõ rằng nó quá lớn để lưu, thay vì bị sập hoặc thất bại âm thầm.
- **Báo lỗi rõ ràng hơn ở hậu trường.** Việc hủy hộp thoại "Lưu thành" không còn bị ghi nhận là lỗi, và một lần nhập thất bại giờ đây báo đúng nguyên nhân thực sự — nhờ vậy các vấn đề thật sự dễ phát hiện và khắc phục hơn.

## v1.0.5

**Cookie jar — mỗi môi trường một hũ cookie riêng.**

- **Mỗi môi trường giữ cookie riêng của mình.** Đăng nhập vào API dev và API prod từ hai môi trường khác nhau, phiên của chúng không bao giờ lẫn lộn — một cookie thu được ở môi trường này chỉ được gửi lại trong chính môi trường đó. Thời hạn, `Path`, `Domain` cùng các tên miền phụ, `Secure`, `HttpOnly` và `SameSite` giờ đây được tôn trọng chứ không bị bỏ qua.
- **Làm quen với Cookie jar.** Một tab không gian làm việc mới — **Xem ▸ Cookie jar** — liệt kê cookie của từng môi trường được nhóm theo tên miền trong các ngăn có thể thu gọn: chỉnh một giá trị, xóa một cookie, dọn sạch một tên miền hoặc cả hũ, hoặc thêm cookie thủ công. Nó làm mới trực tiếp mỗi khi các yêu cầu của bạn thiết lập cookie.
- **Xem mỗi yêu cầu đã gửi và nhận những gì.** Giờ đây mỗi yêu cầu đều có một tab **Cookies** bên cạnh Response và Info, hiển thị các cookie được gửi kèm lời gọi và các cookie nhận về — kể cả cookie được thiết lập trong một lần chuyển hướng, vốn không bao giờ đến được phản hồi cuối cùng. Nó cũng có mặt trên các phản hồi trong quá khứ ở lịch sử của bạn.
- **Đăng nhập bằng cookie hoạt động ngon lành.** Một yêu cầu trả về `Set-Cookie` sẽ được thu lại và tự động phát lại ở các lệnh gọi được bảo vệ tiếp theo — kể cả trong suốt một lần chạy kịch bản, nơi mỗi bước dùng chung hũ cookie của môi trường.
- **Cookie được lưu giữ như trong trình duyệt.** Cookie có thời hạn được lưu theo từng dự án và được tải lại khi bạn mở lại dự án; cookie phiên bị loại bỏ khi bạn khởi động lại — đúng như một trình duyệt sẽ làm.
- **Vượt ra ngoài REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC và SSE giờ đều gửi và lưu cookie, còn WebSocket mang chúng theo trong quá trình bắt tay kết nối.
- **Cookie có thể dùng biến của bạn.** Gõ `{{token}}` vào một cookie bạn thêm thủ công và nó sẽ được phân giải theo môi trường đang hoạt động khi yêu cầu được gửi đi.

Sửa lỗi:

- **Tự động lưu giờ bao gồm cả các môi trường bên trong thư mục.** Ở chế độ tự động lưu, việc thêm hoặc đổi tên một môi trường con được lưu ngay lập tức — không còn lời nhắc «lưu trước khi đóng?» cho một thay đổi vốn đã phải được ghi xuống đĩa.

## v1.0.4

**Đăng nhập một lần — mọi cửa sổ đều theo.**

- **Tài khoản của bạn giờ đây theo bạn qua các cửa sổ.** Đăng nhập, đăng xuất hoặc đổi gói ở một cửa sổ Restorm và mọi cửa sổ đang mở khác sẽ áp dụng ngay lập tức — không cần khởi động lại, không cần đăng nhập lần hai. Và khi bạn hoàn tất đăng nhập trên trình duyệt, xác nhận giờ đây sẽ đến đúng cửa sổ đã yêu cầu, ngay cả khi nhiều cửa sổ đang mở.

Sửa lỗi:

- **Nút mã chạy lại trên máy Mac dùng Intel** — bản dựng macOS Intel chứa tệp esbuild được biên dịch cho Apple Silicon.
- **Hành động "Cửa sổ mới" của trình khởi chạy AppImage mở lại cửa sổ**, và lệnh `restorm` do các gói .deb/.rpm cài đặt hoạt động trở lại.
- **Khởi động trên Windows sạch hơn** — cửa sổ giờ được tải qua giao thức ứng dụng, không còn phương án dự phòng âm thầm sau lỗi nội bộ ở mỗi lần khởi chạy.

## v1.0.3

**Restorm chạy trong CI, không cần FUSE.**

- **`restorm-cli` giờ chạy được trên runner CI và trong container.** Bản dựng Linux được giải nén thay vì gắn kết: không còn cần FUSE, thứ mà Ubuntu đã ngừng cung cấp.

## v1.0.2

**Token CLI/CI của bạn, không cần rời ứng dụng.**

- **Tạo, xem và thu hồi token ngay trong Restorm** — dành cho người dùng Pro và Enterprise, từ nút tài khoản trên thanh tiêu đề. Không còn phải sang bảng điều khiển để lấy token cho pipeline bạn đang viết.
- **Token có thể hết hạn.** Chọn thời hạn khi tạo: 7 đến 365 ngày, hoặc không hết hạn như trước. Token hết hạn bị từ chối giống như token đã thu hồi.
- **Tổ chức của bạn có thể ủy quyền.** Quản trị viên có thể cho phép một thành viên cụ thể tạo token, và riêng biệt cấp quyền xem nhật ký kiểm toán, mà không cần biến họ thành quản trị viên.
- **Restorm giờ cài đặt được từ npm.** `npm i -g restorm-cli`, rồi `restorm` — ứng dụng khởi động trên Linux, macOS và Windows mà không cần trình cài đặt. Bản dựng chỉ tải một lần, được kiểm tra bằng checksum đã công bố và lưu vào bộ nhớ đệm, nên quy trình không tải lại ở mỗi công việc.

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
