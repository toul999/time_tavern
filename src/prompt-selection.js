import fs from "node:fs";

export function normalizePromptSelection(value = {}) {
  return {
    mode: typeof value?.mode === "string" ? value.mode.trim() : "",
    bodyRuleId: typeof value?.bodyRuleId === "string" ? value.bodyRuleId.trim() : ""
  };
}

export function validateBodyRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("正文規則格式不正確");
  const name = String(value.name || "").trim();
  if (!name || name.length > 120) throw new Error("請填寫 1 至 120 字的規則名稱");
  for (const field of ["mainRules", "contextRules"]) {
    if (typeof value[field] !== "string" || value[field].length > 200000) throw new Error("正文規則內容格式或長度不正確");
  }
  return { name, mainRules: value.mainRules, contextRules: value.contextRules };
}

export function readBodyRules(file) {
  if (!fs.existsSync(file)) return [];
  const rules = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rules)) throw new Error("正文規則收藏格式不正確，請保留檔案並檢查");
  const ids = new Set();
  return rules.map(rule => {
    if (!/^body_[a-zA-Z0-9_-]+$/.test(rule?.id || "") || ids.has(rule.id)) throw new Error("正文規則 ID 不正確或重複");
    ids.add(rule.id);
    return { id: rule.id, ...validateBodyRule(rule) };
  });
}

// Return a new config: the role card and the shared mode remain unchanged.
export function resolvePromptSelection(configs, roleMode, selection, bodyRules = []) {
  const selected = normalizePromptSelection(selection);
  const config = (Object.hasOwn(configs, selected.mode) && configs[selected.mode]) ||
    (Object.hasOwn(configs, roleMode) && configs[roleMode]) || configs.single;
  if (!config) throw new Error("找不到可使用的 Prompt 模式");
  const rules = bodyRules.find(rule => rule.id === selected.bodyRuleId);
  return rules ? { ...config, reasonerHistory: { ...config.reasonerHistory,
    mainRules: rules.mainRules, contextRules: rules.contextRules } } : config;
}
