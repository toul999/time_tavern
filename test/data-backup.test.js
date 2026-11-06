import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { zipSync, unzipSync } from "../src/public/vendor/fflate.module.js";
import { createDataArchive, readDataArchive, stageDataArchive, applyPendingDataArchive } from "../src/data-backup.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tavern-data-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, data: path.join(root, "data"), env: path.join(root, ".env") };
}

test("missing data exports an empty backup and can import into a nonexistent directory", t => {
  const f = fixture(t);
  const bytes = createDataArchive(f.data);
  assert.equal(Object.keys(readDataArchive(bytes)).length, 0);
  const target = path.join(f.root, "fresh");
  stageDataArchive(target, bytes);
  assert.equal(applyPendingDataArchive(target, f.env), true);
  assert.ok(fs.statSync(target).isDirectory());
  assert.equal(fs.readFileSync(f.env, "utf8"), "");
});

test("ZIP roundtrip includes binary/nested files and env; import is deferred until startup", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.data, "images"), { recursive: true });
  fs.mkdirSync(path.join(f.data, "empty"));
  fs.writeFileSync(path.join(f.data, "images", "sample.png"), Buffer.from([0, 255, 3, 4]));
  fs.writeFileSync(path.join(f.data, "environment.env"), "CHAT_API_KEY=new\n");
  fs.writeFileSync(path.join(f.data, "cardstate.json"), '{"roleCards":[]}');
  const archive = createDataArchive(f.data);
  fs.writeFileSync(path.join(f.data, "old.txt"), "old data");
  fs.writeFileSync(f.env, "CHAT_API_KEY=old\n");
  const originalRoot = fs.statSync(f.data).ino;
  stageDataArchive(f.data, archive);
  assert.ok(fs.existsSync(path.join(f.data, "old.txt")));
  assert.throws(() => stageDataArchive(f.data, archive), /待還原/);
  applyPendingDataArchive(f.data, f.env);
  assert.equal(fs.statSync(f.data).ino, originalRoot);
  assert.equal(fs.existsSync(path.join(f.data, "old.txt")), false);
  assert.equal(fs.readFileSync(f.env, "utf8"), "CHAT_API_KEY=new\n");
  assert.ok(fs.statSync(path.join(f.data, "empty")).isDirectory());
  assert.deepEqual(fs.readFileSync(path.join(f.data, "images", "sample.png")), Buffer.from([0,255,3,4]));
  const rollback = fs.readdirSync(path.join(f.data, ".data-transfer")).find(name => name.startsWith("before-restore"));
  assert.equal(readDataArchive(fs.readFileSync(path.join(f.data, ".data-transfer", rollback)))["old.txt"].toString(), "old data");
  assert.equal(applyPendingDataArchive(f.data, f.env), false);
});

test("rejects unsafe paths, duplicate names, invalid JSON and non-data ZIPs before staging", t => {
  const f = fixture(t);
  const binary = Buffer.from("{}");
  for (const contents of [
    { "data/../escape": binary }, { "data/C:/escape": binary }, { "data/.data-transfer/pending.zip": binary },
    { "data/A.json": binary, "data/a.json": binary }, { "data/cardstate.json": Buffer.from("broken") },
    { "unrelated.txt": binary }, { "data/cardstate.json": binary, "data/a": binary, "data/a/b": binary }
  ]) {
    const archive = zipSync(contents);
    assert.throws(() => stageDataArchive(f.data, archive));
    assert.equal(fs.existsSync(path.join(f.data, ".data-transfer", "pending.zip")), false);
  }
});

test("interrupted restore recovers rollback before the app loads and stops startup", t => {
  const f = fixture(t);
  fs.mkdirSync(f.data);
  fs.writeFileSync(path.join(f.data, "original.txt"), "original");
  const archive = createDataArchive(f.data);
  const internal = path.join(f.data, ".data-transfer"); fs.mkdirSync(internal);
  fs.writeFileSync(path.join(internal, "before-restore-123.zip"), archive);
  fs.writeFileSync(path.join(internal, "previous-env"), "KEY=original");
  fs.writeFileSync(path.join(internal, "applying.json"), JSON.stringify({ rollback: "before-restore-123.zip" }));
  fs.unlinkSync(path.join(f.data, "original.txt"));
  fs.writeFileSync(path.join(f.data, "half-restored.txt"), "partial");
  assert.throws(() => applyPendingDataArchive(f.data, f.env), /復原舊資料/);
  assert.equal(fs.readFileSync(path.join(f.data, "original.txt"), "utf8"), "original");
  assert.equal(fs.existsSync(path.join(f.data, "half-restored.txt")), false);
  assert.equal(fs.readFileSync(f.env, "utf8"), "KEY=original");
});

test("changed binary payload fails integrity validation without touching existing data", t => {
  const f = fixture(t);
  fs.mkdirSync(f.data);
  fs.writeFileSync(path.join(f.data, "original.txt"), "original");
  const files = unzipSync(createDataArchive(f.data));
  files["data/original.txt"] = Buffer.from("tampered");
  assert.throws(() => stageDataArchive(f.data, zipSync(files)), /校驗失敗/);
  assert.equal(fs.readFileSync(path.join(f.data, "original.txt"), "utf8"), "original");
  assert.equal(fs.existsSync(path.join(f.data, ".data-transfer")), false);
});
