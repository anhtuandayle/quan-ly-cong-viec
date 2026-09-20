// Lấy bài viết từ một đường dẫn: tiêu đề, nội dung toàn văn, ảnh đại diện.
// Kèm bộ tóm tắt dự phòng (không cần AI) luôn trả về đoạn dưới 140 ký tự.
import * as cheerio from "cheerio";

export const GIOI_HAN_TOM_TAT = 139; // "dưới 140 ký tự" => tối đa 139
export const TRINH_DUYET =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export class LoiNguoiDung extends Error {}

export const chuanHoa = (s) => (s || "").normalize("NFC").replace(/\s+/g, " ").trim();
export const doDai = (s) => [...(s || "").normalize("NFC")].length;

// ---------------------------------------------------------------- tải trang

async function taiTrang(url) {
  if (!/^https?:\/\//i.test(url || "")) throw new LoiNguoiDung("Đường dẫn phải bắt đầu bằng http:// hoặc https://");
  let r;
  try {
    r = await fetch(url, {
      headers: { "User-Agent": TRINH_DUYET, Accept: "text/html,application/xhtml+xml", "Accept-Language": "vi,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new LoiNguoiDung(`Không mở được trang: ${e.cause?.code || e.message}`);
  }
  if (!r.ok) throw new LoiNguoiDung(`Trang web từ chối (mã ${r.status}). Trang có thể cần đăng nhập hoặc chặn máy đọc tự động.`);
  const loai = r.headers.get("content-type") || "";
  const du = new Uint8Array(await r.arrayBuffer()).slice(0, 6_000_000);
  const dau = new TextDecoder("latin1").decode(du.slice(0, 4000));
  if (!/html/i.test(loai) && !/<html/i.test(dau)) throw new LoiNguoiDung("Đường dẫn này không phải một trang bài viết (không phải HTML).");
  const ma = (loai.match(/charset=([\w-]+)/i) || dau.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  let html;
  try { html = new TextDecoder(ma).decode(du); } catch { html = new TextDecoder("utf-8").decode(du); }
  return { html, urlCuoi: r.url || url };
}

// ---------------------------------------------------------------- phân tích HTML

const BO_QUA = "script, style, noscript, nav, footer, aside, form, svg, iframe, button, select, template";
const KHOI_BAI = /(article|content|detail|post|entry|story|body|main|noidung|fck)/i;

function timBaiLd(nut) {
  if (Array.isArray(nut)) {
    for (const x of nut) { const r = timBaiLd(x); if (r) return r; }
  } else if (nut && typeof nut === "object") {
    const loai = [].concat(nut["@type"] || []).join(" ");
    if (/Article|BlogPosting|Report/.test(loai)) return nut;
    for (const k of ["@graph", "mainEntity", "mainEntityOfPage"]) {
      if (k in nut) { const r = timBaiLd(nut[k]); if (r) return r; }
    }
  }
  return null;
}
function anhTuLd(a) {
  if (typeof a === "string") return a;
  if (Array.isArray(a) && a.length) return anhTuLd(a[0]);
  if (a && typeof a === "object") return a.url || a.contentUrl || "";
  return "";
}

export function boTenTrang(tieuDe, tenTrang, tenMien) {
  const gon = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const dau of [" | ", " - ", " – ", " — "]) {
    const vt = tieuDe.lastIndexOf(dau);
    if (vt > 0) {
      const duoi = tieuDe.slice(vt + dau.length);
      const g = gon(duoi);
      if (duoi.length <= 30 && g && (gon(tenMien).includes(g) || g === gon(tenTrang))) return tieuDe.slice(0, vt).trim();
    }
  }
  return tieuDe;
}

const TRINH_DUYET_AO = "https://r.jina.ai/"; // dịch vụ miễn phí: mở trang như trình duyệt thật rồi trả lại HTML đầy đủ

// Cho các trang "rỗng" (nội dung chỉ hiện ra sau khi chạy JavaScript, vd trang làm bằng React)
async function taiQuaTrinhDuyetAo(url) {
  const r = await fetch(TRINH_DUYET_AO + url, {
    headers: { "X-Return-Format": "html", "User-Agent": "DangBaiDaKenh/1.0" },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`trình duyệt ảo báo lỗi ${r.status}`);
  return r.text();
}

async function docNhanh(url) {
  try {
    const t = await taiTrang(url);
    return { kq: phanTich(t.html, url, t.urlCuoi), loiTai: null, urlCuoi: t.urlCuoi };
  } catch (e) {
    if (!(e instanceof LoiNguoiDung)) throw e;
    return { kq: null, loiTai: e, urlCuoi: url };
  }
}

// Dùng nội dung người dùng tự sao chép từ trang (Ctrl+A, Ctrl+C) khi máy không đọc được
async function tuNoiDungDan(url, vanBan) {
  let { kq } = await docNhanh(url).catch(() => ({ kq: null }));
  kq = kq || { link_goc: url, ten_mien: new URL(url).hostname.replace(/^www\./, ""), tieu_de: "", mo_ta: "", anh_url: "", tieu_de_chac: false };
  const dong = vanBan.normalize("NFC").split(/\r?\n/).map(chuanHoa).filter((d) => d.length >= 3);
  if (!dong.length) throw new LoiNguoiDung("Nội dung dán vào đang trống.");
  // tiêu đề: dòng đầu tiên đủ dài (bỏ qua các dòng menu ngắn)
  if (!kq.tieu_de_chac) kq.tieu_de = dong.find((d) => d.length >= 20 && d.length <= 200 && !d.endsWith(":")) || dong[0].slice(0, 200);
  kq.noi_dung = (dong.filter((d) => d.length >= 40).join("\n\n") || dong.join("\n\n")).slice(0, 60000);
  return { ...kq, cach_doc: "Dùng nội dung anh dán vào" };
}

// Đọc bài: tải bình thường trước; nếu trang gần như rỗng thì mở lại bằng trình duyệt ảo.
// Người dùng cũng có thể tự dán nội dung bài (noiDungDan) khi máy không đọc được.
export async function trichXuat(url, noiDungDan, quyTac) {
  url = (url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new LoiNguoiDung("Đường dẫn phải bắt đầu bằng http:// hoặc https://");
  if (noiDungDan) return tuNoiDungDan(url, noiDungDan);
  if (quyTac?.length) {
    const { docBai } = await import("./quy-tac-doc.mjs");
    const theoQuyTac = await docBai(quyTac, url);
    if (theoQuyTac && theoQuyTac.noi_dung.length >= 200) return theoQuyTac;
  }
  let { kq, loiTai, urlCuoi } = await docNhanh(url);
  if (kq && kq.noi_dung.length >= 400) return { ...kq, cach_doc: "Đọc trực tiếp" };
  try {
    const kqAo = phanTich(await taiQuaTrinhDuyetAo(url), url, urlCuoi);
    if (!kq || kqAo.noi_dung.length > kq.noi_dung.length) {
      return { ...kqAo, cach_doc: "Đọc bằng trình duyệt ảo (trang tải nội dung bằng JavaScript)", it_chu: kqAo.noi_dung.length < 400 };
    }
  } catch {}
  if (kq) return { ...kq, cach_doc: "Đọc trực tiếp (trang có ít chữ)", it_chu: true };
  if (loiTai && loiTai.message.includes("từ chối")) throw loiTai;
  throw new LoiNguoiDung("Không đọc được trang này. Hãy mở bài, bấm Ctrl+A rồi Ctrl+C và dán nội dung vào ô \"Dán nội dung bài\" bên dưới.");
}

function phanTich(html, url, urlCuoi) {
  const $ = cheerio.load(html);
  const meta = {};
  $("meta").each((_, el) => {
    const k = ($(el).attr("property") || $(el).attr("name") || $(el).attr("itemprop") || "").toLowerCase();
    const v = $(el).attr("content");
    if (k && v && !(k in meta)) meta[k] = v;
  });
  let baiLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (baiLd) return;
    try { baiLd = timBaiLd(JSON.parse($(el).text().trim())); } catch {}
  });
  baiLd = baiLd || {};
  $(BO_QUA).remove();

  const trongBai = (el) => $(el).parents().toArray().some((p) =>
    p.tagName === "article" || KHOI_BAI.test(`${$(p).attr("class") || ""} ${$(p).attr("id") || ""}`));

  const tieuDeChac = !!(meta["og:title"] || meta["twitter:title"] || baiLd.headline || $("h1").first().text().trim());
  let tieuDe = chuanHoa(meta["og:title"] || meta["twitter:title"] || baiLd.headline || $("h1").first().text() || $("title").first().text());
  tieuDe = boTenTrang(tieuDe, meta["og:site_name"] || "", new URL(urlCuoi).hostname);
  const moTa = chuanHoa(meta["og:description"] || meta["description"] || meta["twitter:description"] || baiLd.description || "");

  const doan = [];
  $("p").each((_, el) => {
    const t = chuanHoa($(el).text()).replace(/\[\d+\]/g, "");
    if (t) doan.push([t, trongBai(el)]);
  });
  const doanTrong = doan.filter(([t, o]) => o && t.length >= 40).map(([t]) => t);
  const tatCa = doan.filter(([t]) => t.length >= 40).map(([t]) => t);
  const tong = (a) => a.reduce((s, x) => s + x.length, 0);
  let noiDung = tong(doanTrong) >= 300 ? doanTrong : tatCa;
  const thanLd = chuanHoa(baiLd.articleBody || "");
  if (thanLd.length > tong(noiDung)) noiDung = thanLd.split(/(?<=[.!?])\s+(?=\S)/);
  noiDung = [...new Set(noiDung)];

  let anh = meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"] || anhTuLd(baiLd.image);
  if (!anh) {
    $("img").each((_, el) => {
      if (anh) return;
      const src = $(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || "";
      if (src && !src.startsWith("data:") && trongBai(el) && !/(logo|icon|avatar|sprite|\.svg|\.gif)/i.test(src)) anh = src;
    });
  }
  anh = anh ? new URL(anh, urlCuoi).href : "";

  if (!tieuDe && !noiDung.length) {
    throw new LoiNguoiDung("Không tìm thấy tiêu đề hay nội dung.");
  }
  return {
    link_goc: url,
    ten_mien: new URL(urlCuoi).hostname.replace(/^www\./, ""),
    tieu_de: tieuDe,
    mo_ta: moTa,
    noi_dung: noiDung.join("\n\n"),
    anh_url: anh,
    tieu_de_chac: tieuDeChac,
  };
}

// ---------------------------------------------------------------- tóm tắt dự phòng

const TU_DUNG = new Set(`và của là có cho các những được với trong một này đã không khi để từ theo
người đến về như cũng thì ra tại đó nhiều hơn vào sẽ bị lại nên mà rất đang năm nay sau
the a an of to in and is for on with that by as at from be are this it or`.split(/\s+/));
const tu = (s) => (s || "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];

export function rutGon(cau, gioiHan = GIOI_HAN_TOM_TAT) {
  cau = chuanHoa(cau);
  if (doDai(cau) <= gioiHan) return cau;
  let phan = [...cau].slice(0, gioiHan - 1).join("");
  for (const dau of [", ", " – ", " - ", ": ", "; "]) {
    const vt = phan.lastIndexOf(dau);
    if (vt >= 60) return phan.slice(0, vt).replace(/[ ,;:\-–]+$/, "") + "…";
  }
  const vt = phan.lastIndexOf(" ");
  if (vt > 0) phan = phan.slice(0, vt);
  return phan.replace(/[ ,;:\-–.]+$/, "") + "…";
}

export const tachCau = (s) => (s || "").split(/(?<=[.!?…])\s+/).map((c) => c.trim()).filter((c) => c.length > 1);

export function tomTatDonGian(tieuDe, moTa, noiDung) {
  const ungVien = [];
  const moTaTot = doDai(moTa) >= 60; // sapo đủ dài thường là câu giới thiệu hay nhất
  tachCau(moTa).slice(0, 3).forEach((c, i) => ungVien.push([c, (moTaTot ? 3 : 0.3) - i]));
  (noiDung || "").split("\n\n").slice(0, 8).forEach((d, i) =>
    tachCau(d).slice(0, 3).forEach((c, j) => ungVien.push([c, 2 / (1 + i + j)])));
  if (!ungVien.length) return rutGon(tieuDe || "");

  const tanSuat = new Map();
  for (const w of tu(`${tieuDe} ${noiDung}`)) if (!TU_DUNG.has(w) && w.length > 1) tanSuat.set(w, (tanSuat.get(w) || 0) + 1);
  const dinh = Math.max(1, ...tanSuat.values());
  const tuTieuDe = new Set(tu(tieuDe).filter((w) => !TU_DUNG.has(w)));
  const diem = ([c, uuTien]) => {
    const w = tu(c).filter((x) => !TU_DUNG.has(x));
    if (!w.length) return -1;
    let s = w.reduce((a, x) => a + (tanSuat.get(x) || 0) / dinh, 0) / w.length;
    s += (0.5 * w.filter((x) => tuTieuDe.has(x)).length) / Math.max(1, tuTieuDe.size);
    return s + uuTien;
  };
  const xep = ungVien.map((x) => [x[0], diem(x)]).sort((a, b) => b[1] - a[1]);
  for (const [c] of xep) if (doDai(c) >= 40 && doDai(c) <= GIOI_HAN_TOM_TAT) return chuanHoa(c);
  return rutGon(xep[0][0]);
}
