# Changelog

## v1.1.2

**Hỗ trợ OpenAPI 3.2.**

- **Nhập đặc tả OpenAPI 3.2.** Phương thức `QUERY`, các động từ tùy chỉnh (`additionalOperations`), tham số query string và các loại phương tiện truyền phát đều được nhập thành yêu cầu sẵn sàng chạy.
- **Duyệt tệp để nhập.** Nút Duyệt trong hộp thoại nhập mở trình chọn tệp gốc — không còn phải gõ hay kéo đường dẫn.
- **Chế độ xem chia đôi cho các lần dán lớn.** Dán một đặc tả nhiều dòng sẽ mở trình soạn mã ở bên trái và bản xem trước ở bên phải, với thanh phân chia có thể kéo.
- **Nhập khoan dung.** Một đặc tả có vài `$ref` hỏng vẫn nhập mọi tuyến có thể và hiển thị cảnh báo liệt kê những gì phải bỏ qua.

Sửa lỗi:

- Nhập một đặc tả không hợp lệ hoặc không truy cập được sẽ hiển thị thông báo rõ ràng thay vì mở hộp thoại báo cáo sự cố.
- Chế độ xem chi tiết của báo cáo sự cố cuộn lại được.
- Nền của các hộp thoại không còn bị làm mờ.

## v1.1.1

**Trình thiết kế API giờ được điều khiển từ thanh bên.**

- **Model, enum và route của bạn nằm trong thanh bên.** Ba danh sách trong các tab biến mất — model (với lồng ghép kế thừa của chúng), enum và route (nhóm và các route của chúng) giờ nằm trực tiếp trong cây của thanh bên. Nhấp chuột phải để đổi tên, thêm model con hoặc nhóm con, nhân bản một route, tạo CRUD hoặc xóa; kéo để sắp xếp lại hoặc đổi cha — không bao giờ ra ngoài thiết kế. Mỗi trang giờ chỉ hiển thị chi tiết của mục được chọn.
- **Cái nhìn tổng quan về mô hình, enum và tuyến của bạn.** Nút gốc của mỗi mục giờ liệt kê mọi thứ bên dưới — và Mô hình có thêm tab **Đồ thị**: sơ đồ lớp của các mô hình với kế thừa và tham chiếu. Enum hiển thị giá trị ngay bên cạnh tên.
- **Một nơi duy nhất để đổi tên.** Một mô hình, enum hay tuyến được đổi tên từ tiêu đề lớn (cây bút chì), và tên trống hiển thị **“<chưa đặt tên>”** để cây bút luôn trong tầm với — tên không còn xuất hiện hai lần trên trang.
- **Lỗi kiểm tra chỉ đúng phần tử.** Khi có gì đó sai — một mô hình và một enum trùng tên, một tham chiếu đến thứ không còn tồn tại — một ghi chú ở đầu mô hình, enum hoặc tuyến sẽ giải thích.
- **Đường dẫn điều hướng đầy đủ.** Vệt đường phản chiếu toàn bộ cây thanh bên — thư mục › thiết kế › mục › nhóm › phần tử — và mỗi đoạn đều bấm được.
- **Chọn nhiều, xóa một lần.** Chọn nhiều mô hình, enum hoặc tuyến và xóa tất cả cùng lúc, sau khi xác nhận.
- **Sao chép hoặc mở nguồn của một mẫu mã bằng một cú nhấp.** Trên trang "</> Code", khi di chuột lên một mẫu sẽ hiện một nút để sao chép URL hoặc đường dẫn của nó và một nút để mở nó — kho lưu trữ trong trình duyệt, hoặc thư mục trên đĩa đối với mẫu cục bộ.
- **Route mới bắt đầu với một cái tên.** Một route tạo từ đầu giờ nhận được một tên mặc định, nên bạn có thể đổi tên nó ngay.
- **Tab xem trước, như trong trình soạn thảo của bạn.** Một cú nhấp giờ mở một mục trong tab **xem trước** có thể tái sử dụng (tên hiển thị in nghiêng); nhấp vào mục khác sẽ tái sử dụng cùng tab đó thay vì xếp chồng một tab mới. Nhấp đúp, chỉnh sửa bất cứ điều gì, hoặc chạy một yêu cầu để giữ nó mở vĩnh viễn. Tắt nó trong Cài đặt › Hành vi.
- **Ghim những tab bạn giữ mở.** Nhấp chuột phải vào một tab và ghim nó: các tab được ghim luôn đứng trước, sống sót qua "đóng các tab khác", và được ghi nhớ theo từng dự án.
- **Môi trường có được một khung xem chi tiết đúng nghĩa.** Mở một môi trường để đổi tên nó từ tiêu đề, đặt biểu tượng và màu cho nó, và thêm một môi trường con — và menu chuột phải giờ nhân bản một môi trường cùng toàn bộ biến và môi trường con của nó.

Sửa lỗi:

- **Chọn một mẫu mã sẽ đóng thư viện.** "Dùng" giờ đưa bạn thẳng về trang Code.
- **Việc tạo tài liệu không còn thất bại ở các trường tùy chọn.** Tạo tài liệu từ một thiết kế mà model hoặc tham số để "required" chưa đặt sẽ không còn dừng lại với lỗi mẫu.
- **Xóa một enum sẽ hỏi trước.** Enum giờ nhận cùng xác nhận như mô hình và tuyến.
- **Thanh bên hé lộ mục bạn chọn.** Khi bật «đồng bộ thanh bên với tab đang mở», việc chọn hoặc tạo một mô hình, enum hay tuyến sẽ mở rộng các mục cha để nó luôn hiện trong cây.
- **Nút môi trường vẫn dễ đọc trên mọi màu.** Nhãn của nó giờ chuyển sang chữ tối hoặc sáng để vẫn dễ đọc trên màu của môi trường, giống như nút chạy.
- **Nhấp chuột giữa đóng một tệp đang mở.** Nhấp chuột giữa vào một mục trong danh sách "Đang mở" ở thanh bên sẽ đóng tab của nó — và một tùy chọn Hành vi mới cho phép bạn ẩn hoàn toàn bảng đó.
- **Từ ngữ rõ ràng hơn khi bắt đầu từ tài liệu.** Trong tài liệu của một API đã nhập, nút giờ ghi "Tạo một yêu cầu mới từ tài liệu này."
- **Đăng nhập hoạt động trên bản Microsoft Store.** Lệnh gọi lại theo giao thức tùy chỉnh mà trình duyệt trả về sau khi bạn đăng nhập giờ đã được khai báo trong gói Store, nên việc đăng nhập hoàn tất thay vì hết thời gian chờ.

## v1.1.0

🎉 **Giờ đây Restorm còn là một trình thiết kế API.** Thiết kế API của bạn, phục vụ nó như một mock trực tiếp trên năm giao thức cùng lúc, và tạo các client của nó — mà không rời khỏi ứng dụng, tất cả trên đĩa của riêng bạn.

- **Trình thiết kế API trực quan.** Mô hình hóa API của bạn bằng tay — model, enum (có tên hoặc nội tuyến), route, tham số, ví dụ có tên, ràng buộc, thẻ và trạng thái ngừng dùng — mà không viết một dòng đặc tả nào.
- **Phục vụ nó như một mock, chỉ với một cú nhấp, trên 5 giao thức cùng lúc.** Thiết kế trở thành một máy chủ trả lời đồng thời bằng HTTP, GraphQL, SOAP, OData và gRPC. Các phản hồi đến từ những ví dụ có tên của bạn (hoặc dữ liệu thực tế được tạo từ các model của bạn), kèm xác thực ràng buộc, độ trễ mô phỏng và chế độ có trạng thái.
- **Các client sẵn sàng chạy, được tạo tự động.** Trong khi mock đang chạy, mục Clients tạo ra những request thật, chạy được cho từng giao thức đã bật, trỏ đến các endpoint của mock. Một cú nhấp mở một request và gọi thẳng máy chủ — không còn phải nhập lại API của bạn ở nơi khác để kiểm thử.
- **Tạo mã** từ thiết kế của bạn bằng các mẫu được cung cấp và các mẫu tùy chỉnh của riêng bạn, được kết xuất trong một sandbox và chỉ ghi ra đĩa sau khi bạn xác nhận. **Xuất cả bộ mô tả** (OpenAPI và các loại khác).
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
