VHD VOICE - NHẬP LIỆU HIỆN TRƯỜNG (PWA)
=================================

TÍNH NĂNG
- Nhập nhà/công trình và cây theo từng hồ sơ hộ.
- Dùng bàn phím, đọc chính tả trên iPhone hoặc nhận giọng nói khi trình duyệt hỗ trợ.
- Chọn/tạo hồ sơ, sửa tài sản, chuyển hồ sơ vào thùng rác và khôi phục.
- Tự lưu hồ sơ tại máy bằng localStorage, sử dụng giao diện offline sau lần tải đầu tiên.
- Lưu JSON cho từng hộ hoặc sao lưu toàn bộ hồ sơ; nhập JSON để khôi phục.
- Nhập tài sản rồi bấm Lưu; không cần xác nhận từng dòng.
- Xuất PDF: mở hồ sơ, chọn Xuất PDF -> Lưu PDF / In. Trên máy tính chọn Lưu dưới dạng PDF; trên iPhone mở rộng bản xem trước bằng hai ngón tay, chọn Chia sẻ -> Lưu vào Tệp.
- Bản PDF gồm tên hộ, bảng Nhà/Công trình (tên tài sản, thông số kỹ thuật) và bảng Cây (tên cây, đường kính cm, chiều cao m, số lượng cây). Chỉ các dòng đã Lưu được đưa vào bảng.
- Tự đọc hồ sơ bản cũ từ IndexedDB/localStorage và hỗ trợ nhập JSON bản cũ.
- KHÔNG tự động tính toán đơn giá/phương án Excel; phần này dành cho module Windows về sau.

CẤU TRÚC HIỆN TẠI
- index.html: trang ứng dụng chính.
- unified.mjs, field.css: logic và giao diện hiện tại.
- commands.mjs: xử lý số, phép tính và kiểm tra tài sản.
- unified-data.mjs, field-import.mjs: đọc bản sao lưu và chuyển đổi dữ liệu cũ.
- sw.js, manifest.webmanifest: bộ nhớ đệm offline và cấu hình PWA.
- report.mjs, report.css: bản kiểm kê dạng bảng để in hoặc lưu PDF.

CÁCH ĐƯA LÊN IPHONE BẰNG GITHUB PAGES
1. Tạo tài khoản GitHub nếu chưa có.
2. Tạo repository mới, ví dụ vhd-voice-app (chế độ Public nếu dùng GitHub Pages miễn phí).
3. Giải nén ZIP, tải toàn bộ FILE VÀ THƯ MỤC BÊN TRONG lên thư mục gốc repository (index.html phải ở gốc).
4. Vào Settings -> Pages -> Build and deployment -> Deploy from a branch.
5. Chọn main, /(root), Save. Chờ GitHub cung cấp URL HTTPS.
6. Mở URL này bằng Safari iPhone -> Chia sẻ -> Thêm vào Màn hình chính -> Thêm.
7. Mở biểu tượng VHD Voice. Vào Cài đặt -> Cài đặt chung -> Bàn phím -> Bật đọc chính tả (nếu đang tắt), thêm bàn phím tiếng Việt.
