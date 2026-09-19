# Thư ký công việc

Trang quản lý công việc một màn hình: giao việc bằng câu nói tự nhiên, gắn link tài liệu, tự nhắc hạn, lịch tuần theo số thứ (1 = Chủ Nhật) và biểu đồ mức độ hoàn thành.

- Bản chạy thật: https://quan-ly-cong-viec-sn.netlify.app
- Dữ liệu mỗi người lưu trong trình duyệt của chính họ (localStorage).

# Đăng bài đa kênh (`/dang-bai/`)

Dán link bài viết → tự lấy tiêu đề, nội dung, ảnh → tóm tắt dưới 140 ký tự → xem trước, chỉnh sửa → đăng đồng loạt lên các nền tảng đã kết nối, kèm link bài gốc ở cuối.

- Bản chạy thật: https://quan-ly-cong-viec-sn.netlify.app/dang-bai/ (cần mật khẩu).
- Phần chạy ngầm: `netlify/functions/dang-bai.mjs` + `netlify/dang-bai/`. Mã kết nối lưu trong Netlify Blobs, không nằm trong mã nguồn.
- Không nền tảng nào viết cứng trong code: mỗi nền tảng là một "công thức kết nối". Thêm nền tảng mẫu = thêm vào `dang-bai/cong-thuc-mau.json`.
