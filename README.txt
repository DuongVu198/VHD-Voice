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
8. Trong app: Tạo hộ -> chạm ô nhập -> dùng micro trên bàn phím -> Phân tích -> Sửa/xác nhận -> Xuất JSON.

THỬ TRÊN WINDOWS
Mở Terminal/Command Prompt tại thư mục đã giải nén:
  python -m http.server 8000
Sau đó mở http://localhost:8000 trong Chrome/Edge.

LƯU Ý QUAN TRỌNG
- Chưa thử nghiệm thực tế trực tiếp trên iPhone 11; cần xác minh thao tác đọc chính tả và tải file JSON trên máy thật.
- Web Speech API ghi âm trực tiếp KHÔNG được sử dụng trong bản này, vì tương thích iOS chưa đủ ổn định.
- Nhận dạng tên tài sản bằng quy tắc có thể chưa chính xác với câu nói khó; phải kiểm tra và xác nhận.
- Chưa có module Windows nhập file. File JSON sử dụng schema vhd.voice.export, schema_version 1.
- Mất dữ liệu trình duyệt hoặc xóa web app có thể làm mất bản nháp. Luôn xuất file JSON sao lưu.
- GitHub Pages đăng nguồn code tĩnh công khai, nhưng file hộ dân chỉ lưu trên thiết bị và không nằm trong repository. KHÔNG tải JSON của hộ dân lên GitHub.
- Chỉ dùng với thông tin cá nhân khi đã kiểm tra quy trình bảo mật, thiết bị và quyền chia sẻ file.
