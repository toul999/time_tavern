export function validateCardBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray(value.roleCards) || !Array.isArray(value.assistantCards) ||
      !value.globalLorebook || typeof value.globalLorebook !== "object" || Array.isArray(value.globalLorebook) ||
      !Array.isArray(value.globalLorebook.entries)) {
    throw new Error("請提供完整的 cardstate.json（角色卡、助手卡與全局世界書）。");
  }
  for (const key of ["roleCards", "assistantCards"]) {
    const ids = new Set();
    for (const card of value[key]) {
      if (!card || typeof card !== "object" || Array.isArray(card) || typeof card.id !== "string" || !card.id.trim() ||
          card.id !== card.id.trim() || typeof card.name !== "string" || ids.has(card.id)) {
        throw new Error("備份內含有無效的卡片或重複 ID，未變更現有資料。");
      }
      ids.add(card.id);
    }
  }
  return { roleCards: value.roleCards, assistantCards: value.assistantCards, globalLorebook: value.globalLorebook };
}
