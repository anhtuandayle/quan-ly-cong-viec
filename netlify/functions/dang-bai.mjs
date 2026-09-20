// Bộ điều phối của ứng dụng "Đăng bài đa kênh" trên Netlify: mọi đường dẫn /api/dang-bai/...
import { randomUUID } from "node:crypto";
import { LoiAI, aiDangDung, taoBaiAI, taoCongThucAI } from "../dang-bai/tri-tue.mjs";
import { GIOI_HAN_BAI, catTheoCau, dongCuoi, ghepBai, nganSach, taoBaiDonGian } from "../dang-bai/bai-dang.mjs";
import { GIOI_HAN_TOM_TAT, LoiNguoiDung, chuanHoa, doDai, tomTatDonGian, trichXuat } from "../dang-bai/trich-xuat.mjs";
import { dien, guiAnToan } from "../dang-bai/phan-phoi.mjs";
import { moKho } from "../dang-bai/kho.mjs";
import {
  TEN_COOKIE, bamMatKhau, dungMaKichHoat, dungMatKhau, phienHopLe, taoBiMatPhien, taoPhien,
} from "../dang-bai/bao-mat.mjs";

const traJson = (duLieu, ma = 200, them = {}) =>
  new Response(JSON.stringify(duLieu), {
    status: ma,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...them },
  });
const loi = (thongBao, ma = 400) => traJson({ loi: thongBao }, ma);
const ngu = (ms) => new Promise((r) => setTimeout(r, ms));

function docCookie(req, ten) {
  for (const phan of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = phan.trim().split("=");
    if (k === ten) return v.join("=");
  }
  return "";
}
const cookiePhien = (giaTri, thoiHan) =>
  `${TEN_COOKIE}=${giaTri}; Path=/api/dang-bai; HttpOnly; Secure; SameSite=Strict; Max-Age=${thoiHan}`;

// ---------------------------------------------------------------- công thức

const khongDau = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");

async function thuVienCongThuc(goc) {
  try {
    const r = await fetch(`${goc}/dang-bai/cong-thuc-mau.json`, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

async function timCongThucMau(goc, ten) {
  const canTim = khongDau(ten);
  for (const ct of await thuVienCongThuc(goc)) {
    if ([ct.ten, ...(ct.ten_khac || [])].some((x) => khongDau(x) === canTim)) {
      return { ...structuredClone(ct), nguon: "Công thức có sẵn trong thư viện mẫu (dang-bai/cong-thuc-mau.json)" };
    }
  }
  return null;
}

async function congThucWebhook(goc, ten, lyDo) {
  const ct = await timCongThucMau(goc, "webhook");
  return ct && { ...ct, ten, nguon: "Kết nối qua Webhook", ly_do: lyDo };
}

function kiemTraCongThuc(ct) {
  if (!ct || typeof ct !== "object" || typeof ct.gui !== "object") throw new LoiNguoiDung("Công thức kết nối thiếu phần 'gui'.");
  if (!ct.gui.dia_chi) throw new LoiNguoiDung("Công thức kết nối thiếu địa chỉ gửi bài.");
  if (!["json", "form", "multipart"].includes(ct.gui.kieu_than || "json")) throw new LoiNguoiDung("kieu_than phải là json, form hoặc multipart.");
  if (ct.gui.than && (typeof ct.gui.than !== "object" || Array.isArray(ct.gui.than))) throw new LoiNguoiDung("Phần 'than' phải là một đối tượng JSON.");
  for (const t of ct.truong || []) if (!/^[A-Za-z0-9_]+$/.test(t.khoa || "")) throw new LoiNguoiDung(`Tên trường không hợp lệ: ${t.khoa}`);
  const buoc = ct.buoc_truoc || [];
  if (!Array.isArray(buoc) || buoc.some((b) => !b || typeof b !== "object" || !b.dia_chi)) {
    throw new LoiNguoiDung("Phần 'buoc_truoc' phải là danh sách các yêu cầu, mỗi yêu cầu có 'dia_chi'.");
  }
}

const che = (v) => (v.length > 8 ? "••••" + v.slice(-4) : "••••");
function ketNoiCongKhai(kn) {
  const ct = kn.cong_thuc;
  let mayChu = "(địa chỉ bạn nhập)";
  try { mayChu = new URL(dien(ct.gui.dia_chi, { truong: kn.gia_tri }, true)[0]).host || mayChu; } catch {}
  return {
    id: kn.id, ten: kn.ten, bat: kn.bat, may_chu: mayChu, nguon: ct.nguon || "",
    truong: (ct.truong || []).map((t) => {
      const v = kn.gia_tri[t.khoa] || "";
      return { nhan: t.nhan, gia_tri: t.bi_mat && v ? che(v) : v };
    }),
  };
}

// ---------------------------------------------------------------- xử lý

export default async (req) => {
  const url = new URL(req.url);
  const duong = url.pathname.replace(/^\/api\/dang-bai/, "") || "/";
  const pt = req.method;
  const kho = moKho();

  // Chặn trang web lạ ra lệnh ngầm: mọi lệnh thay đổi phải kèm dấu hiệu của chính ứng dụng
  if (pt !== "GET" && req.headers.get("x-ung-dung") !== "dang-bai") return loi("Không được phép", 403);

  try {
    const caiDat = (await kho.doc("cai-dat")) || {};
    const daThietLap = !!caiDat.mat_khau;
    const daDangNhap = daThietLap && phienHopLe(docCookie(req, TEN_COOKIE), caiDat.bi_mat_phien);
    const dl = pt === "POST" ? await req.json().catch(() => ({})) : {};

    if (duong === "/trang-thai") {
      return traJson({
        da_thiet_lap: daThietLap, da_dang_nhap: daDangNhap, gioi_han: GIOI_HAN_TOM_TAT,
        ai: daDangNhap ? aiDangDung(caiDat) : "",
        co_gemini: daDangNhap && !!caiDat.chia_khoa_gemini, co_claude: daDangNhap && !!caiDat.chia_khoa_claude,
      });
    }

    // Đặt mật khẩu lần đầu, hoặc đặt lại khi quên — đều cần mã kích hoạt
    if (duong === "/thiet-lap" && pt === "POST") {
      if (!dungMaKichHoat(dl.ma_kich_hoat)) { await ngu(1500); return loi("Mã kích hoạt không đúng."); }
      if (String(dl.mat_khau || "").length < 8) return loi("Mật khẩu cần ít nhất 8 ký tự.");
      caiDat.mat_khau = await bamMatKhau(dl.mat_khau);
      caiDat.bi_mat_phien = taoBiMatPhien(); // đăng xuất mọi thiết bị cũ
      await kho.ghi("cai-dat", caiDat);
      await kho.xoa("dang-nhap-sai");
      const p = taoPhien(caiDat.bi_mat_phien);
      return traJson({ ok: true }, 200, { "Set-Cookie": cookiePhien(p.giaTri, p.thoiHan) });
    }

    if (duong === "/dang-nhap" && pt === "POST") {
      if (!daThietLap) return loi("Ứng dụng chưa được đặt mật khẩu.");
      const sai = (await kho.doc("dang-nhap-sai")) || { dem: 0, tu: 0 };
      if (sai.dem >= 10 && Date.now() - sai.tu < 15 * 60_000) return loi("Nhập sai quá nhiều lần. Đợi 15 phút rồi thử lại.", 429);
      if (!(await dungMatKhau(dl.mat_khau, caiDat.mat_khau))) {
        const moi = Date.now() - sai.tu > 15 * 60_000 ? { dem: 1, tu: Date.now() } : { dem: sai.dem + 1, tu: sai.tu };
        await kho.ghi("dang-nhap-sai", moi);
        await ngu(1500);
        return loi("Mật khẩu không đúng.");
      }
      await kho.xoa("dang-nhap-sai");
      const p = taoPhien(caiDat.bi_mat_phien);
      return traJson({ ok: true }, 200, { "Set-Cookie": cookiePhien(p.giaTri, p.thoiHan) });
    }

    if (duong === "/dang-xuat" && pt === "POST") {
      return traJson({ ok: true }, 200, { "Set-Cookie": cookiePhien("", 0) });
    }

    // ---- Từ đây trở xuống bắt buộc đã đăng nhập
    if (!daDangNhap) return loi("Cần đăng nhập.", 401);
    const goc = url.origin;
    let m;

    // Danh sách nền tảng có công thức sẵn, để trang hiện các nút bấm nhanh
    if (duong === "/danh-sach-nen-tang" && pt === "GET") {
      const ds = (await thuVienCongThuc(goc)).map((ct) => ({ ten: ct.ten, thu_tu: ct.thu_tu ?? 99, co_lay_ma: !!ct.lay_ma }));
      ds.sort((a, b) => a.thu_tu - b.thu_tu || a.ten.localeCompare(b.ten));
      return traJson(ds);
    }

    if (duong === "/ket-noi" && pt === "GET") {
      return traJson(((await kho.doc("ket-noi")) || []).map(ketNoiCongKhai));
    }

    if (duong === "/trich-xuat" && pt === "POST") {
      const batDau = Date.now();
      const bai = await trichXuat(String(dl.url || ""), String(dl.noi_dung_dan || "").trim() || undefined);
      const link = bai.link_goc;
      let nguon = "Tự động (trích câu chính)", canhBao = "", kqAI = null;
      const ai = aiDangDung(caiDat);
      if (ai) {
        try {
          kqAI = await taoBaiAI(caiDat, bai.tieu_de, bai.noi_dung || bai.mo_ta, link, batDau + 55_000);
          nguon = `AI ${ai}`;
        } catch (e) { canhBao = `AI chưa viết được (${e.message}), đã dùng cách tự động.`; }
      }
      const tuDong = kqAI ? null : taoBaiDonGian(bai.tieu_de, bai.mo_ta, bai.noi_dung, link);
      return traJson({
        ...bai,
        tom_tat: kqAI ? kqAI.tom_tat : tomTatDonGian(bai.tieu_de, bai.mo_ta, bai.noi_dung),
        bai_ngan: kqAI ? kqAI.ngan : tuDong.ngan,
        bai_dai: kqAI ? kqAI.dai : tuDong.dai,
        dong_cuoi: dongCuoi(link), gioi_han_bai: GIOI_HAN_BAI,
        nguon_tom_tat: nguon, canh_bao: canhBao, so_chu: bai.noi_dung.split(/\s+/).filter(Boolean).length,
      });
    }

    if (duong === "/bieu-mau" && pt === "POST") {
      const ten = chuanHoa(dl.ten);
      if (!ten) return loi("Anh/chị hãy gõ tên nền tảng.");
      const mau = await timCongThucMau(goc, ten);
      if (mau) return traJson(mau);
      if (aiDangDung(caiDat)) {
        const kq = await taoCongThucAI(caiDat, ten, Date.now() + 55_000);
        return traJson(kq.khong_the ? await congThucWebhook(goc, ten, kq.khong_the) : kq);
      }
      return traJson(await congThucWebhook(goc, ten,
        `Hệ thống chưa biết cách nói chuyện trực tiếp với ${ten}. Bật AI trong Cài đặt để hệ thống tự tìm cách, ` +
        `hoặc dùng Webhook (qua Make.com/Zapier) — cách này nối được với mọi nền tảng.`));
    }

    if (duong === "/ket-noi" && pt === "POST") {
      const ct = dl.cong_thuc;
      kiemTraCongThuc(ct);
      delete ct.ly_do;
      const giaTri = Object.fromEntries(Object.entries(dl.gia_tri || {}).map(([k, v]) => [k, String(v).trim()]));
      const thieu = (ct.truong || []).filter((t) => t.bat_buoc !== false && !giaTri[t.khoa]).map((t) => t.nhan);
      if (thieu.length) return loi("Còn thiếu: " + thieu.join(", "));
      const kn = { id: randomUUID().slice(0, 10), ten: chuanHoa(dl.ten || ct.ten || "Nền tảng"), bat: true, cong_thuc: ct, gia_tri: giaTri };
      const ds = (await kho.doc("ket-noi")) || [];
      ds.push(kn);
      await kho.ghi("ket-noi", ds);
      return traJson(ketNoiCongKhai(kn));
    }

    if ((m = duong.match(/^\/ket-noi\/([\w-]+)\/bat-tat$/)) && pt === "POST") {
      const ds = (await kho.doc("ket-noi")) || [];
      for (const kn of ds) if (kn.id === m[1]) kn.bat = !!dl.bat;
      await kho.ghi("ket-noi", ds);
      return traJson({ ok: true });
    }

    if ((m = duong.match(/^\/ket-noi\/([\w-]+)$/)) && pt === "DELETE") {
      await kho.ghi("ket-noi", ((await kho.doc("ket-noi")) || []).filter((kn) => kn.id !== m[1]));
      return traJson({ ok: true });
    }

    if (duong === "/dang-bai" && pt === "POST") {
      const bai = {
        tieu_de: chuanHoa(dl.tieu_de), tom_tat: chuanHoa(dl.tom_tat),
        link_goc: String(dl.link_goc || "").trim(), anh_url: String(dl.anh_url || "").trim(),
        anh_tai_len: dl.anh_tai_len || null,
      };
      if (!bai.tieu_de) return loi("Bài chưa có tiêu đề.");
      if (!bai.tom_tat) return loi("Bài chưa có đoạn tóm tắt.");
      if (doDai(bai.tom_tat) > GIOI_HAN_TOM_TAT) return loi(`Đoạn tóm tắt đang dài ${doDai(bai.tom_tat)} ký tự — phải dưới 140.`);
      if (!/^https?:\/\//.test(bai.link_goc)) return loi("Thiếu đường dẫn bài gốc.");
      const loai = GIOI_HAN_BAI[dl.loai_bai] ? dl.loai_bai : "ngan";
      const than = String(dl.than_bai || "").replace(/\r/g, "").normalize("NFC").trim();
      if (!than) return loi("Bài đăng chưa có nội dung.");
      bai.noi_dung = ghepBai(than, bai.link_goc);
      if (doDai(bai.noi_dung) > GIOI_HAN_BAI[loai]) {
        return loi(`Bài ${loai === "ngan" ? "ngắn" : "dài"} đang ${doDai(bai.noi_dung)} ký tự — tối đa ${GIOI_HAN_BAI[loai]}.`);
      }
      // cả 2 bản đều gửi kèm, cho nền tảng giới hạn chữ (vd Mastodon, Pinterest 500 ký tự) luôn dùng bản ngắn
      for (const l of Object.keys(GIOI_HAN_BAI)) {
        const t = String(dl[`than_${l}`] || "").replace(/\r/g, "").normalize("NFC").trim() || than;
        bai[`bai_${l}`] = ghepBai(catTheoCau(t, nganSach(l, bai.link_goc)), bai.link_goc);
      }
      const dangBat = ((await kho.doc("ket-noi")) || []).filter((kn) => kn.bat);
      if (!dangBat.length) return loi("Chưa bật nền tảng nào để đăng.");
      return traJson({ ket_qua: await Promise.all(dangBat.map((kn) => guiAnToan(kn, bai))) });
    }

    // Đổi "mã cho phép" (code) nền tảng trả về sau khi bấm Approve thành mã kết nối lâu dài
    if (duong === "/doi-ma-oauth" && pt === "POST") {
      const diaChi = String(dl.dia_chi || "").trim();
      if (!(diaChi.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(diaChi))) return loi("Địa chỉ đổi mã không hợp lệ (phải là https).");
      let r, kq;
      try {
        r = await fetch(diaChi, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "DangBaiDaKenh/1.0" },
          body: new URLSearchParams({
            client_id: String(dl.client_id || "").trim(), client_secret: String(dl.client_secret || "").trim(),
            code: String(dl.ma || "").trim(), redirect_uri: String(dl.quay_ve || "").trim(),
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(30000),
        });
        kq = await r.json().catch(() => ({}));
      } catch { return loi("Không kết nối được tới nền tảng."); }
      if (!r.ok) return loi(`Nền tảng không cấp mã kết nối (${r.status}). ${kq.error_description || kq.error || ""}`);
      if (!kq.access_token && !kq.refresh_token) return loi("Nền tảng không trả về mã kết nối.");
      return traJson({ ket_qua: kq, ma_truy_cap: kq.access_token || "" });
    }

    if (duong === "/cai-dat" && pt === "POST") {
      for (const [loai, dau, ten] of [["gemini", "AIza", "Gemini"], ["claude", "sk-ant-", "Claude"]]) {
        if (!(`chia_khoa_${loai}` in dl)) continue;
        const khoa = String(dl[`chia_khoa_${loai}`] || "").trim();
        if (khoa && !khoa.startsWith(dau)) return loi(`Chìa khoá ${ten} thường bắt đầu bằng ${dau}… Anh/chị kiểm tra lại nhé.`);
        caiDat[`chia_khoa_${loai}`] = khoa;
      }
      await kho.ghi("cai-dat", caiDat);
      return traJson({ ai: aiDangDung(caiDat) });
    }

    return loi("Không có chức năng này", 404);
  } catch (e) {
    if (e instanceof LoiNguoiDung) return loi(e.message);
    if (e instanceof LoiAI) return loi(e.message, 502);
    console.error(e);
    return loi(`Lỗi bất ngờ: ${e.message}`, 500);
  }
};

export const config = { path: "/api/dang-bai/*" };
