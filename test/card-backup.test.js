import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { validateCardBackup } from "../src/card-backup.js";

test("backup validation rejects incomplete/duplicate records and excludes environment", () => {
  const backup = { roleCards: [{ id: "a", name: "A" }], assistantCards: [], globalLorebook: { entries: [] }, environment: { secret: "exclude" } };
  assert.equal(validateCardBackup(backup).roleCards[0].id, "a");
  assert.equal(validateCardBackup(backup).environment, undefined);
  for (const invalid of [{}, { ...backup, roleCards: [backup.roleCards[0], backup.roleCards[0]] },
    { ...backup, assistantCards: [null] }, { ...backup, roleCards: [{ id: " a ", name: "A" }] }]) {
    assert.throws(() => validateCardBackup(invalid));
  }
});

const app = fs.readFileSync(new URL("../src/public/app.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("batch import saves serially, skips corrupt files, blocks duplicate batches and refreshes once", async () => {
  const calls = []; let active = 0; let refreshes = 0;
  const context = vm.createContext({
    el: { roleCardImportFile: { value: "files" }, importRoleCardBtn: {}, importRoleCardBackupBtn: {}, exportRoleCardBackupBtn: {} },
    appState: {}, showToast() {}, window: { alert(message) { calls.push(message); } },
    async readRoleCardPayloadFromFile(file) { if (file.name === "bad.png") throw new Error("Invalid PNG"); return { name: file.name }; },
    async request(url, options) {
      assert.equal(active++, 0);
      await new Promise(resolve => setTimeout(resolve, 1));
      calls.push(JSON.parse(options.body).name); active--; return { state: {} };
    },
    async refresh() { refreshes++; }
  });
  vm.runInContext(app.slice(app.indexOf("let roleCardImportBusy = false;"), app.indexOf("\nasync function exportRoleCardBackup")), context);
  const first = context.importRoleCardsFromFiles([{ name: "one.png" }, { name: "bad.png" }, { name: "two.png" }]);
  await context.importRoleCardsFromFiles([{ name: "duplicate.png" }]);
  await first;
  assert.deepEqual(calls.slice(0, 2), ["one.png", "two.png"]);
  assert.match(calls[2], /bad.png/);
  assert.equal(refreshes, 1);
  assert.equal(context.el.roleCardImportFile.value, "");
  assert.equal(context.el.importRoleCardBtn.disabled, false);
});

test("restore validates first, backs up old cards and rolls back memory after persistence errors", async () => {
  const start = server.indexOf('    if (pathname === "/api/role-cards/backup" && method === "POST")');
  const end = server.indexOf('    if (pathname === "/api/role-cards" && method === "GET")', start);
  assert.ok(start > 0 && end > start);
  for (const scenario of ["success", "invalid", "backupFailure", "persistFailure"]) {
    const old = [{ id: "old", name: "Old" }];
    const state = { roleCards: old, assistantCards: [], globalLorebook: { entries: [] }, conversation: ["keep"], environment: "keep" };
    const writes = []; let response;
    const context = vm.createContext({
      pathname: "/api/role-cards/backup", method: "POST", req: {}, res: {}, state,
      async readBody() { return scenario === "invalid" ? {} : { roleCards: [{ id: "new", name: "New" }], assistantCards: [], globalLorebook: { entries: [] } }; },
      validateCardBackup, async withStateLock(callback) { return callback(); },
      extractCardState(value) { return { roleCards: value.roleCards, assistantCards: value.assistantCards, globalLorebook: value.globalLorebook }; },
      DATA_DIR: "mock", path: { join: (...args) => args.join("/") }, fs: { mkdirSync() {} }, crypto: { randomUUID: () => "unique" },
      writeJsonFile(file, content) { if (scenario === "backupFailure") throw new Error("backup failed"); writes.push({ file, content }); },
      persistCardState(value) { if (scenario === "persistFailure") throw new Error("persist failed"); writes.push({ file: "cardstate", content: value.roleCards }); },
      statePayload(value) { return value; }, sendJson(res, code, body) { response = { code, body }; }
    });
    const operation = vm.runInContext(`(async () => {${server.slice(start, end)}})()`, context);
    if (scenario.endsWith("Failure")) await assert.rejects(operation); else await operation;
    assert.deepEqual(state.conversation, ["keep"]); assert.equal(state.environment, "keep");
    if (scenario === "success") {
      assert.equal(response.code, 200); assert.equal(writes[0].content.roleCards, old); assert.equal(state.roleCards[0].id, "new");
    } else {
      assert.equal(state.roleCards, old);
      if (scenario === "invalid") { assert.equal(response.code, 400); assert.equal(writes.length, 0); }
    }
  }
});
