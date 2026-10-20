// Mật khẩu và phiên đăng nhập. Chỉ người có mật khẩu mới dùng được các mã kết nối đã lưu.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual, verify } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// Dấu vân tay (SHA-256) của mã kích hoạt. Bản thân mã chỉ chủ ứng dụng giữ, không nằm trong mã nguồn.
const VAN_TAY_MA_KICH_HOAT = "699e6d6d51ae5993717fd750c4fbbf6049d3d1966d31d39e1039204defccf038";
export const TEN_COOKIE = "dang_bai_phien";
const THOI_HAN_PHIEN = 30 * 24 * 3600; // 30 ngày

const bangNhau = (a, b) => a.length === b.length && timingSafeEqual(a, b);

export function dungMaKichHoat(ma) {
  const van = createHash("sha256").update(String(ma || "").trim().toUpperCase()).digest();
  return bangNhau(van, Buffer.from(VAN_TAY_MA_KICH_HOAT, "hex"));
}

export async function bamMatKhau(matKhau) {
  const muoi = randomBytes(16);
  const bam = await scryptAsync(matKhau, muoi, 32);
  return { muoi: muoi.toString("hex"), bam: bam.toString("hex") };
}

export async function dungMatKhau(matKhau, luu) {
  if (!luu?.muoi) return false;
  const bam = await scryptAsync(String(matKhau || ""), Buffer.from(luu.muoi, "hex"), 32);
  return bangNhau(bam, Buffer.from(luu.bam, "hex"));
}

export const taoBiMatPhien = () => randomBytes(32).toString("hex");

export function taoPhien(biMat) {
  const hetHan = Math.floor(Date.now() / 1000) + THOI_HAN_PHIEN;
  const ky = createHmac("sha256", biMat).update(String(hetHan)).digest("hex");
  return { giaTri: `${hetHan}.${ky}`, thoiHan: THOI_HAN_PHIEN };
}

// ---------------------------------------------------------------- đăng nhập qua cổng Trợ lý AI SEONGON
// Cổng (seongon.tro-ly-ai.workers.dev) đã xác minh email bằng mã gửi về hộp thư, rồi ký một "vé" sống 2 phút
// bằng KHOÁ BÍ MẬT ECDSA P-256 (chỉ nằm trên Cloudflare). Ở đây chỉ giữ KHOÁ CÔNG KHAI để kiểm tra chữ ký —
// đọc được mã nguồn cũng không tự làm ra vé giả được.
const KHOA_CONG_KHAI_CONG = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHmlUo6/8YX9JHlyD2DLNeAdiWsG3
IEOTErIMXO9OgP6OBVE2FKs+8MvPPW56cHu7ZzY1pUD/KDk0E7RIXWlE4A==
-----END PUBLIC KEY-----`;
export const DIA_CHI_CONG = "https://seongon.tro-ly-ai.workers.dev/share-social/";

/** Vé dạng `<dữ liệu base64url>.<chữ ký base64url>` — trả email nếu vé thật và còn hạn, ngược lại null. */
export function docVeTuCong(ve) {
  try {
    const [phan, ky] = String(ve || "").split(".");
    if (!phan || !ky) return null;
    const dung = verify("sha256", Buffer.from(phan), { key: KHOA_CONG_KHAI_CONG, dsaEncoding: "ieee-p1363" }, Buffer.from(ky, "base64url"));
    if (!dung) return null;
    const dl = JSON.parse(Buffer.from(phan, "base64url").toString("utf8"));
    if (!dl.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dl.email) || !(dl.het_han > Date.now())) return null;
    return String(dl.email).toLowerCase();
  } catch {
    return null;
  }
}

/** Phiên gắn với email: `<hết hạn>.<email base64url>.<chữ ký HMAC>` — mỗi người một phiên, một luồng dữ liệu. */
export function taoPhienNguoi(biMat, email) {
  const hetHan = Math.floor(Date.now() / 1000) + THOI_HAN_PHIEN;
  const e = Buffer.from(email).toString("base64url");
  const ky = createHmac("sha256", biMat).update(`${hetHan}.${e}`).digest("hex");
  return { giaTri: `${hetHan}.${e}.${ky}`, thoiHan: THOI_HAN_PHIEN };
}

export function docPhienNguoi(giaTri, biMat) {
  if (!giaTri || !biMat) return null;
  const [hetHan, e, ky] = String(giaTri).split(".");
  if (!/^\d+$/.test(hetHan || "") || Number(hetHan) < Date.now() / 1000 || !e || !ky) return null;
  const dung = createHmac("sha256", biMat).update(`${hetHan}.${e}`).digest();
  if (!bangNhau(Buffer.from(ky, "hex"), dung)) return null;
  return Buffer.from(e, "base64url").toString("utf8");
}

export function phienHopLe(giaTri, biMat) {
  if (!giaTri || !biMat) return false;
  const [hetHan, ky] = String(giaTri).split(".");
  if (!/^\d+$/.test(hetHan || "") || Number(hetHan) < Date.now() / 1000) return false;
  const dung = createHmac("sha256", biMat).update(hetHan).digest();
  return bangNhau(Buffer.from(ky || "", "hex"), dung);
}
