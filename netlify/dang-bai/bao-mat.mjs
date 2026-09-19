// Mật khẩu và phiên đăng nhập. Chỉ người có mật khẩu mới dùng được các mã kết nối đã lưu.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
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

export function phienHopLe(giaTri, biMat) {
  if (!giaTri || !biMat) return false;
  const [hetHan, ky] = String(giaTri).split(".");
  if (!/^\d+$/.test(hetHan || "") || Number(hetHan) < Date.now() / 1000) return false;
  const dung = createHmac("sha256", biMat).update(hetHan).digest();
  return bangNhau(Buffer.from(ky || "", "hex"), dung);
}
