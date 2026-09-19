// Đẩy bài lên các nền tảng theo "công thức kết nối" của từng nền tảng.
// Không có nền tảng nào được viết cứng ở đây: mọi thông tin gửi đi đều nằm trong công thức.
import { TRINH_DUYET } from "./trich-xuat.mjs";

const BIEN = /\{\{\s*([\w.:|]+)\s*\}\}/g;
class LoiGui extends Error {}

// ---------------------------------------------------------------- điền biến

export function layTheoDuong(duLieu, duong) {
  let cur = duLieu;
  for (const phan of duong.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(phan)) cur = cur[Number(phan)];
    else if (cur && typeof cur === "object") cur = cur[phan];
    else return null;
    if (cur === undefined || cur === null) return null;
  }
  return cur;
}

export function dien(mau, bien, trongDiaChi = false) {
  let rong = false;
  const chiMotBien = /^\{\{\s*[\w.]+\s*\}\}$/.test(mau.trim());
  const kq = mau.replace(BIEN, (_, duong) => {
    if (duong.startsWith("basic_auth:")) {
      // Đăng nhập kiểu "Basic" (vd WordPress): base64 của "tên:mật_khẩu"
      const phan = duong.slice("basic_auth:".length).split("|").map((x) => layTheoDuong(bien, x));
      if (phan.some((p) => p === null || p === "")) { rong = true; return ""; }
      return Buffer.from(phan.join(":")).toString("base64");
    }
    let v = layTheoDuong(bien, duong);
    if (v === null || v === "") { rong = true; return ""; }
    v = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (trongDiaChi && /^https?:\/\//.test(v)) return v.trim().replace(/\/+$/, ""); // người dùng dán địa chỉ trang — giữ nguyên
    // trong địa chỉ: nếu cả chuỗi chỉ là 1 biến (vd người dùng dán nguyên link webhook) thì giữ nguyên
    if (trongDiaChi && !chiMotBien) v = encodeURIComponent(v).replace(/%3A/gi, ":").replace(/%40/gi, "@");
    return v;
  });
  return [kq, rong];
}

function dienCauTruc(nut, bien) {
  if (typeof nut === "string") return dien(nut, bien)[0];
  if (Array.isArray(nut)) return nut.map((x) => dienCauTruc(x, bien));
  if (nut && typeof nut === "object") return Object.fromEntries(Object.entries(nut).map(([k, v]) => [k, dienCauTruc(v, bien)]));
  return nut;
}

const dungBien = (ct, ten) => JSON.stringify(ct.gui || {}).replace(/\{\{\s+/g, "{{").includes("{{" + ten);
const laAnhTep = (v) => typeof v === "string" && v.trim() === "{{anh_tep}}";

// ---------------------------------------------------------------- ảnh

async function chuanBiAnh(bai) {
  if (bai.anh_tai_len) {
    return { du: Buffer.from(bai.anh_tai_len.base64, "base64"), ten: bai.anh_tai_len.ten || "anh.jpg", kieu: bai.anh_tai_len.kieu || "image/jpeg" };
  }
  if (!bai.anh_url) return null;
  try {
    const r = await fetch(bai.anh_url, { headers: { "User-Agent": TRINH_DUYET, Referer: bai.link_goc || "" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`mã ${r.status}`);
    const kieu = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const duoi = { "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" }[kieu] || ".jpg";
    return { du: Buffer.from(await r.arrayBuffer()), ten: "anh" + duoi, kieu };
  } catch (e) {
    throw new LoiGui(`Không tải được ảnh của bài để gửi kèm (${e.message}). Hãy tải một ảnh khác lên ở bước Xem trước.`);
  }
}

// ---------------------------------------------------------------- lỗi dễ hiểu

const GOI_Y_THEO_MA = {
  400: "Nền tảng không nhận dữ liệu gửi lên — thường do ID (trang/kênh/nhóm) sai hoặc nội dung/ảnh không hợp lệ.",
  401: "Mã kết nối sai hoặc đã hết hạn. Hãy tạo mã mới rồi kết nối lại.",
  403: "Mã kết nối không đủ quyền đăng bài (hoặc tài khoản/bot chưa được thêm vào trang/kênh).",
  404: "Không tìm thấy nơi đăng — ID trang/kênh hoặc địa chỉ trong công thức bị sai.",
  413: "Ảnh hoặc nội dung quá lớn so với giới hạn của nền tảng.",
  429: "Gửi quá nhiều trong thời gian ngắn. Đợi vài phút rồi thử lại.",
};
const goiYLoi = (ma) => GOI_Y_THEO_MA[ma] || (ma >= 500 ? "Máy chủ của nền tảng đang gặp sự cố. Thử lại sau." : "");

function rutThongBaoLoi(phanHoi, duongLoi) {
  if (phanHoi && typeof phanHoi === "object") {
    for (const d of [duongLoi, "description", "error.message", "error_description", "message", "errors.0.message", "errors.0.detail", "detail", "error", "errors"]) {
      if (!d) continue;
      const v = layTheoDuong(phanHoi, d);
      if (v) return typeof v === "string" ? v : JSON.stringify(v).slice(0, 400);
    }
  }
  if (typeof phanHoi === "string") return phanHoi.replace(/<[^>]+>/g, " ").trim().slice(0, 400);
  return "";
}

// ---------------------------------------------------------------- gửi 1 nền tảng

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[c]));

// Bản HTML của bài (cho WordPress, Blogger…): ảnh ở đầu, mỗi đoạn 1 thẻ <p>, link gốc bấm được
function noiDungHtml(noiDung, link, anhUrl, tieuDe) {
  const phan = anhUrl ? [`<p><img src="${escHtml(anhUrl)}" alt="${escHtml(tieuDe)}"></p>`] : [];
  const dl = escHtml(link);
  for (const doan of noiDung.split("\n\n")) {
    const d = escHtml(doan).replace(/\n/g, "<br>");
    phan.push(`<p>${d.includes(dl) ? d.replace(dl, `<a href="${dl}">${dl}</a>`) : d}</p>`);
  }
  return phan.join("\n");
}

async function guiMot(ketNoi, bai) {
  const ct = ketNoi.cong_thuc;
  const gui = ct.gui;
  const kqCt = ct.ket_qua || {};
  const bien = {
    tieu_de: bai.tieu_de,
    tom_tat: bai.tom_tat,
    link_goc: bai.link_goc,
    // bài đã chọn (ngắn/dài), dòng cuối luôn là link bài gốc
    noi_dung: bai.noi_dung || `${bai.tieu_de}\n\n${bai.tom_tat}\n\n${bai.link_goc}`,
    anh_url: bai.anh_tai_len ? "" : bai.anh_url || "",
    truong: ketNoi.gia_tri || {},
  };
  bien.noi_dung_html = noiDungHtml(bien.noi_dung, bai.link_goc, bien.anh_url, bai.tieu_de);

  let anh = null;
  if (dungBien(ct, "anh_tep") || dungBien(ct, "anh_base64")) {
    anh = await chuanBiAnh(bai);
    if (anh && dungBien(ct, "anh_base64")) bien.anh_base64 = anh.du.toString("base64");
  }

  const [diaChi] = dien(gui.dia_chi, bien, true);
  if (!/^https?:\/\//.test(diaChi)) throw new LoiGui("Địa chỉ gửi bài chưa đúng (thiếu thông tin kết nối?). Kiểm tra lại kết nối này.");

  const tieuDeHttp = { "User-Agent": "DangBaiDaKenh/1.0" };
  for (const [k, v] of Object.entries(gui.tieu_de_http || {})) {
    const [giaTri, rong] = dien(v, bien);
    if (!rong) tieuDeHttp[k] = giaTri; // bỏ dòng xác thực nếu người dùng để trống mã tuỳ chọn
  }
  const boContentType = () => { for (const k of Object.keys(tieuDeHttp)) if (k.toLowerCase() === "content-type") delete tieuDeHttp[k]; };

  const kieu = gui.kieu_than || "json";
  const thanMau = gui.than || {};
  let than;
  if (kieu === "multipart") {
    than = new FormData();
    for (const [k, v] of Object.entries(thanMau)) {
      if (laAnhTep(v)) { if (anh) than.append(k, new Blob([anh.du], { type: anh.kieu }), anh.ten); }
      else { const g = dienCauTruc(v, bien); than.append(k, typeof g === "string" ? g : JSON.stringify(g)); }
    }
    boContentType(); // để trình gửi tự đặt ranh giới multipart
  } else if (kieu === "form") {
    const g = dienCauTruc(thanMau, bien);
    than = new URLSearchParams(Object.entries(g).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
    boContentType();
  } else {
    than = JSON.stringify(dienCauTruc(thanMau, bien));
    if (!Object.keys(tieuDeHttp).some((k) => k.toLowerCase() === "content-type")) tieuDeHttp["Content-Type"] = "application/json; charset=utf-8";
  }

  const mayChu = new URL(diaChi).host;
  let r;
  try {
    r = await fetch(diaChi, { method: (gui.phuong_thuc || "POST").toUpperCase(), headers: tieuDeHttp, body: than, signal: AbortSignal.timeout(35000) });
  } catch (e) {
    if (e.name === "TimeoutError") throw new LoiGui(`${mayChu} không phản hồi sau 35 giây.`);
    throw new LoiGui(`Không kết nối được tới ${mayChu}: ${e.cause?.code || e.cause?.errors?.[0]?.code || e.message}`);
  }
  const vanBan = await r.text();
  let phanHoi;
  try { phanHoi = vanBan.trim() ? JSON.parse(vanBan) : {}; } catch { phanHoi = vanBan; }

  let thanhCong = r.ok;
  if (thanhCong && kqCt.thanh_cong_khi && phanHoi && typeof phanHoi === "object") thanhCong = !!layTheoDuong(phanHoi, kqCt.thanh_cong_khi);
  if (!thanhCong) {
    return { thanh_cong: false, ma_http: r.status, loi: rutThongBaoLoi(phanHoi, kqCt.thong_bao_loi) || "(nền tảng không nói rõ lý do)", goi_y: goiYLoi(r.status) };
  }
  let duongDan = null;
  if (kqCt.duong_dan_bai && phanHoi && typeof phanHoi === "object") {
    const [d, rong] = dien(kqCt.duong_dan_bai, { phan_hoi: phanHoi });
    if (!rong) duongDan = d;
  }
  return { thanh_cong: true, ma_http: r.status, duong_dan: duongDan };
}

export async function guiAnToan(ketNoi, bai) {
  let kq;
  try {
    kq = await guiMot(ketNoi, bai);
  } catch (e) {
    kq = { thanh_cong: false, loi: e instanceof LoiGui ? e.message : `Lỗi không mong đợi: ${e.message}`, goi_y: "" };
  }
  return { ...kq, ten: ketNoi.ten, id: ketNoi.id };
}
