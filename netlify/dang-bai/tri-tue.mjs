// Phần AI (tuỳ chọn): viết bài đăng social và tự tìm cách kết nối một nền tảng bất kỳ.
// Hỗ trợ 2 nguồn AI, người dùng dán chìa khoá trong phần Cài đặt:
// - Google Gemini: có gói MIỄN PHÍ (ưu tiên dùng nếu có chìa khoá)
// - Claude (Anthropic): trả phí theo lượt dùng
import Anthropic from "@anthropic-ai/sdk";
import { GIOI_HAN_TOM_TAT, chuanHoa, doDai, rutGon } from "./trich-xuat.mjs";
import { catTheoCau, nganSach } from "./bai-dang.mjs";

const MO_HINH_CLAUDE = "claude-opus-5";
const GEMINI_GOC = process.env.GEMINI_GOC || "https://generativelanguage.googleapis.com";
// Thử lần lượt các mẫu này; nếu đều không khớp thì hỏi Google xem chìa khoá dùng được mẫu nào
const MO_HINH_GEMINI = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-flash"];
const API_REVISION = "2026-05-20"; // cổng interactions yêu cầu ghi rõ đời API

export class LoiAI extends Error {}

export const aiDangDung = (caiDat) => (caiDat.chia_khoa_gemini ? "Gemini (miễn phí)" : caiDat.chia_khoa_claude ? "Claude" : "");

// ---------------------------------------------------------------- gọi AI

// Đổi khuôn JSON Schema sang dạng Gemini hiểu (kiểu viết HOA, không có additionalProperties)
function schemaGemini(s) {
  const kq = { type: s.type.toUpperCase() };
  if (s.enum) kq.enum = s.enum;
  if (s.properties) {
    kq.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, schemaGemini(v)]));
    kq.required = s.required || Object.keys(s.properties);
  }
  if (s.items) kq.items = schemaGemini(s.items);
  return kq;
}

// Gửi 1 yêu cầu tới Gemini. Trả về { kq, ma, thongBao }
async function guiGemini(chiaKhoa, duong, than, phuongThuc = "POST", hanChot = Date.now() + 50_000) {
  let r;
  try {
    r = await fetch(GEMINI_GOC + duong, {
      method: phuongThuc,
      headers: { "Content-Type": "application/json", "x-goog-api-key": chiaKhoa, "Api-Revision": API_REVISION },
      body: than == null ? undefined : JSON.stringify(than),
      signal: AbortSignal.timeout(Math.max(5000, hanChot - Date.now())),
    });
  } catch (e) {
    throw new LoiAI(e.name === "TimeoutError" ? "Gemini trả lời quá lâu, thử lại lần nữa nhé." : "Không kết nối được tới Gemini.");
  }
  let kq = await r.json().catch(() => ({}));
  if (Array.isArray(kq)) kq = kq[0] || {};
  if (!r.ok) return { kq: null, ma: r.status, thongBao: kq.error?.message || "" };
  return { kq, ma: 0, thongBao: "" };
}

// Lấy phần chữ trong câu trả lời của cổng interactions
function chuTuInteractions(kq) {
  if (kq.output_text) return kq.output_text;
  const chu = [];
  for (const buoc of kq.steps || []) {
    if (buoc.type == null || buoc.type === "model_output") {
      for (const phan of buoc.content || []) if (phan.type === "text" && phan.text) chu.push(phan.text);
    }
  }
  return chu.join("");
}

// Lấy phần chữ trong câu trả lời của cổng cũ generateContent
const chuTuGenerate = (kq) => (kq.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");

// Thử 1 mẫu AI: cổng mới trước, chìa khoá cũ thì lùi về cổng cũ. Trả về { kq, bao }
async function thuMotMoHinh(chiaKhoa, moHinh, loiNhac, schema, hanChot) {
  let { kq, ma, thongBao } = await guiGemini(chiaKhoa, "/v1beta/interactions", {
    model: moHinh,
    input: loiNhac,
    response_format: { type: "text", mime_type: "application/json", schema: schemaGemini(schema) },
  }, "POST", hanChot);
  if (kq === null && (ma === 400 || ma === 404)) { // cổng mới không nhận → thử cổng cũ
    const cu = await guiGemini(chiaKhoa, `/v1beta/models/${moHinh}:generateContent`, {
      contents: [{ role: "user", parts: [{ text: loiNhac }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schemaGemini(schema) },
    }, "POST", hanChot);
    if (cu.kq !== null) {
      const vanBan = chuTuGenerate(cu.kq);
      if (!vanBan.trim()) return { kq: null, bao: `mẫu ${moHinh}: Gemini trả lời trống.` };
      try { return { kq: JSON.parse(vanBan), bao: "" }; }
      catch { return { kq: null, bao: `mẫu ${moHinh}: Gemini trả lời sai định dạng.` }; }
    }
    ma = cu.ma || ma;
    thongBao = cu.thongBao || thongBao;
  }
  if (kq === null) {
    if (ma === 401 || (ma === 400 && /api key/i.test(thongBao))) throw new LoiAI("Chìa khoá Gemini không đúng. Vào Cài đặt để dán lại.");
    if (ma === 403) throw new LoiAI("Chìa khoá Gemini không có quyền (hãy tạo chìa khoá mới trong Google AI Studio).");
    if (ma === 429) throw new LoiAI("Đã hết lượt Gemini miễn phí (theo phút hoặc theo ngày). Đợi một lúc rồi thử lại.");
    return { kq: null, bao: `mẫu ${moHinh}: lỗi ${ma}${thongBao ? " — " + thongBao.slice(0, 120) : ""}` };
  }
  if (kq.status === "failed" || kq.status === "cancelled") return { kq: null, bao: `mẫu ${moHinh}: Gemini bỏ dở câu trả lời.` };
  const vanBan = chuTuInteractions(kq);
  if (!vanBan.trim()) return { kq: null, bao: `mẫu ${moHinh}: Gemini trả lời trống.` };
  try { return { kq: JSON.parse(vanBan), bao: "" }; }
  catch { return { kq: null, bao: `mẫu ${moHinh}: Gemini trả lời sai định dạng.` }; }
}

// Hỏi Google xem chìa khoá này dùng được những mẫu nào (ưu tiên các mẫu Flash)
async function moHinhCuaChiaKhoa(chiaKhoa, hanChot) {
  const { kq } = await guiGemini(chiaKhoa, "/v1beta/models?pageSize=200", null, "GET", hanChot);
  const ten = (kq?.models || []).map((m) => String(m.name || "").split("/").pop());
  const flash = ten.filter((t) => t.includes("flash") && !/embed|image|tts/.test(t));
  flash.sort((a, b) => (a.includes("lite") - b.includes("lite")) || (a.includes("preview") - b.includes("preview")) || a.localeCompare(b));
  return flash.length ? flash : ten;
}

async function goiGemini(chiaKhoa, loiNhac, schema, hanChot) {
  const daThu = [], loi = [];
  for (let vong = 0; vong < 2; vong++) {
    const danhSach = vong === 0 ? MO_HINH_GEMINI
      : (await moHinhCuaChiaKhoa(chiaKhoa, hanChot)).filter((t) => !daThu.includes(t)).slice(0, 3);
    if (!danhSach.length) break;
    for (const moHinh of danhSach) {
      if (hanChot - Date.now() < 5000) break;
      daThu.push(moHinh);
      const { kq, bao } = await thuMotMoHinh(chiaKhoa, moHinh, loiNhac, schema, hanChot);
      if (kq !== null) return kq;
      loi.push(bao);
    }
  }
  throw new LoiAI("Gemini chưa trả lời được. " + loi.filter(Boolean).join("; ").slice(0, 300));
}

async function goiClaude(chiaKhoa, loiNhac, schema, effort, hanChot) {
  const may = new Anthropic({ apiKey: chiaKhoa, timeout: Math.max(5000, hanChot - Date.now()), maxRetries: 0 }); // Netlify cho tối đa 60 giây
  let r;
  try {
    r = await may.beta.messages.create({
      model: MO_HINH_CLAUDE,
      max_tokens: 16000,
      // Nếu mô hình chính từ chối, máy chủ Claude tự chuyển sang mô hình dự phòng phù hợp.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: loiNhac }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new LoiAI("Chìa khoá Claude không đúng hoặc đã bị thu hồi. Vào Cài đặt để dán lại.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new LoiAI("Chìa khoá Claude không có quyền dùng mô hình này.");
    if (e instanceof Anthropic.RateLimitError) throw new LoiAI("Claude đang quá tải hoặc tài khoản hết hạn mức. Thử lại sau ít phút.");
    if (e instanceof Anthropic.BadRequestError) {
      throw new LoiAI(/credit/i.test(e.message) ? "Tài khoản Claude đã hết tiền nạp (credit)." : `Claude từ chối yêu cầu: ${e.message}`);
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new LoiAI("Claude trả lời quá lâu, thử lại lần nữa nhé.");
    if (e instanceof Anthropic.APIConnectionError) throw new LoiAI("Không kết nối được tới Claude.");
    if (e instanceof Anthropic.APIError) throw new LoiAI(`Claude báo lỗi ${e.status}.`);
    throw e;
  }
  if (r.stop_reason === "refusal") throw new LoiAI("Claude không trả lời yêu cầu này.");
  const vanBan = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(vanBan); } catch { throw new LoiAI("Claude trả lời sai định dạng. Thử lại nhé."); }
}

// hanChot = thời điểm (ms) phải xong, để cả lượt xử lý không vượt 60 giây của Netlify
export function goiAI(caiDat, loiNhac, schema, effort, hanChot) {
  if (caiDat.chia_khoa_gemini) return goiGemini(caiDat.chia_khoa_gemini, loiNhac, schema, hanChot);
  if (caiDat.chia_khoa_claude) return goiClaude(caiDat.chia_khoa_claude, loiNhac, schema, effort, hanChot);
  throw new LoiAI("Chưa bật AI.");
}

// ---------------------------------------------------------------- bài đăng social 2 dạng

const chuoi = { type: "string" };
const KHUON_BAI = {
  type: "object",
  properties: { tom_tat: chuoi, bai_ngan: chuoi, bai_dai: chuoi },
  required: ["tom_tat", "bai_ngan", "bai_dai"],
  additionalProperties: false,
};

// Một lần gọi AI: câu tóm tắt < 140 ký tự + bài ngắn + bài dài (chưa gồm dòng link cuối).
export async function taoBaiAI(caiDat, tieuDe, noiDung, link, hanChot) {
  const hanNgan = nganSach("ngan", link), hanDai = nganSach("dai", link);
  const loiNhac = `Bạn là người viết nội dung mạng xã hội cho một thương hiệu. Dựa vào bài viết bên dưới, viết:

1. tom_tat: MỘT câu giới thiệu 80–130 ký tự (tuyệt đối không quá ${GIOI_HAN_TOM_TAT}).
2. bai_ngan: bài đăng ngắn, 1 đoạn, dài ${hanNgan - 120}–${hanNgan - 20} ký tự. Tuyệt đối không quá ${hanNgan} ký tự.
3. bai_dai: bài đăng dài, 2–4 đoạn ngắn (cách nhau 1 dòng trống), có thể liệt kê 2–4 ý chính bằng dấu "–" đầu dòng, dài ${hanDai - 200}–${hanDai - 30} ký tự. Tuyệt đối không quá ${hanDai} ký tự.

Yêu cầu chung:
- Viết cùng ngôn ngữ với bài viết, giọng tự nhiên, câu mở đầu gây tò mò; mô tả ngắn gọn bài viết nói gì và người đọc nhận được gì.
- Chỉ dùng thông tin có trong bài, không bịa số liệu.
- KHÔNG chèn đường dẫn, KHÔNG hashtag, KHÔNG viết câu "tham khảo bài viết tại" (hệ thống tự thêm dòng này ở cuối).
- Số ký tự tính cả dấu cách và xuống dòng.

<tieu_de>${tieuDe}</tieu_de>
<bai_viet>
${noiDung.slice(0, 60000)}
</bai_viet>`;
  const kq = await goiAI(caiDat, loiNhac, KHUON_BAI, "low", hanChot);
  let ngan = String(kq.bai_ngan || "").trim(), dai = String(kq.bai_dai || "").trim();
  if ((doDai(ngan) > hanNgan || doDai(dai) > hanDai) && hanChot - Date.now() > 20_000) {
    try {
      const sua = await goiAI(caiDat, `${loiNhac}

Lần trước bạn viết bài ngắn ${doDai(ngan)} ký tự (giới hạn ${hanNgan}) và bài dài ${doDai(dai)} ký tự (giới hạn ${hanDai}). Hãy viết lại cho đúng giới hạn.`, KHUON_BAI, "low", hanChot);
      ngan = String(sua.bai_ngan || ngan).trim(); dai = String(sua.bai_dai || dai).trim();
    } catch {} // hết giờ thì dùng bản cũ, cắt gọn bên dưới
  }
  if (!ngan || !dai) throw new LoiAI("AI trả về bài trống.");
  // chốt chặn cuối: luôn trong giới hạn
  return { tom_tat: rutGon(chuanHoa(String(kq.tom_tat || ""))), ngan: catTheoCau(ngan, hanNgan), dai: catTheoCau(dai, hanDai) };
}

// ---------------------------------------------------------------- công thức kết nối

const KHUON_CONG_THUC = {
  type: "object",
  properties: {
    co_the_ket_noi: { type: "boolean" },
    ly_do_khong_the: chuoi,
    ten_hien_thi: chuoi,
    huong_dan: chuoi,
    truong: {
      type: "array",
      items: {
        type: "object",
        properties: { khoa: chuoi, nhan: chuoi, bi_mat: { type: "boolean" }, bat_buoc: { type: "boolean" }, goi_y: chuoi },
        required: ["khoa", "nhan", "bi_mat", "bat_buoc", "goi_y"],
        additionalProperties: false,
      },
    },
    phuong_thuc: { type: "string", enum: ["POST", "PUT"] },
    dia_chi: chuoi,
    tieu_de_http: {
      type: "array",
      items: { type: "object", properties: { ten: chuoi, gia_tri: chuoi }, required: ["ten", "gia_tri"], additionalProperties: false },
    },
    kieu_than: { type: "string", enum: ["json", "form", "multipart"] },
    than_json: chuoi,
    thanh_cong_khi: chuoi,
    duong_dan_bai: chuoi,
    thong_bao_loi: chuoi,
  },
  required: ["co_the_ket_noi", "ly_do_khong_the", "ten_hien_thi", "huong_dan", "truong", "phuong_thuc", "dia_chi",
    "tieu_de_http", "kieu_than", "than_json", "thanh_cong_khi", "duong_dan_bai", "thong_bao_loi"],
  additionalProperties: false,
};

const huongDanCongThuc = (ten) => `Bạn thiết kế "công thức kết nối" để một phần mềm tự đăng bài lên nền tảng "${ten}" bằng MỘT yêu cầu HTTP duy nhất tới API chính thức của nền tảng.

Bài đăng gồm: tiêu đề, nội dung bài đăng (tối đa 1000 ký tự, dòng cuối là đường dẫn bài gốc), câu mô tả ngắn, ảnh.

Các biến có thể dùng trong dia_chi, tieu_de_http và than_json (viết đúng dạng {{...}}):
- {{tieu_de}}, {{tom_tat}}, {{link_goc}}
- {{noi_dung}} = bài đăng hoàn chỉnh (300–1000 ký tự), dòng cuối là đường dẫn bài gốc — nên dùng làm phần chữ của bài
- {{bai_ngan}} = bản ngắn (tối đa 500 ký tự) — dùng khi nền tảng giới hạn 500 ký tự
- {{anh_url}} = đường dẫn công khai của ảnh (có thể rỗng nếu người dùng tự tải ảnh lên)
- {{anh_tep}} = tệp ảnh thật, CHỈ dùng khi kieu_than là "multipart" (khuyên dùng vì luôn có ảnh)
- {{anh_base64}} = ảnh dạng base64; {{anh_kieu}} = kiểu ảnh (image/jpeg hoặc image/png)
- {{noi_dung_html}} = bài đăng dạng HTML (ảnh + các đoạn <p> + link gốc bấm được) — dùng cho blog/website nhận HTML
- {{basic_auth:truong.A|truong.B}} = chuỗi base64 của "A:B" cho xác thực Basic, dùng như "Authorization": "Basic {{basic_auth:truong.A|truong.B}}"
- {{truong.KHOA}} = giá trị người dùng nhập cho trường có khoa = KHOA
- Bộ lọc: {{tieu_de|cat:100}} cắt còn tối đa 100 ký tự.

Quy tắc:
- truong: chỉ các mã/ID người dùng phải tự cung cấp (token, ID trang, ID kênh...). khoa viết không dấu, chữ thường, gạch dưới. nhan và goi_y bằng tiếng Việt dễ hiểu. bi_mat = true với mọi loại mã bí mật.
- huong_dan: 3–6 bước tiếng Việt, ngôn ngữ đời thường cho người không rành kỹ thuật, chỉ cách lấy từng mã (vào đâu, bấm gì). Mỗi bước một dòng, bắt đầu bằng "1.", "2."...
- than_json: một đối tượng JSON (dạng chuỗi) là phần thân yêu cầu; giá trị là chuỗi có thể chứa biến. Với multipart/form, mọi giá trị ở cấp đầu phải là chuỗi.
- thanh_cong_khi: đường dẫn tới trường trong JSON phản hồi phải có giá trị đúng khi thành công (vd "ok"), hoặc "" nếu chỉ cần mã HTTP 2xx.
- duong_dan_bai: mẫu đường dẫn bài đăng mới, dùng {{phan_hoi.a.b}} để lấy giá trị từ JSON phản hồi (vd "https://site.com/p/{{phan_hoi.id}}"); "" nếu nền tảng không trả về.
- thong_bao_loi: đường dẫn tới thông báo lỗi trong JSON phản hồi (vd "error.message"), hoặc "".
- Chỉ dùng API chính thức, địa chỉ HTTPS thật. Không bịa địa chỉ.
- Nếu nền tảng KHÔNG thể đăng bài bằng một yêu cầu với mã tĩnh (vd bắt buộc ký OAuth 1.0, phải tải ảnh riêng qua nhiều bước, hoặc không có API đăng bài), đặt co_the_ket_noi = false, giải thích ngắn gọn bằng tiếng Việt trong ly_do_khong_the và gợi ý dùng Make.com hoặc Zapier (tạo kịch bản nhận Webhook rồi đăng lên ${ten}). Các trường còn lại để rỗng.`;

export async function taoCongThucAI(caiDat, ten, hanChot) {
  const kq = await goiAI(caiDat, huongDanCongThuc(ten), KHUON_CONG_THUC, "medium", hanChot);
  if (!kq.co_the_ket_noi) return { khong_the: kq.ly_do_khong_the || `Chưa tìm được cách đăng thẳng lên ${ten}.` };
  let than;
  try { than = String(kq.than_json || "").trim() ? JSON.parse(kq.than_json) : {}; } catch { throw new LoiAI("AI trả về công thức bị lỗi định dạng. Bấm tạo lại thử xem."); }
  return {
    ten: kq.ten_hien_thi || ten,
    nguon: "AI tự tìm (nên gửi thử 1 bài trước)",
    huong_dan: kq.huong_dan || "",
    truong: kq.truong || [],
    gui: {
      phuong_thuc: kq.phuong_thuc || "POST",
      dia_chi: kq.dia_chi || "",
      tieu_de_http: Object.fromEntries((kq.tieu_de_http || []).map((h) => [h.ten, h.gia_tri])),
      kieu_than: kq.kieu_than || "json",
      than,
    },
    ket_qua: { thanh_cong_khi: kq.thanh_cong_khi || "", duong_dan_bai: kq.duong_dan_bai || "", thong_bao_loi: kq.thong_bao_loi || "" },
  };
}
