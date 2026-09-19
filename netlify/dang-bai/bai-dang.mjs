// Soạn 2 dạng bài đăng social từ nội dung bài viết:
// bài ngắn (tối đa 500 ký tự) và bài dài (tối đa 1000 ký tự), dòng cuối luôn là link bài gốc (backlink).
import { chuanHoa, doDai, rutGon, tachCau } from "./trich-xuat.mjs";

export const GIOI_HAN_BAI = { ngan: 500, dai: 1000 }; // tính cả dòng "Tham khảo bài viết tại: …"

export const dongCuoi = (link) => `Tham khảo bài viết tại: ${link}`;
// Bài hoàn chỉnh = phần mô tả + 1 dòng trống + dòng link bài gốc
export const ghepBai = (than, link) => `${than.trim()}\n\n${dongCuoi(link)}`;
// Số ký tự còn lại cho phần mô tả sau khi trừ dòng link cuối
export const nganSach = (loai, link) => GIOI_HAN_BAI[loai] - doDai(dongCuoi(link)) - 2;

// Rút gọn đoạn văn cho vừa giới hạn, cố cắt ở hết câu / hết đoạn
export function catTheoCau(vanBan, gioiHan) {
  vanBan = vanBan.trim();
  if (doDai(vanBan) <= gioiHan) return vanBan;
  const giu = [];
  for (const doan of vanBan.split("\n")) {
    if (doDai([...giu, doan].join("\n")) <= gioiHan) { giu.push(doan); continue; }
    const cauGiu = [];
    for (const c of tachCau(doan)) {
      if (doDai([...giu, [...cauGiu, c].join(" ")].join("\n")) > gioiHan) break;
      cauGiu.push(c);
    }
    if (cauGiu.length) giu.push(cauGiu.join(" "));
    break;
  }
  const kq = giu.join("\n").trim();
  return kq || rutGon(vanBan, gioiHan);
}

// Các câu theo thứ tự đọc: sapo trước, rồi các đoạn thân bài có nội dung thật
function cauUngVien(tieuDe, moTa, noiDung) {
  const cau = [];
  if (doDai(moTa) >= 60) cau.push(...tachCau(moTa));
  for (let doan of (noiDung || "").split("\n\n")) {
    if (doDai(doan) < 60 || doan.includes("http") || doan.trimEnd().endsWith(":")) continue; // bỏ tiêu đề mục, link nguồn
    if (tieuDe && doan.startsWith(tieuDe)) doan = doan.slice(tieuDe.length).trim(); // tiêu đề bị dính vào câu đầu
    cau.push(...tachCau(doan).filter((c) => doDai(c) >= 30));
  }
  const daCo = new Set();
  return cau.filter((c) => {
    const khoa = c.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 50);
    if (!khoa || daCo.has(khoa)) return false;
    daCo.add(khoa);
    return true;
  }).map(chuanHoa);
}

// Cách soạn không cần AI: lấy các câu mở đầu của bài cho tới khi đầy giới hạn
export function taoBaiDonGian(tieuDe, moTa, noiDung, link) {
  const cau = cauUngVien(tieuDe, moTa, noiDung);
  if (!cau.length) cau.push(tieuDe);
  const kq = {};
  for (const [loai, cauMoiDoan] of [["ngan", 99], ["dai", 2]]) {
    const gioiHan = nganSach(loai, link);
    const doan = [];
    let hienTai = [];
    for (const c of cau) {
      if (doDai([...doan, [...hienTai, c].join(" ")].join("\n\n")) > gioiHan) break;
      hienTai.push(c);
      if (hienTai.length >= cauMoiDoan) { doan.push(hienTai.join(" ")); hienTai = []; }
    }
    if (hienTai.length) doan.push(hienTai.join(" "));
    kq[loai] = doan.join("\n\n") || rutGon(cau[0], gioiHan);
  }
  return kq;
}
