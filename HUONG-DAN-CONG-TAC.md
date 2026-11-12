# Hướng dẫn cộng tác — Share social đa kênh (`/dang-bai/`)

Repo này chỉ chứa **Share social đa kênh** (+ trang Thư ký công việc cũ ở `index.html`, không cần đụng).
Công cụ **Tạo social** nằm ở repo khác (`anhtuandayle/tro-ly-ai-seongon`) do anh Tuấn phụ trách — 2 bên sửa độc lập,
chỉ cần giữ đúng **"hợp đồng kết nối"** ở cuối file này.

- Chạy thật: https://quan-ly-cong-viec-sn.netlify.app/dang-bai/ (mở từ cổng https://seongon.tro-ly-ai.workers.dev → Share social).
- Netlify tự deploy mỗi khi nhánh `main` thay đổi (~30 giây).

## Cách làm việc (để không làm hỏng bản đang chạy)

1. Tạo nhánh mới từ `main`, ví dụ `toi-uu-tom-tat`. **Không đẩy thẳng lên `main`.**
2. Sửa, đẩy nhánh lên GitHub, mở **Pull Request** vào `main`.
3. Netlify tự tạo **Deploy Preview** (link thử riêng, hiện trong Pull Request) — thử trên link đó, không ảnh hưởng người đang dùng.
4. Anh Tuấn xem, bấm Merge → bản thật cập nhật.

## Cấu trúc

| Phần | File |
|---|---|
| Giao diện (1 trang) | `dang-bai/index.html` |
| Công thức kết nối từng nền tảng (không viết cứng nền tảng trong code) | `dang-bai/cong-thuc-mau.json` |
| Quy tắc đọc bài theo từng loại trang | `dang-bai/quy-tac-doc.json`, `netlify/dang-bai/quy-tac-doc.mjs` |
| Cổng API (mọi đường `/api/dang-bai/*`) | `netlify/functions/dang-bai.mjs` |
| Đọc bài từ link (H2/H3, gạch đầu dòng, bảng, danh mục, RSS, sitemap) | `netlify/dang-bai/trich-xuat.mjs`, `doc-chung.mjs` |
| AI tóm tắt / viết bài (Gemini) | `netlify/dang-bai/tri-tue.mjs` |
| Đăng lên nền tảng | `netlify/dang-bai/phan-phoi.mjs`, `bai-dang.mjs` |
| Lưu trữ (Netlify Blobs) | `netlify/dang-bai/kho.mjs` |
| Đăng nhập bằng vé của cổng (chữ ký ECDSA) | `netlify/dang-bai/bao-mat.mjs` |

## Chạy thử trên máy

```bash
npm install
npx netlify dev
```

- `KHO_CUC_BO=./.kho-thu` — lưu dữ liệu vào thư mục trên máy thay cho Netlify Blobs (thư mục này không commit).
- `GEMINI_GOC` — (tuỳ chọn) đổi địa chỉ máy chủ Gemini; khoá Gemini do từng người dùng dán trong app, không đặt trong mã.

## Quy ước bắt buộc

- **Không commit khoá, mật khẩu, token, file `.env`.** Mã kết nối của người dùng lưu mã hoá trong Netlify Blobs.
  `bao-mat.mjs` chỉ chứa KHOÁ CÔNG KHAI của cổng (để kiểm vé) — được phép.
- Không đọc / dùng mật khẩu ghi trong sheet của team.
- Thông báo lỗi viết **tiếng Việt đời thường** (người dùng là nhân viên marketing, không rành kỹ thuật).
- Các file `.mjs` / `.html` đang dùng xuống dòng kiểu Windows (CRLF) — giữ nguyên khi sửa.
- Netlify Functions giới hạn ~26 giây/lần gọi: việc đọc nhiều trang phải có "ngân sách thời gian" (xem `danhSachChung`, 22 giây).
- Kết quả hiện **link công khai** của bài đã đăng (không đưa link trang quản trị lên đầu).

## Hợp đồng kết nối với Tạo social (KHÔNG đổi một phía — báo anh Tuấn trước)

Share social đọc được các social do Tạo social tạo ra và đăng bài lên đó (phần "B. Social đã tạo").

1. **Vào app**: cổng gọi `GET /api/share/ve` → chuyển người dùng tới `/api/dang-bai/vao?ve=<payload>.<chữ ký>`.
   `payload` (base64url JSON) = `{ email, het_han (2 phút), the }`; chữ ký ECDSA P-256 kiểm bằng khoá công khai trong `bao-mat.mjs`.
2. **Vé liên kết** `the` (hạn 30 ngày, `muc: "lien-ket"`) được lưu vào kho của người dùng, khoá `lien-ket-cong`.
3. Gọi cổng bằng `Authorization: Bearer <the>`:
   - `GET  https://seongon.tro-ly-ai.workers.dev/api/lien-ket/du-an` →
     `{ du_an: [{ id, name, brand, socials: [{ id, platform, siteUrl, at, share, ly_do }] }] }`
   - `POST .../api/lien-ket/du-an` body `{ ten }` → `{ id, name }` (tạo / lấy dự án theo tên — danh sách dự án dùng chung 2 công cụ)
   - `POST .../api/lien-ket/dang` body `{ du_an_id, chon: [id social], tieu_de, tom_tat, noi_dung, link_goc, anh_url }` →
     `{ results: [{ id, platform, ok, url | error }] }`
4. Mặc định đăng lên **tất cả** social đã tạo của dự án, người dùng bỏ tích được.

Muốn đổi bất kỳ điều gì ở mục này (tên trường, đường dẫn, cách ký vé) → mở Issue / nhắn anh Tuấn để 2 bên sửa cùng lúc.
