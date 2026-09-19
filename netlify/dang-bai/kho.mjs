// Nơi lưu dữ liệu: Netlify Blobs khi chạy trên web; thư mục trên máy khi chạy thử (biến KHO_CUC_BO).
import { getStore } from "@netlify/blobs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function moKho() {
  const thuMuc = process.env.KHO_CUC_BO;
  if (thuMuc) {
    const tep = (k) => path.join(thuMuc, `${k}.json`);
    return {
      doc: async (k) => { try { return JSON.parse(await readFile(tep(k), "utf8")); } catch { return null; } },
      ghi: async (k, v) => { await mkdir(thuMuc, { recursive: true }); await writeFile(tep(k), JSON.stringify(v, null, 2)); },
      xoa: async (k) => rm(tep(k), { force: true }),
    };
  }
  const kho = getStore({ name: "dang-bai-da-kenh", consistency: "strong" });
  return {
    doc: (k) => kho.get(k, { type: "json" }),
    ghi: (k, v) => kho.setJSON(k, v),
    xoa: (k) => kho.delete(k),
  };
}
