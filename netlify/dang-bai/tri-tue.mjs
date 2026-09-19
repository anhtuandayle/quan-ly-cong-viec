// Phần AI (tuỳ chọn): dùng Claude để tóm tắt bài và tự tìm cách kết nối một nền tảng bất kỳ.
import Anthropic from "@anthropic-ai/sdk";
import { GIOI_HAN_TOM_TAT, chuanHoa, doDai, rutGon } from "./trich-xuat.mjs";

const MO_HINH = "claude-opus-5";

export class LoiAI extends Error {}

async function goi(chiaKhoa, loiNhac, schema, effort) {
  const may = new Anthropic({ apiKey: chiaKhoa, timeout: 50_000, maxRetries: 0 }); // Netlify cho tối đa 60 giây
  let r;
  try {
    r = await may.beta.messages.create({
      model: MO_HINH,
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

// ---------------------------------------------------------------- tóm tắt

const KHUON_TOM_TAT = {
  type: "object",
  properties: { tom_tat: { type: "string" } },
  required: ["tom_tat"],
  additionalProperties: false,
};

export async function tomTatAI(chiaKhoa, tieuDe, noiDung) {
  const loiNhac = `Tóm tắt bài viết dưới đây thành MỘT câu giới thiệu để đăng mạng xã hội.

Yêu cầu:
- Viết cùng ngôn ngữ với bài viết.
- Dài từ 80 đến 130 ký tự (tính cả dấu cách). Tuyệt đối không quá ${GIOI_HAN_TOM_TAT} ký tự.
- Nêu ý chính hấp dẫn nhất; không hashtag, không emoji, không chèn đường dẫn, không lặp lại nguyên văn tiêu đề.

<tieu_de>${tieuDe}</tieu_de>
<bai_viet>
${noiDung.slice(0, 60000)}
</bai_viet>`;
  let kq = chuanHoa((await goi(chiaKhoa, loiNhac, KHUON_TOM_TAT, "low")).tom_tat);
  if (doDai(kq) > GIOI_HAN_TOM_TAT) {
    kq = chuanHoa((await goi(chiaKhoa, `Câu sau dài ${doDai(kq)} ký tự, hãy viết lại cho dưới 130 ký tự, giữ ý chính, cùng ngôn ngữ:\n\n${kq}`, KHUON_TOM_TAT, "low")).tom_tat);
  }
  return rutGon(kq); // chốt chặn cuối: luôn dưới 140 ký tự
}

// ---------------------------------------------------------------- công thức kết nối

const chuoi = { type: "string" };
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

Bài đăng gồm: tiêu đề, đoạn tóm tắt ngắn, ảnh, đường dẫn bài gốc (luôn nằm cuối nội dung).

Các biến có thể dùng trong dia_chi, tieu_de_http và than_json (viết đúng dạng {{...}}):
- {{tieu_de}}, {{tom_tat}}, {{link_goc}}
- {{noi_dung}} = tiêu đề + tóm tắt + đường dẫn gốc ở cuối, đã ghép sẵn (nên dùng làm phần chữ của bài)
- {{anh_url}} = đường dẫn công khai của ảnh (có thể rỗng nếu người dùng tự tải ảnh lên)
- {{anh_tep}} = tệp ảnh thật, CHỈ dùng khi kieu_than là "multipart" (khuyên dùng vì luôn có ảnh)
- {{anh_base64}} = ảnh dạng base64
- {{truong.KHOA}} = giá trị người dùng nhập cho trường có khoa = KHOA

Quy tắc:
- truong: chỉ các mã/ID người dùng phải tự cung cấp (token, ID trang, ID kênh...). khoa viết không dấu, chữ thường, gạch dưới. nhan và goi_y bằng tiếng Việt dễ hiểu. bi_mat = true với mọi loại mã bí mật.
- huong_dan: 3–6 bước tiếng Việt, ngôn ngữ đời thường cho người không rành kỹ thuật, chỉ cách lấy từng mã (vào đâu, bấm gì). Mỗi bước một dòng, bắt đầu bằng "1.", "2."...
- than_json: một đối tượng JSON (dạng chuỗi) là phần thân yêu cầu; giá trị là chuỗi có thể chứa biến. Với multipart/form, mọi giá trị ở cấp đầu phải là chuỗi.
- thanh_cong_khi: đường dẫn tới trường trong JSON phản hồi phải có giá trị đúng khi thành công (vd "ok"), hoặc "" nếu chỉ cần mã HTTP 2xx.
- duong_dan_bai: mẫu đường dẫn bài đăng mới, dùng {{phan_hoi.a.b}} để lấy giá trị từ JSON phản hồi (vd "https://site.com/p/{{phan_hoi.id}}"); "" nếu nền tảng không trả về.
- thong_bao_loi: đường dẫn tới thông báo lỗi trong JSON phản hồi (vd "error.message"), hoặc "".
- Chỉ dùng API chính thức, địa chỉ HTTPS thật. Không bịa địa chỉ.
- Nếu nền tảng KHÔNG thể đăng bài bằng một yêu cầu với mã tĩnh (vd bắt buộc ký OAuth 1.0, phải tải ảnh riêng qua nhiều bước, hoặc không có API đăng bài), đặt co_the_ket_noi = false, giải thích ngắn gọn bằng tiếng Việt trong ly_do_khong_the và gợi ý dùng Make.com hoặc Zapier (tạo kịch bản nhận Webhook rồi đăng lên ${ten}). Các trường còn lại để rỗng.`;

export async function taoCongThucAI(chiaKhoa, ten) {
  const kq = await goi(chiaKhoa, huongDanCongThuc(ten), KHUON_CONG_THUC, "medium");
  if (!kq.co_the_ket_noi) return { khong_the: kq.ly_do_khong_the || `Chưa tìm được cách đăng thẳng lên ${ten}.` };
  let than;
  try { than = kq.than_json.trim() ? JSON.parse(kq.than_json) : {}; } catch { throw new LoiAI("AI trả về công thức bị lỗi định dạng. Bấm tạo lại thử xem."); }
  return {
    ten: kq.ten_hien_thi || ten,
    nguon: "AI tự tìm (nên gửi thử 1 bài trước)",
    huong_dan: kq.huong_dan,
    truong: kq.truong,
    gui: {
      phuong_thuc: kq.phuong_thuc,
      dia_chi: kq.dia_chi,
      tieu_de_http: Object.fromEntries(kq.tieu_de_http.map((h) => [h.ten, h.gia_tri])),
      kieu_than: kq.kieu_than,
      than,
    },
    ket_qua: { thanh_cong_khi: kq.thanh_cong_khi, duong_dan_bai: kq.duong_dan_bai, thong_bao_loi: kq.thong_bao_loi },
  };
}
