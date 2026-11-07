import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSupplement, readSupplementPresets } from "../src/supplement-presets.js";

test("supplement library validates records and preserves corrupt source files", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "supplement-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "supplement-presets.json");
  assert.deepEqual(readSupplementPresets(file), []);
  assert.deepEqual(validateSupplement({ name: " A ", text: "" }), { name: "A", text: "" });
  assert.throws(() => validateSupplement({ name: "", text: "x" }));
  assert.throws(() => validateSupplement({ name: "A", text: {} }));
  const preset = { id: "supplement_a", name: "A", text: "{{user}}" };
  fs.writeFileSync(file, JSON.stringify([preset]));
  assert.deepEqual(readSupplementPresets(file), [preset]);
  fs.writeFileSync(file, JSON.stringify([preset, preset]));
  assert.throws(() => readSupplementPresets(file));
  fs.writeFileSync(file, "corrupt");
  assert.throws(() => readSupplementPresets(file));
  assert.equal(fs.readFileSync(file, "utf8"), "corrupt");
});
