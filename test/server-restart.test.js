import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { EventEmitter } from "node:events";
import { usesContainerRestart, restartEnvironment } from "../src/server-restart.js";

test("restart detects managed container mode with explicit overrides", () => {
  assert.equal(usesContainerRestart({}, () => false), false);
  assert.equal(usesContainerRestart({}, name => name === "/.dockerenv"), true);
  assert.equal(usesContainerRestart({ TIME_TAVERN_RESTART_MODE: "process" }, () => true), false);
  assert.equal(usesContainerRestart({ TIME_TAVERN_RESTART_MODE: "container" }, () => false), true);
});
test("restore restart drops old file environment but preserves externally supplied variables", () => {
  const initial = { PATH: "original", PORT: "3234" };
  const current = { ...initial, CHAT_API_KEY: "old secret" };
  assert.deepEqual(restartEnvironment(current, initial, true), initial);
  assert.deepEqual(restartEnvironment(current, initial, false), current);
});
test("native restart spawns once with clean env; container restart exits without spawning", () => {
  const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function scheduleServerRestart(");
  const end = source.indexOf("\nfunction withStateLock", start);
  for (const scenario of ["ready", "earlyExit", "container"]) {
    const container = scenario === "container";
    const timers = [], spawned = [], exits = [];
    const child = new EventEmitter();
    child.unref = () => {}; child.disconnect = () => {}; child.kill = () => {};
    const context = vm.createContext({
      restartScheduled: false, usesContainerRestart: () => container, restartEnvironment,
      startupEnvironment: { PATH: "original" }, process: { env: { PATH: "original", KEY: "old" }, execPath: "node", argv: ["node", "server.js"], cwd: () => "project", exit: code => exits.push(code) },
      __dirname: path.join("project", "src"), DATA_DIR: "data", path,
      fs: { mkdirSync() {}, openSync() { return 10; }, closeSync() {} },
      spawn(...args) { spawned.push(args); return child; },
      setTimeout(callback) { timers.push(callback); return { unref() {} }; },
      clearTimeout() {},
      clearDiscordLoginRetryTimer() {}, activeDiscordClient: null, activeQqBotClient: null,
      server: { close(callback) { callback(); } }, console: { error() {}, warn() {} }, safeText: String
    });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.scheduleServerRestart({ restoreData: true }), true);
    assert.equal(context.scheduleServerRestart(), false);
    timers.shift()();
    if (!container) {
      assert.equal(exits.length, 0, "parent must wait for child readiness");
      if (scenario === "ready") child.emit("message", { type: "time-tavern-ready" });
      else child.emit("exit", 1);
    }
    assert.equal(exits.length, 1);
    assert.equal(exits[0], scenario === "earlyExit" ? 1 : 0);
    assert.equal(spawned.length, container ? 0 : 1);
    if (!container) {
      assert.equal(spawned[0][2].env.KEY, undefined);
      assert.equal(spawned[0][1][0], path.join("project", "src", "index.js"));
      assert.equal(spawned[0][2].windowsHide, true);
      assert.equal(spawned[0][2].stdio[3], "ipc");
    }
  }
});
