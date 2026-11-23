VHD VOICE v1.0 - BẢN APP iPHONE (PWA)
=================================

TÍNH NĂNG
- Nhập từng tài sản hoặc nhập liên tục (ngăn cách bằng "tiếp theo").
- Dùng tính năng đọc chính tả (micro trên bàn phím iPhone) để nhập tiếng Việt.
- Chọn/tạo/sửa hộ, kiểm tra và xác nhận tài sản.
- Lưu tại máy bằng IndexedDB (có dự phòng localStorage), sử dụng giao diện offline sau lần tải đầu tiên.
- Xuất JSON cho từng hộ hoặc toàn bộ dự án; nhập JSON để khôi phục bản sao lưu.
- KHÔNG tự động tính toán đơn giá/phương án Excel; phần này dành cho module Windows về sau.

CÁCH ĐƯA LÊN IPHONE BẰNG GITHUB PAGES
1. Tạo tài khoản GitHub nếu chưa có.
2. Tạo repository mới, ví dụ vhd-voice-app (chế độ Public nếu dùng GitHub Pages miễn phí).
3. Giải nén ZIP, tải toàn bộ FILE VÀ THƯ MỤC BÊN TRONG lên thư mục gốc repository (index.html phải ở gốc).
4. Vào Settings -> Pages -> Build and deployment -> Deploy from a branch.
5. Chọn main, /(root), Save. Chờ GitHub cung cấp URL HTTPS.
6. Mở URL này bằng Safari iPhone -> Chia sẻ -> Thêm vào Màn hình chính -> Thêm.
7. Mở biểu tượng VHD Voice. Vào Cài đặt -> Cài đặt chung -> Bàn phím -> Bật đọc chính tả (nếu đang tắt), thêm bàn phím tiếng Việt.
