// Quy tắc đọc theo từng trang web.
//
// Nhiều trang (nhất là trang ngân hàng / chứng khoán) dựng bằng JavaScript nên tải thẳng thì chỉ ra khung rỗng,
// nhưng chính trang đó lại lấy nội dung từ một kho dữ liệu công khai. Mỗi "quy tắc" trong dang-bai/quy-tac-doc.json
// chỉ cho hệ thống: địa chỉ bài nào thì đọc ở kho dữ liệu nào, lấy tiêu đề/nội dung/ảnh ở đâu, và danh sách
// toàn bộ bài của mục đó nằm ở đâu. Thêm trang mới = thêm quy tắc, không sửa mã nguồn.
import * as cheerio from "cheerio";
import { LoiNguoiDung, TRINH_DUYET, chuanHoa } from "./trich-xuat.mjs";

const TOI_DA_TRANG = 5; // mỗi lần lấy danh sách tối đa 5 trang dữ liệu
const TOI_DA_BAI = 300;

export function layTheoDuong(duLieu, duong) {
  let cur = duLieu;
  for (const phan of (duong || "").split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(phan)) cur = cur[Number(phan)];
    else if (cur && typeof cur === "object") cur = cur[phan];
    else return null;
    if (cur === undefined || cur === null) return null;
  }
  return cur;
}

const dien = (mau, giaTri) => mau.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(giaTri[k] ?? ""));

async function taiJson(diaChi) {
  const r = await fetch(diaChi, { headers: { "User-Agent": TRINH_DUYET, Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`mã ${r.status}`);
  return r.json();
}

// Tìm quy tắc khớp với địa chỉ. danhSach=true: tìm quy tắc có danh sách bài của mục đó.
export function timQuyTac(quyTac, url, danhSach = false) {
  for (const qt of quyTac || []) {
    if (danhSach) {
      const mau = qt.danh_sach?.khop_trang;
      if (mau && new RegExp(mau, "i").test(url)) return { qt, m: null };
    } else {
      const m = new RegExp(qt.khop || "$^", "i").exec(url);
      if (m) return { qt, m };
    }
  }
  return { qt: null, m: null };
}

// Lấy các đoạn văn từ một khối HTML (phần content của kho dữ liệu)
export function vanBanTuHtml(html) {
  const $ = cheerio.load(html || "");
  $("script, style, noscript").remove();
  const daCo = new Set();
  const doan = [];
  $("p").each((_, el) => {
    const t = chuanHoa($(el).text());
    if (t.length >= 40 && !daCo.has(t)) { daCo.add(t); doan.push(t); }
  });
  return doan.join("\n\n");
}

// Đọc bài theo quy tắc. Trả về null nếu không có quy tắc nào khớp.
export async function docBai(quyTac, url) {
  const { qt, m } = timQuyTac(quyTac, url);
  if (!qt) return null;
  const b = qt.bai;
  const giaTri = Object.fromEntries([m[0], ...m.slice(1)].map((v, i) => [String(i), v ?? ""]));
  let duLieu;
  try {
    duLieu = await taiJson(dien(b.dia_chi, giaTri));
  } catch (e) {
    throw new LoiNguoiDung(`Không đọc được kho dữ liệu của ${qt.ten}: ${e.message}`);
  }
  const tieuDe = chuanHoa(layTheoDuong(duLieu, b.tieu_de) || "");
  const noiDung = vanBanTuHtml(layTheoDuong(duLieu, b.noi_dung_html) || "");
  if (!tieuDe && !noiDung) return null;
  const anh = layTheoDuong(duLieu, b.anh) || "";
  return {
    link_goc: url,
    ten_mien: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0],
    tieu_de: tieuDe,
    mo_ta: chuanHoa(String(layTheoDuong(duLieu, b.mo_ta) || "").replace(/<[^>]+>/g, " ")),
    noi_dung: noiDung,
    anh_url: anh ? new URL(anh, b.goc || url).href : "",
    tieu_de_chac: !!tieuDe,
    cach_doc: `Đọc thẳng từ kho dữ liệu của trang (${qt.ten})`,
  };
}

// Lấy danh sách toàn bộ bài của mục tương ứng với địa chỉ
export async function danhSachBai(quyTac, url) {
  const qt = timQuyTac(quyTac, url, true).qt || timQuyTac(quyTac, url).qt;
  const ds = qt?.danh_sach;
  if (!ds) {
    throw new LoiNguoiDung("Chưa có cách lấy danh sách bài cho trang này. Anh/chị gửi link mục blog cho người lập trình "
      + "để bổ sung, hoặc dán từng link bài như bình thường.");
  }
  const bai = [];
  let trang = 1, tong = 1;
  while (trang <= Math.min(tong, TOI_DA_TRANG) && bai.length < TOI_DA_BAI) {
    let duLieu;
    try {
      duLieu = await taiJson(dien(ds.dia_chi, { trang }));
    } catch (e) {
      if (trang === 1) throw new LoiNguoiDung(`Không lấy được danh sách bài: ${e.message}`);
      break;
    }
    tong = layTheoDuong(duLieu, ds.tong_trang || "") || tong;
    for (const x of layTheoDuong(duLieu, ds.duong || "") || []) {
      if (!x || typeof x !== "object") continue;
      const link = ds.link.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(x[k] ?? ""));
      const ten = chuanHoa(String(layTheoDuong(x, ds.tieu_de) || ""));
      if (ten && link) bai.push({ tieu_de: ten, link });
    }
    trang++;
  }
  return { ten_muc: qt.ten, tong_trang: tong, bai: bai.slice(0, TOI_DA_BAI) };
}
