export function bindPromptQuickSwitch({ getState, setState, request, showToast, editMode, getMode, download }) {
  const el = id => document.getElementById(id);
  const select = (element, entries, value, label) => {
    element.replaceChildren(new Option(label, ""), ...entries.map(item => new Option(item.name, item.id)));
    if (value && !entries.some(item => item.id === value)) element.add(new Option("已刪除（目前使用跟隨設定）", value));
    element.value = value || "";
  };
  function render(state = getState()) {
    const selection = state?.promptSelection || {};
    select(el("conversationPromptMode"), Object.entries(state?.modularPromptConfigs || {}).map(([id, config]) => ({ id, name: config.name || id })), selection.mode, "跟隨角色卡");
    select(el("conversationBodyRule"), state?.bodyRulePresets || [], selection.bodyRuleId, "跟隨模式");
    for (const id of ["conversationPromptMode", "conversationBodyRule"]) el(id).disabled = Boolean(state?.activeAssistantMode);
    el("promptSelectionHint").textContent = state?.activeAssistantMode ? "助手使用自己的提示詞；此設定只套用角色對話。" : "只影響目前對話；編輯共用預設會影響所有選用它的對話。";
    el("promptQuickSwitch").title = el("promptSelectionHint").textContent;
    for (const id of ["conversationPromptMode", "conversationBodyRule"]) {
      el(id).title = el(id).selectedOptions[0]?.textContent || "";
    }
  }
  function fillEditor(id = "") {
    const rules = getState()?.bodyRulePresets || [];
    select(el("bodyRuleEditorSelect"), rules, id, "新增正文規則");
    const rule = rules.find(item => item.id === id);
    el("bodyRuleName").value = rule?.name || "";
    el("bodyRuleMain").value = rule?.mainRules || "";
    el("bodyRuleOutput").value = rule?.contextRules || "";
    el("bodyRuleDelete").disabled = !rule;
  }
  const collect = () => ({ name: el("bodyRuleName").value.trim(), mainRules: el("bodyRuleMain").value, contextRules: el("bodyRuleOutput").value });
  async function save(asNew = false) {
    if (!el("bodyRuleForm").reportValidity()) return;
    const id = asNew ? "" : el("bodyRuleEditorSelect").value;
    if (id && !window.confirm("保存會更新所有選用此規則的對話。要繼續嗎？")) return;
    const buttons = [...el("bodyRuleForm").querySelectorAll("button")];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const payload = await request(id ? `/api/body-rule-presets/${id}` : "/api/body-rule-presets", { method: id ? "PUT" : "POST", body: JSON.stringify(collect()) });
      setState(payload.state || payload);
      fillEditor(id || payload.rule.id);
      render(); showToast("正文規則已保存；可從對話選單選用");
    } catch (error) { showToast(error.message, "error"); }
    finally { buttons.forEach(button => { button.disabled = false; }); el("bodyRuleDelete").disabled = !el("bodyRuleEditorSelect").value; }
  }
  async function changeSelection() {
    const body = JSON.stringify({ mode: el("conversationPromptMode").value, bodyRuleId: el("conversationBodyRule").value });
    for (const id of ["conversationPromptMode", "conversationBodyRule"]) el(id).disabled = true;
    try {
      setState(await request("/api/prompt-selection", { method: "PUT", body }));
      showToast("目前對話預設已切換，下次生成生效");
    } catch (error) { showToast(error.message, "error"); }
    finally { render(); }
  }
  for (const id of ["conversationPromptMode", "conversationBodyRule"]) el(id).addEventListener("change", () => void changeSelection());
  el("openPromptQuickSwitch").addEventListener("click", () => {
    render(); el("promptSelectionDialog").showModal();
  });
  el("closePromptQuickSwitch").addEventListener("click", () => el("promptSelectionDialog").close());
  el("editConversationPrompt").addEventListener("click", () => editMode(getMode(getState())));
  el("editConversationBodyRule").addEventListener("click", () => {
    fillEditor(getState()?.promptSelection?.bodyRuleId || ""); el("bodyRuleDialog").showModal();
  });
  el("bodyRuleEditorSelect").addEventListener("change", event => fillEditor(event.target.value));
  el("bodyRuleForm").addEventListener("submit", event => { event.preventDefault(); void save(); });
  el("bodyRuleSaveAs").addEventListener("click", () => void save(true));
  el("bodyRuleNew").addEventListener("click", () => fillEditor());
  el("bodyRuleClose").addEventListener("click", () => el("bodyRuleDialog").close());
  el("bodyRuleFromMode").addEventListener("click", () => {
    const config = getState()?.modularPromptConfigs?.[getMode(getState())];
    if (!config) return;
    el("bodyRuleMain").value = config.reasonerHistory?.mainRules || "";
    el("bodyRuleOutput").value = config.reasonerHistory?.contextRules || "";
    if (!el("bodyRuleName").value) el("bodyRuleName").value = (config.name || config.mode) + " 正文";
  });
  el("bodyRuleExport").addEventListener("click", () => {
    if (!el("bodyRuleForm").reportValidity()) return;
    download({ type: "time_tavern_body_rule", version: 1, rule: collect() });
  });
  el("bodyRuleImport").addEventListener("click", () => el("bodyRuleFile").click());
  el("bodyRuleFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    try {
      if (!file) return;
      if (file.size > 2000000) throw new Error("正文規則檔案過大");
      const payload = JSON.parse(await file.text());
      const rule = payload.rule;
      if (payload.type !== "time_tavern_body_rule" || payload.version !== 1 || typeof rule?.name !== "string" || typeof rule?.mainRules !== "string" || typeof rule?.contextRules !== "string") throw new Error("不是有效的正文規則備份");
      fillEditor();
      el("bodyRuleName").value = rule.name;
      el("bodyRuleMain").value = rule.mainRules;
      el("bodyRuleOutput").value = rule.contextRules;
      showToast("已讀入，請檢查後按保存建立新規則");
    } catch (error) { showToast(error.message, "error"); }
    finally { event.target.value = ""; }
  });
  el("bodyRuleDelete").addEventListener("click", async () => {
    const id = el("bodyRuleEditorSelect").value;
    if (!id || !window.confirm("刪除此共用規則？原本選用它的對話會改用模式內的正文規則。")) return;
    try {
      setState(await request(`/api/body-rule-presets/${id}`, { method: "DELETE" }));
      fillEditor(); render(); showToast("正文規則已刪除");
    } catch (error) { showToast(error.message, "error"); }
  });
  return { render };
}
