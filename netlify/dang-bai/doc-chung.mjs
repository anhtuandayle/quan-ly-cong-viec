// Đọc MỌI loại trang bằng quy tắc (không dùng AI):
// - Bài viết: kho dữ liệu WordPress (/wp-json) → khối nội dung chính theo mật độ chữ (giữ H2/H3, gạch đầu dòng, bảng) → bản AMP.
// - Danh sách bài của 1 danh mục/blog: WordPress theo danh mục → RSS/Atom → sitemap → gom link bài trên trang + tự sang trang 2, 3…
import * as cheerio from "cheerio";
import { TRINH_DUYET, chuanHoa } from "./trich-xuat.mjs";

const TOI_DA_BAI = 300;
const TOI_DA_TRANG = 8;
const TOI_DA_TRANG_HTML = 5; // gom link trên trang danh mục: tối đa 5 trang
const NGAN_SACH_MS = 22_000; // 1 lượt lấy danh sách không quá ~22 giây (giới hạn thời gian chạy của máy chủ)
let hetGio = Infinity;
const conGio = (ms = 3000) => Date.now() + ms < hetGio;

async function tai(url, loai = "text/html,application/xhtml+xml", giay = 20) {
  const r = await fetch(url, {
    headers: { "User-Agent": TRINH_DUYET, Accept: loai, "Accept-Language": "vi,en;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(giay * 1000),
  });
  if (!r.ok) throw new Error(`mã ${r.status}`);
  return { text: await r.text(), url: r.url || url, type: r.headers.get("content-type") || "" };
}
const taiJson = async (url) => JSON.parse((await tai(url, "application/json")).text);
const tuyetDoi = (u, goc) => { try { return new URL(u, goc).href.split("#")[0]; } catch { return ""; } };
const cungTrang = (a, b) => { try { return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, ""); } catch { return false; } };
const boTheHtml = (s) => chuanHoa(cheerio.load(`<div>${s || ""}</div>`)("div").text());

// ---------------------------------------------------------------- nội dung bài: chữ có cấu trúc

const RAC = "script, style, noscript, nav, footer, aside, form, svg, iframe, button, select, template, header, .share, .social, .related, .comment, .comments, .breadcrumb, .menu, .sidebar, .widget, .tags, .author-box, #comments";

/** Từ 1 khối HTML: lấy H2/H3/H4 (đánh dấu "## "), đoạn văn, gạch đầu dòng ("• "), dòng bảng — đúng thứ tự trong bài. */
export function chuTuKhoi($, khoi) {
  const out = [];
  const daCo = new Set();
  $(khoi).find("h2, h3, h4, p, li, td, th, blockquote, figcaption, div").each((_, el) => {
    const ten = el.tagName?.toLowerCase();
    // div chỉ lấy khi là khối chữ "lá" (không chứa khối con có chữ) — trang để chữ trong div thay vì p
    if (ten === "div" && $(el).children("p, div, ul, ol, table, h2, h3, h4, section, article").length) return;
    if ((ten === "td" || ten === "th") && $(el).closest("tr").index() > 40) return;
    if (ten === "li" && $(el).find("p").length) return;
    if (ten === "p" && $(el).closest("li, td, th, blockquote").length) return;
    let t = chuanHoa($(el).text()).replace(/\[\d+\]/g, "");
    if (!t || daCo.has(t)) return;
    if (/^h[2-4]$/.test(ten)) { if (t.length <= 200) { out.push(`## ${t}`); daCo.add(t); } return; }
    if (ten === "li") { if (t.length >= 3) { out.push(`• ${t}`); daCo.add(t); } return; }
    if (ten === "td" || ten === "th") return; // bảng xử lý theo dòng bên dưới
    if (t.length < 25 && ten !== "figcaption") return;
    out.push(t);
    daCo.add(t);
  });
  $(khoi).find("table tr").slice(0, 40).each((_, tr) => {
    const o = $(tr).find("td, th").toArray().map((c) => chuanHoa($(c).text())).filter(Boolean);
    if (o.length >= 2) out.push(o.join(" | "));
  });
  return out.join("\n\n");
}

/** Tìm khối nội dung chính: khối có nhiều chữ trong đoạn văn nhất, ít link nhất (giống chế độ đọc của trình duyệt). */
export function khoiChinh($) {
  $(RAC).remove();
  const uuTien = $("article .entry-content, article .post-content, .entry-content, .post-content, .article-content, .detail-content, .news-content, .content-detail, [itemprop=articleBody], article, main").toArray();
  let tot = null, diem = 0;
  const cham = (el) => {
    const chu = $(el).find("p, li, h2, h3").text().length + $(el).clone().children().remove().end().text().trim().length;
    const chuLink = $(el).find("a").text().length;
    return chu - chuLink * 1.5 + $(el).find("p").length * 30;
  };
  for (const el of uuTien) { const d = cham(el); if (d > diem) { diem = d; tot = el; } }
  if (!tot || diem < 600) {
    $("div, section").each((_, el) => { const d = cham(el); if (d > diem) { diem = d; tot = el; } });
  }
  return tot;
}

// ---------------------------------------------------------------- bài viết

/** Trang WordPress: đọc thẳng bài từ kho dữ liệu /wp-json (đủ nội dung, kể cả trang dựng bằng JavaScript). */
export async function docBaiWordPress(url, html) {
  const goc = (html?.match(/<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*href=["']([^"']+)["']/i) || [])[1]
    || (html && /wp-content|wp-includes/.test(html) ? new URL("/wp-json/", url).href : "");
  if (!goc) return null;
  const slug = decodeURIComponent(new URL(url).pathname.replace(/\/+$/, "").split("/").pop() || "").replace(/\.html?$/, "");
  if (!slug) return null;
  for (const loai of ["posts", "pages"]) {
    try {
      const ds = await taiJson(`${goc.replace(/\/?$/, "/")}wp/v2/${loai}?slug=${encodeURIComponent(slug)}&_embed=1`);
      const b = Array.isArray(ds) && ds[0];
      if (!b?.content?.rendered) continue;
      const $ = cheerio.load(`<div id="noi-dung">${b.content.rendered}</div>`);
      return {
        tieu_de: boTheHtml(b.title?.rendered),
        mo_ta: boTheHtml(b.excerpt?.rendered),
        noi_dung: chuTuKhoi($, $("#noi-dung")),
        anh_url: b._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "",
      };
    } catch {}
  }
  return null;
}

/** Bản AMP (nếu trang có) thường gọn và đủ chữ. */
export async function docBaiAmp(html, url) {
  const amp = (html.match(/<link[^>]+rel=["']amphtml["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']amphtml["']/i) || [])[1];
  if (!amp) return "";
  try {
    const t = await tai(tuyetDoi(amp, url));
    const $ = cheerio.load(t.text);
    const k = khoiChinh($);
    return k ? chuTuKhoi($, k) : "";
  } catch { return ""; }
}

// ---------------------------------------------------------------- danh sách bài của danh mục / blog

const LINK_RAC = /\/(tag|tags|author|search|wp-login|wp-admin|cart|gio-hang|lien-he|contact|gioi-thieu|about|page|trang)\/?$|\/(tag|author|category|danh-muc|chuyen-muc)\/[^/]+\/?$|\.(jpg|jpeg|png|gif|webp|pdf|zip)(\?|$)|[?&](replytocom|share)=|#/i;

/** Link trông giống 1 bài viết: cùng trang, đường dẫn có slug đủ dài (≥ 2 gạch ngang) hoặc có .html/số id. */
function giongBai(link, goc) {
  if (!cungTrang(link, goc) || LINK_RAC.test(link)) return false;
  const p = new URL(link).pathname.replace(/\/+$/, "");
  if (!p || p === new URL(goc).pathname.replace(/\/+$/, "")) return false;
  const cuoi = p.split("/").pop() || "";
  return (cuoi.match(/-/g) || []).length >= 2 || /\.html?$/.test(cuoi) || /-\d{3,}$/.test(cuoi) || /\/\d{4}\/\d{2}\//.test(p);
}

async function quaWordPress(url, html) {
  const goc = (html.match(/<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*href=["']([^"']+)["']/i) || [])[1]
    || (/wp-content|wp-includes/.test(html) ? new URL("/wp-json/", url).href : "");
  if (!goc) return null;
  const api = goc.replace(/\/?$/, "/") + "wp/v2/";
  const phan = new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  let loc = "", ten = "";
  const cuoi = decodeURIComponent(phan[phan.length - 1] || "");
  if (cuoi && !/^(blog|tin-tuc|news|bai-viet|posts?)$/i.test(cuoi)) {
    try {
      const dm = await taiJson(`${api}categories?slug=${encodeURIComponent(cuoi)}`);
      if (Array.isArray(dm) && dm[0]) { loc = `&categories=${dm[0].id}`; ten = boTheHtml(dm[0].name); }
    } catch {}
    if (!loc && phan.length) {
      // trang danh mục nhưng không có danh mục WordPress cùng tên → không đoán bừa
      try { const t = await taiJson(`${api}tags?slug=${encodeURIComponent(cuoi)}`); if (Array.isArray(t) && t[0]) { loc = `&tags=${t[0].id}`; ten = boTheHtml(t[0].name); } } catch {}
      if (!loc) return null;
    }
  }
  const bai = [];
  for (let trang = 1; trang <= TOI_DA_TRANG && bai.length < TOI_DA_BAI && (trang === 1 || conGio()); trang++) {
    let ds;
    try { ds = await taiJson(`${api}posts?per_page=100&page=${trang}&_fields=link,title${loc}`); } catch { break; }
    if (!Array.isArray(ds) || !ds.length) break;
    for (const b of ds) if (b.link) bai.push({ tieu_de: boTheHtml(b.title?.rendered) || b.link, link: b.link });
    if (ds.length < 100) break;
  }
  return bai.length ? { bai, cach_doc: `Đọc từ kho dữ liệu WordPress${ten ? ` (danh mục “${ten}”)` : ""}`, ten } : null;
}

async function quaRss(url, html) {
  const ung = [...html.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean);
  const thu = [...ung.map((u) => tuyetDoi(u, url)), url.replace(/\/?$/, "/feed/"), url.replace(/\/?$/, "/rss")];
  for (const f of [...new Set(thu)]) {
    try {
      const t = await tai(f, "application/rss+xml,application/atom+xml,application/xml,text/xml");
      if (!/<(rss|feed)[\s>]/i.test(t.text.slice(0, 2000))) continue;
      const $ = cheerio.load(t.text, { xmlMode: true });
      const bai = [];
      $("item, entry").each((_, el) => {
        const link = chuanHoa($(el).find("link").first().text()) || $(el).find("link").first().attr("href") || "";
        const tieuDe = chuanHoa($(el).find("title").first().text());
        if (link && cungTrang(link, url)) bai.push({ tieu_de: tieuDe || link, link });
      });
      if (bai.length >= 3) return { bai, cach_doc: "Đọc từ RSS của trang (thường chỉ gồm các bài mới nhất)" };
    } catch {}
  }
  return null;
}

async function quaSitemap(url) {
  const tienTo = new URL(url).pathname.replace(/\/+$/, "");
  if (!tienTo || tienTo === "/") return null; // trang chủ: sitemap quá lớn, bỏ qua
  const goc = new URL(url).origin;
  const hang = [`${goc}/sitemap_index.xml`, `${goc}/sitemap.xml`, `${goc}/post-sitemap.xml`];
  try {
    const robots = (await tai(`${goc}/robots.txt`, "text/plain")).text;
    for (const m of robots.matchAll(/^sitemap:\s*(\S+)/gim)) hang.unshift(m[1]);
  } catch {}
  const daDoc = new Set();
  const links = [];
  while (hang.length && daDoc.size < 12 && links.length < TOI_DA_BAI && conGio()) {
    const sm = hang.shift();
    if (daDoc.has(sm)) continue;
    daDoc.add(sm);
    let xml;
    try { xml = (await tai(sm, "application/xml,text/xml")).text; } catch { continue; }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(xml)) { hang.push(...locs.filter((l) => /post|bai|news|tin|blog|article|page-sitemap|sitemap\d/i.test(l)).slice(0, 10)); continue; }
    for (const l of locs) if (new URL(l).pathname.startsWith(tienTo + "/") && giongBai(l, url)) links.push(l);
  }
  if (links.length < 2) return null;
  const tenTuLink = (l) => decodeURIComponent(new URL(l).pathname.replace(/\/+$/, "").split("/").pop() || "").replace(/\.html?$/, "").replace(/-/g, " ");
  const ds = [...new Set(links)].slice(0, TOI_DA_BAI).map((link) => ({ tieu_de: tenTuLink(link), link }));
  // tiêu đề thật cho 60 bài đầu (đọc phần đầu trang, 10 bài một lượt); bài còn lại tạm lấy theo đường dẫn
  const docTen = async (b) => {
    try {
      const h = (await tai(b.link, undefined, 8)).text.slice(0, 60000);
      const m = h.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || h.match(/<title[^>]*>([^<]+)<\/title>/i);
      const t = m ? boTheHtml(m[1]).split(/\s[|\-–—]\s/)[0] : "";
      if (t.length >= 8) b.tieu_de = t;
    } catch {}
  };
  for (let i = 0; i < Math.min(ds.length, 60) && conGio(9000); i += 10) await Promise.all(ds.slice(i, i + 10).map(docTen));
  return { bai: ds, cach_doc: ds.length > 60 ? "Đọc từ sitemap của trang (60 bài đầu có tiêu đề thật, các bài sau tạm lấy theo đường dẫn)" : "Đọc từ sitemap của trang" };
}

/** Gom link bài trên chính trang danh mục, tự theo nút "trang sau" (rel=next, /page/2/, ?page=2). */
async function quaTrangDanhMuc(url, htmlDau, taiAo) {
  const bai = new Map();
  let trangHienTai = url, html = htmlDau;
  for (let i = 0; i < TOI_DA_TRANG_HTML && html && bai.size < TOI_DA_BAI && (i === 0 || conGio()); i++) {
    const $ = cheerio.load(html);
    // chỉ bỏ đầu trang của WEBSITE (giữ <header> của từng bài — nơi chứa tiêu đề bài)
    $("nav, footer, aside, noscript, script, style, body > header, header.site-header, #masthead, .site-header, .menu, .sidebar, .widget, .breadcrumb").remove();
    $("a[href]").each((_, a) => {
      const link = tuyetDoi($(a).attr("href"), trangHienTai);
      if (!link || bai.has(link) || !giongBai(link, url)) return;
      // tiêu đề: title của link → tiêu đề trong link → chữ của link; link ảnh / "Đọc tiếp" thì lấy tiêu đề gần nhất trong thẻ bài bao quanh
      let tieuDe = chuanHoa($(a).attr("title") || $(a).find("h1,h2,h3,h4").first().text() || $(a).text());
      if (tieuDe.length < 15 || /^(xem thêm|đọc tiếp|chi tiết|read more|continue reading|more)/i.test(tieuDe)) {
        tieuDe = "";
        for (let p = $(a).parent(), lv = 0; p.length && lv < 5 && !tieuDe; p = p.parent(), lv++) tieuDe = chuanHoa(p.find("h1,h2,h3,h4").first().text());
      }
      if (tieuDe.length >= 15 && !/[<>]/.test(tieuDe)) bai.set(link, tieuDe);
    });
    const sau = $('a[rel="next"], link[rel="next"]').attr("href")
      || $("a").filter((_, a) => /^(trang sau|sau|next|›|»|tiếp)$/i.test(chuanHoa($(a).text()))).first().attr("href");
    const ke = sau ? tuyetDoi(sau, trangHienTai) : "";
    if (!ke || ke === trangHienTai) break;
    trangHienTai = ke;
    try { html = (await tai(ke, undefined, 12)).text; } catch { break; }
  }
  if (bai.size < 2 && taiAo && i0(htmlDau) && conGio(12000)) {
    // trang danh mục dựng bằng JavaScript → mở bằng trình duyệt ảo rồi gom lại 1 lần
    try { return quaTrangDanhMuc(url, await taiAo(url), null); } catch {}
  }
  return bai.size >= 2 ? { bai: [...bai].map(([link, tieu_de]) => ({ tieu_de, link })), cach_doc: "Gom link bài trên trang danh mục (tự sang các trang sau)" } : null;
}
const i0 = (h) => (h || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim().length < 3000;

/** Danh sách bài cho mọi loại trang: thử lần lượt, cách nào ra nhiều bài nhất thì dùng. */
export async function danhSachChung(url, taiAo) {
  hetGio = Date.now() + NGAN_SACH_MS;
  const t = await tai(url, undefined, 12);
  const html = t.text;
  const ketQua = [];
  for (const cach of [() => quaWordPress(t.url, html), () => quaTrangDanhMuc(t.url, html, taiAo), () => quaRss(t.url, html), () => quaSitemap(t.url)]) {
    if (ketQua.length && !conGio(4000)) break; // đã có kết quả và sắp hết giờ → trả luôn
    try {
      const r = await cach();
      if (r?.bai?.length) {
        ketQua.push(r);
        if (r.bai.length >= 20 && !/RSS/.test(r.cach_doc)) break; // đủ nhiều rồi, khỏi thử tiếp
      }
    } catch {}
  }
  if (!ketQua.length) return null;
  const tot = ketQua.sort((a, b) => b.bai.length - a.bai.length)[0];
  const $ = cheerio.load(html);
  const tenMuc = tot.ten || chuanHoa($("h1").first().text()) || chuanHoa($("title").first().text()).split(/\s[|\-–—]\s/)[0];
  return { ten_muc: tenMuc || new URL(t.url).pathname, tong_trang: 1, bai: tot.bai.slice(0, TOI_DA_BAI), cach_doc: tot.cach_doc };
}
