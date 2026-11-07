import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { normalizePromptSelection, resolvePromptSelection, validateBodyRule, readBodyRules } from "../src/prompt-selection.js";

const configs = {
  single: { mode: "single", reasonerHistory: { mainRules: "A-main", contextRules: "A-output" }, compressionProfiles: ["A-compression"] },
  multi: { mode: "multi", reasonerHistory: { mainRules: "B-main", contextRules: "B-output" }, compressionProfiles: ["B-compression"] }
};
const rules = [{ id: "body_C", name: "C", mainRules: "C-main", contextRules: "C-output" }];

test("A role, B conversation and C body compose without changing shared data", () => {
  const original = JSON.stringify(configs);
  const combined = resolvePromptSelection(configs, "single", { mode: "multi", bodyRuleId: "body_C" }, rules);
  assert.equal(combined.mode, "multi");
  assert.deepEqual(combined.compressionProfiles, ["B-compression"]);
  assert.deepEqual(combined.reasonerHistory, { mainRules: "C-main", contextRules: "C-output" });
  assert.equal(JSON.stringify(configs), original);
  assert.equal(resolvePromptSelection(configs, "single", { mode: "multi" }, rules), configs.multi);
  assert.equal(resolvePromptSelection(configs, "single", {}, rules), configs.single);
  assert.equal(resolvePromptSelection(configs, "single", { bodyRuleId: "body_C" }, rules).reasonerHistory.mainRules, "C-main");
});

test("legacy, removed references, empty rules and invalid inherited mode names are safe", () => {
  assert.deepEqual(normalizePromptSelection(null), { mode: "", bodyRuleId: "" });
  assert.equal(resolvePromptSelection(configs, "single", { mode: "removed", bodyRuleId: "removed" }, rules), configs.single);
  assert.equal(resolvePromptSelection(configs, "single", { mode: "__proto__" }, rules), configs.single);
  const blank = [{ ...rules[0], mainRules: "", contextRules: "" }];
  assert.equal(resolvePromptSelection(configs, "single", { bodyRuleId: "body_C" }, blank).reasonerHistory.mainRules, "");
});

test("body rule library validates content and does not replace corrupt files", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "body-rule-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "body-rule-presets.json");
  assert.deepEqual(readBodyRules(file), []);
  fs.writeFileSync(file, JSON.stringify(rules));
  assert.deepEqual(readBodyRules(file), rules);
  assert.throws(() => validateBodyRule({ name: "", mainRules: "", contextRules: "" }));
  assert.throws(() => validateBodyRule({ name: "C", mainRules: {}, contextRules: "" }));
  fs.writeFileSync(file, "corrupt");
  assert.throws(() => readBodyRules(file));
  assert.equal(fs.readFileSync(file, "utf8"), "corrupt");
});

test("actual server prompt composer preserves section order and replaces only body rules", () => {
  const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function buildSimpleCompressedReasonerStaticSystemPrompt(");
  const end = source.indexOf("\nfunction ", start + 1);
  const context = vm.createContext({
    getActiveRoleCard: () => ({ mode: "single" }), resolveUserDisplayName: () => "User",
    createTemplateVariables: () => ({}), finalizePromptTemplate: text => text,
    formatModularRoleContext: () => "ROLE-CONTEXT",
    getActiveModularPromptConfig: () => resolvePromptSelection(configs, "single", { mode: "multi", bodyRuleId: "body_C" }, rules)
  });
  vm.runInContext(source.slice(start, end), context);
  const prompt = context.buildSimpleCompressedReasonerStaticSystemPrompt({ userProfile: {} });
  const ordered = ["【主要規則】", "C-main", "ROLE-CONTEXT", "【輸出規則】", "C-output", "【處理要求】"];
  for (let i = 1; i < ordered.length; i++) assert.ok(prompt.indexOf(ordered[i - 1]) < prompt.indexOf(ordered[i]));
  assert.ok(!prompt.includes("B-main") && !prompt.includes("A-main"));
});
