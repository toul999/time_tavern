export function bindSupplementEditor({ getState, setState, request, showToast, download }) {
  const el = id => document.getElementById(id);
  const text = el("identityText"), picker = el("supplementPresetSelect");
  let selectedId = "", baseline = "", appliedText = "", initialized = false, busy = false;
  const entries = () => getState()?.supplementPresets || [];
  const current = () => entries().find(item => item.id === selectedId);
  function options() {
    picker.replaceChildren(new Option("目前內容／未選版本", ""), ...entries().map(item => new Option(item.name, item.id)));
    if (selectedId && !current()) picker.add(new Option("原版本已刪除", selectedId));
    picker.value = selectedId;
    const hasPreset = Boolean(current());
    el("supplementUpdate").textContent = hasPreset ? "更新目前版本" : "儲存為新版本";
    el("supplementMenuStatus").textContent = hasPreset ? `目前版本：${current().name}` : "尚未選擇收藏版本；先儲存新版本才能改名或刪除。";
    for (const id of ["supplementRename", "supplementDelete"]) {
      el(id).disabled = !hasPreset || busy;
      el(id).title = hasPreset ? "" : "請先選擇或儲存一個收藏版本";
    }
    for (const id of ["supplementUpdate", "supplementNew", "supplementSaveAs", "supplementNameConfirm", "supplementImport"]) el(id).disabled = busy;
    picker.disabled = busy;
  }
  function status() {
    const dirty = text.value !== appliedText;
    el("supplementStatus").textContent = dirty ? "尚未套用：按「儲存使用者設定」才會全局生效。" : "目前內容已套用；收藏版本需另外保存。";
  }
  function render(state) {
    const profile = state?.userProfile || {};
    if (!initialized || text.value === appliedText) {
      text.value = profile.identityText || "";
      selectedId = profile.supplementPresetId || "";
      baseline = text.value;
    }
    appliedText = profile.identityText || "";
    initialized = true; options(); status();
  }
  let pendingReplace = null;
  function confirmInline(message, actionLabel) {
    pendingReplace?.(false);
    el("supplementConfirmMessage").textContent = message;
    el("supplementReplaceYes").textContent = actionLabel;
    el("supplementReplaceNo").textContent = "取消";
    el("supplementConfirmRow").hidden = false;
    el("supplementConfirmRow").scrollIntoView({ block: "nearest", behavior: "smooth" });
    return new Promise(resolve => { pendingReplace = resolve; });
  }
  async function allowReplace() {
    if (text.value === baseline && text.value === appliedText) return true;
    return confirmInline("目前內容尚未保存或套用，繼續會取代編輯框內容。", "繼續切換");
  }
  for (const [id, answer] of [["supplementReplaceYes", true], ["supplementReplaceNo", false]]) {
    el(id).addEventListener("click", () => {
      el("supplementConfirmRow").hidden = true;
      pendingReplace?.(answer); pendingReplace = null;
    });
  }
  function load(id, value) {
    selectedId = id; text.value = value; baseline = value; options(); status();
  }
  let nameAction = "";
  function askName(action) {
    nameAction = action;
    el("supplementNameRow").hidden = false;
    el("supplementName").value = action === "rename" ? current()?.name || "" : current() ? current().name + " 副本" : "自訂補充";
    el("supplementName").focus();
  }
  async function save(asNew, newName = "") {
    if (busy) return;
    const old = current();
    if (!asNew && !old) { askName("save"); return; }
    if (asNew && !newName) { askName("save"); return; }
    const name = asNew ? newName : old.name;
    if (!name.trim()) return;
    if (!asNew && !await confirmInline(`將目前編輯內容更新至「${old.name}」？已套用的全局內容不會改變。`, "確認更新")) return;
    busy = true; options();
    try {
      const payload = await request(asNew ? "/api/supplement-presets" : `/api/supplement-presets/${old.id}`, {
        method: asNew ? "POST" : "PUT", body: JSON.stringify({ name, text: text.value })
      });
      setState(payload.state || payload);
      selectedId = asNew ? payload.preset.id : old.id;
      el("supplementNameRow").hidden = true;
      baseline = text.value; showToast("版本已保存；套用請按儲存使用者設定");
    } catch (error) { showToast(error.message, "error"); }
    finally { busy = false; options(); status(); }
  }
  picker.addEventListener("change", async () => {
    const next = picker.value;
    picker.value = selectedId;
    if (!await allowReplace()) return;
    load(next, entries().find(item => item.id === next)?.text ?? appliedText);
  });
  text.addEventListener("input", status);
  el("supplementNew").addEventListener("click", async () => { if (await allowReplace()) load("", ""); });
  el("supplementSaveAs").addEventListener("click", () => void save(true));
  el("supplementUpdate").addEventListener("click", () => void save(false));
  async function rename(name) {
    const preset = current(); if (!preset || busy) return;
    if (!name?.trim()) return;
    busy = true; options();
    try {
      setState(await request(`/api/supplement-presets/${preset.id}`, { method: "PUT", body: JSON.stringify({ name, text: preset.text }) }));
      el("supplementNameRow").hidden = true; options(); showToast("版本已改名");
    } catch (error) { showToast(error.message, "error"); }
    finally { busy = false; options(); }
  }
  el("supplementRename").addEventListener("click", () => askName("rename"));
  el("supplementNameConfirm").addEventListener("click", () => {
    const name = el("supplementName").value.trim();
    if (!name) { showToast("請填寫版本名稱", "error"); return; }
    if (nameAction === "rename") void rename(name); else void save(true, name);
  });
  el("supplementNameCancel").addEventListener("click", () => { el("supplementNameRow").hidden = true; });
  el("supplementName").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); el("supplementNameConfirm").click(); }
  });
  const menu = document.querySelector(".supplement-menu");
  menu.addEventListener("click", event => {
    if (event.target.closest("button")) menu.open = false;
  });
  el("supplementDelete").addEventListener("click", async () => {
    const preset = current(); if (!preset || busy) return;
    if (!await confirmInline(`刪除收藏「${preset.name}」？目前編輯內容及已套用設定會保留。`, "確認刪除")) return;
    busy = true; options();
    try {
      setState(await request(`/api/supplement-presets/${preset.id}`, { method: "DELETE" }));
      selectedId = ""; options(); showToast("收藏已刪除，編輯內容仍保留");
    } catch (error) { showToast(error.message, "error"); }
    finally { busy = false; options(); status(); }
  });
  el("supplementExport").addEventListener("click", () => {
    download({ type: "time_tavern_supplement", version: 1, preset: { name: current()?.name || "自訂補充", text: text.value } });
  });
  el("supplementImport").addEventListener("click", () => el("supplementFile").click());
  el("supplementFile").addEventListener("change", async event => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      if (file.size > 2000000) throw new Error("檔案過大");
      const payload = JSON.parse(await file.text()), preset = payload.preset;
      if (payload.type !== "time_tavern_supplement" || payload.version !== 1 || typeof preset?.name !== "string" || typeof preset?.text !== "string") throw new Error("不是有效的補充版本備份");
      if (!await allowReplace()) return;
      const result = await request("/api/supplement-presets", { method: "POST", body: JSON.stringify(preset) });
      setState(result.state); load(result.preset.id, result.preset.text);
      showToast("已匯入新版本，儲存使用者設定後才套用");
    } catch (error) { showToast(error.message, "error"); }
    finally { event.target.value = ""; }
  });
  return {
    render, getSelectedId: () => selectedId,
    markApplied(state) { appliedText = state.userProfile?.identityText || ""; baseline = text.value; options(); status(); }
  };
}
