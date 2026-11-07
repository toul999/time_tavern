import test from "node:test";
import assert from "node:assert/strict";
import { bindSupplementEditor } from "../src/public/supplement-editor.js";

test("supplement actions explain unavailable actions and use inline update/delete confirmation", async t => {
  const originalDocument = globalThis.document, originalOption = globalThis.Option;
  class Element {
    value = ""; textContent = ""; hidden = true; disabled = false; listeners = {};
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    replaceChildren(...children) { this.children = children; }
    add(child) { this.children.push(child); }
    focus() {} scrollIntoView() {}
    async fire(name) { for (const fn of this.listeners[name] || []) await fn({ target: this, preventDefault() {} }); }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  globalThis.document = { getElementById: el, querySelector: () => el("menu") };
  globalThis.Option = class { constructor(name, id) { this.text = name; this.value = id; } };
  t.after(() => { globalThis.document = originalDocument; globalThis.Option = originalOption; });
  let state = { userProfile: { identityText: "applied" }, supplementPresets: [] };
  const calls = [];
  const editor = bindSupplementEditor({
    getState: () => state, setState: next => { state = next; }, showToast() {}, download() {},
    request: async (url, options) => {
      calls.push({ url, ...options });
      const input = options.body && JSON.parse(options.body);
      if (options.method === "POST") {
        const preset = { id: "supplement_A", ...input };
        state = { ...state, supplementPresets: [preset] }; return { preset, state };
      }
      state = { ...state, supplementPresets: options.method === "DELETE" ? [] : [{ id: "supplement_A", ...input }] };
      return state;
    }
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  editor.render(state);
  assert.equal(el("supplementUpdate").textContent, "儲存為新版本");
  assert.equal(el("supplementUpdate").disabled, false);
  assert.equal(el("supplementRename").disabled, true);
  assert.match(el("supplementMenuStatus").textContent, /尚未選擇/);
  await el("supplementUpdate").fire("click");
  assert.equal(el("supplementNameRow").hidden, false);
  el("supplementName").value = "A";
  await el("supplementNameConfirm").fire("click"); await settle();
  assert.equal(calls.length, 1);
  assert.equal(el("supplementRename").disabled, false);
  assert.equal(el("supplementUpdate").textContent, "更新目前版本");
  el("identityText").value = "edited";
  await el("supplementUpdate").fire("click");
  assert.equal(calls.length, 1, "update must wait for confirmation");
  assert.equal(el("supplementReplaceYes").textContent, "確認更新");
  await el("supplementReplaceYes").fire("click"); await settle();
  assert.equal(JSON.parse(calls.at(-1).body).text, "edited");
  assert.equal(state.userProfile.identityText, "applied");
  await el("supplementRename").fire("click");
  el("supplementName").value = "Renamed";
  await el("supplementNameConfirm").fire("click"); await settle();
  assert.equal(state.supplementPresets[0].name, "Renamed");
  const cancelledDeletion = el("supplementDelete").fire("click");
  await el("supplementReplaceNo").fire("click"); await cancelledDeletion;
  assert.equal(state.supplementPresets.length, 1);
  const deletion = el("supplementDelete").fire("click");
  assert.equal(el("supplementReplaceYes").textContent, "確認刪除");
  await el("supplementReplaceYes").fire("click"); await deletion;
  assert.equal(state.supplementPresets.length, 0);
  assert.equal(el("identityText").value, "edited");
  assert.equal(state.userProfile.identityText, "applied");
});
