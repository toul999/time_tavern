import fs from "node:fs";

export function validateSupplement(value) {
  if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120 ||
      typeof value.text !== "string" || value.text.length > 200000) throw new Error("補充版本需要名稱（最多 120 字）及有效文字內容");
  return { name: value.name.trim(), text: value.text };
}

export function readSupplementPresets(file) {
  if (!fs.existsSync(file)) return [];
  const values = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(values)) throw new Error("自訂補充收藏檔格式錯誤，未覆寫原檔");
  const ids = new Set();
  return values.map(value => {
    if (!/^supplement_[a-zA-Z0-9_-]+$/.test(value?.id || "") || ids.has(value.id)) throw new Error("補充版本 ID 錯誤或重複");
    ids.add(value.id);
    return { id: value.id, ...validateSupplement(value) };
  });
}
