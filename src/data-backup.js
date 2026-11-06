import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { zipSync, unzipSync } from "./public/vendor/fflate.module.js";

export const DATA_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const MAX_FILES = 20000;
const INTERNAL = ".data-transfer";
const MARKER = ".time-tavern-data-backup.json";

function safeName(name) {
  if (!name || name.includes("\\") || name.includes(":" ) || /[\x00-\x1f]/.test(name) || name.startsWith("/")) throw new Error("備份包含不安全的路徑。");
  const pieces = name.split("/");
  if (pieces.some(p => !p || p === "." || p === ".." || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error("備份包含不安全的路徑。");
  if (pieces[0].toLowerCase() === INTERNAL) throw new Error("不能匯入內部還原控制目錄。");
  return pieces.join("/");
}

export function createDataArchive(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const files = Object.create(null);
  const directories = [], hashes = Object.create(null);
  let total = 0, count = 0;
  function walk(directory, prefix = "") {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!prefix && item.name === INTERNAL) continue;
      if (item.isSymbolicLink()) throw new Error("data 含符號連結，請先移除連結再備份。");
      const name = safeName(prefix + item.name);
      const full = path.join(directory, item.name);
      if (item.isDirectory()) { directories.push(name); walk(full, name + "/"); }
      else if (item.isFile()) {
        total += fs.statSync(full).size;
        if (total > MAX_EXPANDED || ++count > MAX_FILES) throw new Error("data 超過網頁備份上限（512 MB／20000 個檔案），請停服後手動備份。");
        const bytes = fs.readFileSync(full);
        files["data/" + name] = bytes;
        hashes[name] = crypto.createHash("sha256").update(bytes).digest("hex");
      } else throw new Error("data 包含不支援的特殊檔案。");
    }
  }
  walk(dataDir);
  files["data/" + MARKER] = Buffer.from(JSON.stringify({ format: "time-tavern-data", version: 1, directories, hashes }));
  const zip = Buffer.from(zipSync(files, { level: 1 }));
  if (zip.length > DATA_ARCHIVE_MAX_BYTES) throw new Error("壓縮檔超過 256 MB，請停服後手動備份。");
  return zip;
}

export function readDataArchive(bytes) {
  if (bytes.length < 22 || bytes.length > DATA_ARCHIVE_MAX_BYTES) throw new Error("請選擇有效且不超過 256 MB 的 ZIP 備份。");
  let total = 0, count = 0;
  const seen = new Set();
  const entries = unzipSync(new Uint8Array(bytes), { filter(entry) {
    if (entry.name.endsWith("/")) return false;
    const name = safeName(entry.name.startsWith("data/") ? entry.name.slice(5) : entry.name);
    const identity = name.toLowerCase();
    if (seen.has(identity)) throw new Error("備份有重複或大小寫衝突的路徑。");
    seen.add(identity);
    total += entry.originalSize;
    if (!Number.isSafeInteger(entry.originalSize) || total > MAX_EXPANDED || ++count > MAX_FILES + 1) throw new Error("備份解壓縮超過上限。");
    return true;
  } });
  const result = Object.create(null);
  let metadata = null;
  for (const [rawName, content] of Object.entries(entries)) {
    const name = safeName(rawName.startsWith("data/") ? rawName.slice(5) : rawName);
    if (name === MARKER) {
      const marker = JSON.parse(Buffer.from(content).toString("utf8"));
      if (marker.format !== "time-tavern-data" || marker.version !== 1) throw new Error("不支援的 data 備份版本。");
      metadata = marker;
    } else result[name] = Buffer.from(content);
  }
  if (!seen.has(MARKER) && !result["app-state.json"] && !result["cardstate.json"]) throw new Error("此 ZIP 不是 data 資料夾備份。");
  const directories = [];
  if (metadata?.directories) {
    if (!Array.isArray(metadata.directories) || metadata.directories.length > MAX_FILES) throw new Error("備份資料夾清單超過上限。");
    for (const directory of metadata.directories) {
      const name = safeName(directory);
      if (seen.has(name.toLowerCase())) throw new Error("備份資料夾與檔案衝突。");
      directories.push(name);
    }
  }
  if (metadata?.hashes) {
    if (typeof metadata.hashes !== "object" || Array.isArray(metadata.hashes) || Object.keys(metadata.hashes).length !== Object.keys(result).length) throw new Error("備份檔案清單不完整。");
    for (const [name, bytes] of Object.entries(result)) {
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== metadata.hashes[name]) throw new Error(`備份檔案校驗失敗：${name}`);
    }
  }
  Object.defineProperty(result, "directories", { value: directories });
  for (const name of ["app-state.json", "cardstate.json", "app-defaults.json", "novelai-defaults.json"]) {
    if (result[name]) {
      const value = JSON.parse(result[name].toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 格式無效。`);
    }
  }
  // A file must not also be a parent directory of another file.
  for (const name of Object.keys(result)) {
    const parts = name.toLowerCase().split("/"); parts.pop();
    while (parts.length) { if (seen.has(parts.join("/"))) throw new Error("備份內的檔案與資料夾路徑衝突。"); parts.pop(); }
  }
  return result;
}

export function stageDataArchive(dataDir, bytes) {
  readDataArchive(bytes);
  const internal = path.join(dataDir, INTERNAL);
  fs.mkdirSync(internal, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(internal).isSymbolicLink()) throw new Error("內部控制目錄不能是符號連結。");
  const pending = path.join(internal, "pending.zip");
  if (fs.existsSync(pending)) throw new Error("已有待還原備份，請先重啟伺服器。");
  const temporary = path.join(internal, "upload.tmp");
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, pending);
}

function replaceContents(dataDir, files) {
  const root = path.resolve(dataDir);
  for (const item of fs.readdirSync(root)) {
    if (item === INTERNAL) continue;
    const target = path.resolve(root, item);
    if (path.dirname(target) !== root) throw new Error("資料路徑超出 data。");
    fs.rmSync(target, { recursive: true, force: true });
  }
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.resolve(root, safeName(name));
    if (!target.startsWith(root + path.sep)) throw new Error("資料路徑超出 data。");
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { mode: 0o600 });
  }
  for (const name of files.directories || []) fs.mkdirSync(path.join(root, safeName(name)), { recursive: true, mode: 0o700 });
}

// Run before loading settings, state, bots or HTTP. Never rename the mount root.
export function applyPendingDataArchive(dataDir, envFile) {
  const internal = path.join(dataDir, INTERNAL);
  if (fs.existsSync(internal) && fs.lstatSync(internal).isSymbolicLink()) throw new Error("內部控制目錄不能是符號連結。");
  const pending = path.join(internal, "pending.zip");
  const journal = path.join(internal, "applying.json");
  if (fs.existsSync(journal)) {
    const name = JSON.parse(fs.readFileSync(journal, "utf8")).rollback;
    if (!/^before-restore-[0-9]+\.zip$/.test(name)) throw new Error("還原紀錄無效，已停止啟動。");
    replaceContents(dataDir, readDataArchive(fs.readFileSync(path.join(internal, name))));
    const oldEnv = path.join(internal, "previous-env");
    fs.writeFileSync(envFile, fs.existsSync(oldEnv) ? fs.readFileSync(oldEnv) : "", { mode: 0o600 });
    fs.unlinkSync(journal);
    throw new Error("偵測到中斷的 data 還原，已復原舊資料；請確認後再次啟動。");
  }
  if (!fs.existsSync(pending)) return false;
  const imported = readDataArchive(fs.readFileSync(pending));
  const name = `before-restore-${Date.now()}.zip`;
  fs.writeFileSync(path.join(internal, name), createDataArchive(dataDir), { mode: 0o600 });
  const previousEnv = path.join(internal, "previous-env");
  fs.writeFileSync(previousEnv, fs.existsSync(envFile) ? fs.readFileSync(envFile) : "", { mode: 0o600 });
  fs.writeFileSync(journal, JSON.stringify({ rollback: name }), { mode: 0o600 });
  try {
    replaceContents(dataDir, imported);
    // Write through the existing .env path, including single-file Docker bind mounts.
    fs.writeFileSync(envFile, imported["environment.env"] || "", { mode: 0o600 });
    fs.unlinkSync(pending);
    fs.unlinkSync(journal);
    return true;
  } catch (error) {
    replaceContents(dataDir, readDataArchive(fs.readFileSync(path.join(internal, name))));
    fs.writeFileSync(envFile, fs.readFileSync(previousEnv), { mode: 0o600 });
    fs.unlinkSync(journal);
    throw error;
  }
}
