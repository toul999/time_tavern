import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaults = JSON.parse(fs.readFileSync(path.join(root, "defaults/app-defaults.json"), "utf8"));

test("conversation prompt choices survive contexts, saved sessions, restart and data restore", { timeout: 60000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tavern-defaults-test-"));
  fs.cpSync(path.join(root, "src"), path.join(directory, "src"), { recursive: true });
  fs.cpSync(path.join(root, "defaults"), path.join(directory, "defaults"), {
    recursive: true, filter: (file) => !file.endsWith("gemini-argon-preset.json")
  });
  fs.copyFileSync(path.join(root, "package.json"), path.join(directory, "package.json"));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let server = spawn(process.execPath, ["src/index.js"], {
    cwd: directory, env: { PATH: process.env.PATH, HOME: directory, PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${server.exitCode}`);
    try { ready = (await fetch(`${base}/api/word-replacements`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, "test server must start");
  const get = async (url) => (await fetch(`${base}${url}`)).json();
  const send = async (url, method, body) => {
    const response = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.ok, true, `${url}: ${response.status}`);
    return response.json();
  };
  const before = await get("/api/state");
  assert.deepEqual(before.promptSelection, { mode: "", bodyRuleId: "" });
  const created = await send("/api/body-rule-presets", "POST", { name: "C", mainRules: "C-main", contextRules: "C-output" });
  const id = created.rule.id;
  let selected = await send("/api/prompt-selection", "PUT", { mode: "multi", bodyRuleId: id });
  assert.deepEqual(selected.promptSelection, { mode: "multi", bodyRuleId: id });
  assert.deepEqual(selected.roleCards, before.roleCards, "selection must not modify role cards");
  await send("/api/prompt-selection", "PUT", { mode: "single", bodyRuleId: id });
  assert.equal((await get("/api/state")).promptSelection.bodyRuleId, id, "mode changes retain C");
  const saved = await send("/api/sessions/save", "POST", { name: "Prompt test" });
  await send("/api/prompt-selection", "PUT", {});
  await send(`/api/sessions/${saved.session.id}/load`, "POST", {});
  assert.deepEqual((await get("/api/state")).promptSelection, { mode: "single", bodyRuleId: id });

  // Seed an isolated second context using the existing on-disk format.
  const contextsDir = path.join(directory, "data", "conversation-contexts");
  const localFile = path.join(contextsDir, "local.json");
  const local = JSON.parse(fs.readFileSync(localFile, "utf8"));
  assert.equal(local.snapshot.promptSelection.bodyRuleId, id);
  const discordId = "discord:123456789012345678";
  const appFile = path.join(directory, "data", "app-state.json");
  const app = JSON.parse(fs.readFileSync(appFile, "utf8"));
  server.kill("SIGTERM"); await once(server, "exit");
  app.conversationContextIndex[discordId] = { contextId: discordId, channelId: "123456789012345678", channelName: "isolated", updatedAt: new Date().toISOString() };
  fs.writeFileSync(appFile, JSON.stringify(app));
  const other = { ...local, contextId: discordId, snapshot: { ...local.snapshot } };
  delete other.snapshot.promptSelection; // Legacy context follows the card.
  fs.writeFileSync(path.join(contextsDir, "discord-123456789012345678.json"), JSON.stringify(other));
  async function restart() {
    server = spawn(process.execPath, ["src/index.js"], { cwd: directory,
      env: { PATH: process.env.PATH, HOME: directory, PORT: String(port), NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode !== null) throw new Error("Test server exited");
      try { if ((await fetch(`${base}/api/state`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Server not ready");
  }
  await restart();
  assert.deepEqual((await get("/api/state")).promptSelection, { mode: "single", bodyRuleId: id });
  const otherState = await send("/api/conversation-context", "PUT", { contextId: discordId });
  assert.deepEqual(otherState.state.promptSelection, { mode: "", bodyRuleId: "" });
  await send("/api/prompt-selection", "PUT", { mode: "multi", bodyRuleId: "" });
  const localState = await send("/api/conversation-context", "PUT", { contextId: "local" });
  assert.deepEqual(localState.state.promptSelection, { mode: "single", bodyRuleId: id });
  const changed = await send(`/api/body-rule-presets/${id}`, "PUT", { name: "C edited", mainRules: "C2-main", contextRules: "C2-output" });
  assert.equal(changed.bodyRulePresets[0].mainRules, "C2-main");
  const supplement = await send("/api/supplement-presets", "POST", { name: "Style A", text: "supplement A" });
  const supplementId = supplement.preset.id;
  assert.equal(supplement.state.userProfile.identityText, before.userProfile.identityText, "saving a collection must not apply it");
  await send("/api/user-profile", "PUT", { ...before.userProfile, identityText: "supplement A", supplementPresetId: supplementId });
  await send(`/api/supplement-presets/${supplementId}`, "PUT", { name: "Style A renamed", text: "supplement B" });
  assert.equal((await get("/api/state")).userProfile.identityText, "supplement A", "editing a preset must not silently change applied global text");
  const archive = await fetch(`${base}/api/data/export`);
  assert.equal(archive.status, 200);
  const zip = Buffer.from(await archive.arrayBuffer());
  await send(`/api/body-rule-presets/${id}`, "DELETE");
  await send(`/api/supplement-presets/${supplementId}`, "DELETE");
  assert.equal((await get("/api/state")).userProfile.identityText, "supplement A", "deleting a preset preserves applied text");
  assert.deepEqual((await get("/api/state")).bodyRulePresets, []);
  const restored = await fetch(`${base}/api/data/import`, { method: "POST", headers: { "content-type": "application/zip" }, body: zip });
  assert.equal(restored.status, 200);
  server.kill("SIGTERM"); await once(server, "exit"); await restart();
  const after = await get("/api/state");
  assert.equal(after.bodyRulePresets[0].mainRules, "C2-main");
  assert.deepEqual(after.promptSelection, { mode: "single", bodyRuleId: id });
  assert.equal(after.supplementPresets[0].name, "Style A renamed");
  assert.equal(after.supplementPresets[0].text, "supplement B");
  assert.equal(after.userProfile.identityText, "supplement A");
  assert.equal(after.userProfile.supplementPresetId, supplementId);
});
