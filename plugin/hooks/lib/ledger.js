// ledger.js — kanıt kaydı (TEAM_RULES K1) için ortak kütüphane.
//
// Takım rollerinin her Bash/PowerShell çağrısı, hook tarafından proje DIŞINDA bir kayda yazılır:
//   <dataDir>/ledger/<proje-anahtarı>/<agent_id>.jsonl      (agent başına dosya: paralel teammate'lerde çakışma yok)
//   <dataDir>/ledger/<proje-anahtarı>/project.json          (kaydın hangi projeye ait olduğu)
//   <dataDir>/ledger/<proje-anahtarı>/citations.json        (hangi kanıt hangi göreve atfedildi)
//   <dataDir>/ledger/<proje-anahtarı>/notices/<n>.json      (ajana / lead'e iletilecek kapanış uyarıları)
//
// Her satır bir önceki satırın hash'ini içerir (hash zinciri). Kimlik (L-xxxxxxxx) satırın hash'inin
// ilk 8 hex karakteridir; kimlik ile içerik birbirine bağlıdır. `verify` zincirdeki kırılmayı gösterir.
// Tam çıktı saklanmaz: son 2 KB (gizli bilgi kalıpları maskeli) + tam çıktının SHA-256'sı.
//
// Yalnızca Node'un yerleşik modülleri kullanılır.

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cfgLib = require("./team-config");

const RECORD_VERSION = 1;
const GENESIS = "0".repeat(64);
const ID_RE = /\bL-[0-9a-f]{8}\b/g;
const TAIL_BYTES = 2048;
const CMD_MAX = 2000;
const RETENTION_DAYS = 30;
const NOTICE_TTL_DAYS = 7;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- yerleşim
function normProjectPath(projectDir) {
  let p = path.resolve(projectDir).replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32") p = p.toLowerCase();
  return p;
}
const projectKey = (projectDir) => sha256(normProjectPath(projectDir)).slice(0, 16);
const ledgerRoot = () => path.join(cfgLib.dataDir(), "ledger");
const ledgerDir = (projectDir) => path.join(ledgerRoot(), projectKey(projectDir));
const agentFile = (dir, agentId) => path.join(dir, (agentId ? cfgLib.safeId(agentId) : "main") + ".jsonl");

// ---------------------------------------------------------------- gizlilik
const MASKS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[MASKED-PRIVATE-KEY]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [MASKED]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, "[MASKED]"],
  [/\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|connection[_-]?string|conn[_-]?str)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&|]+)/gi, "$1$2[MASKED]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi, "$1[MASKED]@"],
];
function mask(text) {
  let s = String(text == null ? "" : text);
  for (const [re, rep] of MASKS) s = s.replace(re, rep);
  return s;
}
function tail(text, bytes = TAIL_BYTES) {
  const buf = Buffer.from(String(text), "utf8");
  if (buf.length <= bytes) return String(text);
  return "…" + buf.subarray(buf.length - bytes).toString("utf8").replace(/^�+/, "");
}

// ---------------------------------------------------------------- hook girdisinden sonuç
/**
 * PostToolUse yalnızca başarılı çağrıda gelir (exit 0); PostToolUseFailure'da `error` "Exit code N" ile başlar.
 * @returns {{exit: number|null, result: "ok"|"fail"|"timeout"|"interrupted"|"background", output: string}}
 */
function outcome(input) {
  const ti = input.tool_input || {};
  const tr = input.tool_response && typeof input.tool_response === "object" ? input.tool_response : {};
  const stdOut = [tr.stdout, tr.stderr].filter((x) => typeof x === "string" && x).join("\n");
  if (ti.run_in_background || tr.backgroundTaskId || tr.backgroundTaskID || tr.background_task_id) {
    return { exit: null, result: "background", output: stdOut };
  }
  if (input.hook_event_name === "PostToolUseFailure") {
    const err = String(input.error || "");
    const m = /^\s*Exit code (-?\d+)/i.exec(err);
    if (input.is_interrupt) return { exit: m ? Number(m[1]) : null, result: "interrupted", output: err };
    if (m) return { exit: Number(m[1]), result: "fail", output: err };
    if (/timed out|timeout/i.test(err)) return { exit: null, result: "timeout", output: err };
    return { exit: null, result: "fail", output: err };
  }
  if (tr.interrupted) return { exit: null, result: "interrupted", output: stdOut };
  return { exit: 0, result: "ok", output: stdOut };
}

// ---------------------------------------------------------------- hash zinciri
function stable(obj) {
  return JSON.stringify(Object.keys(obj).sort().reduce((o, k) => ((o[k] = obj[k]), o), {}));
}
function hashOf(line) {
  const { id, hash, ...body } = line; // eslint-disable-line no-unused-vars
  return sha256(body.prev + "\n" + stable(body));
}

function readLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return [];
  }
  const out = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      out.push(JSON.parse(raw));
    } catch (_) {
      out.push({ __corrupt: raw.slice(0, 200) });
    }
  }
  return out;
}

function lastHash(file) {
  // Yalnızca dosyanın sonunu oku (kayıt büyüse de hızlı kalsın)
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (!size) return GENESIS;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const h = JSON.parse(lines[i]).hash;
        if (/^[0-9a-f]{64}$/.test(h)) return h;
      } catch (_) {}
    }
    return GENESIS;
  } catch (_) {
    return GENESIS;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function withLock(lockFile, fn) {
  const deadline = Date.now() + 3000;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockFile, "wx");
    } catch (e) {
      if (e.code !== "EEXIST") break;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > 10000) fs.unlinkSync(lockFile); // bayat kilit
      } catch (_) {}
      if (Date.now() > deadline) break; // kilitsiz devam: zincir çatallanırsa verify gösterir
      sleep(15);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
      try {
        fs.unlinkSync(lockFile);
      } catch (_) {}
    }
  }
}

/**
 * Bir kayıt satırı ekler ve tam satırı döndürür (id, hash dahil).
 * rec: { session, agent_id, agent_type, role, tool_use_id, tool, cmd, cwd, exit, ms, result, output }
 */
function append(projectDir, rec, now = Date.now()) {
  const dir = ledgerDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(dir, "project.json");
  if (!fs.existsSync(metaFile)) {
    fs.writeFileSync(metaFile, JSON.stringify({ path: normProjectPath(projectDir), created: new Date(now).toISOString() }));
    prune(RETENTION_DAYS, now); // yeni proje dizini açılırken eski kayıtları temizle (en iyi çaba)
  }
  const file = agentFile(dir, rec.agent_id);
  const output = String(rec.output || "");
  return withLock(file + ".lock", () => {
    const body = {
      v: RECORD_VERSION,
      t: new Date(now).toISOString(),
      session: rec.session || null,
      agent_id: rec.agent_id || null,
      agent_type: rec.agent_type || null,
      role: rec.role || null,
      tool_use_id: rec.tool_use_id || null,
      tool: rec.tool || null,
      cmd: mask(String(rec.cmd || "")).slice(0, CMD_MAX),
      cwd: rec.cwd || null,
      exit: rec.exit === undefined ? null : rec.exit,
      ms: typeof rec.ms === "number" ? Math.round(rec.ms) : null,
      result: rec.result,
      out_tail: mask(tail(output)),
      out_sha256: sha256(output),
      prev: lastHash(file),
    };
    const hash = hashOf(body);
    const line = { id: "L-" + hash.slice(0, 8), ...body, hash };
    fs.appendFileSync(file, JSON.stringify(line) + "\n");
    return line;
  });
}

// ---------------------------------------------------------------- okuma ve doğrulama
function agentFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

/** Bir dosyanın zincirini doğrular. @returns {{ok: boolean, count: number, problems: string[], valid: Set<string>}} */
function verifyFile(file) {
  const lines = readLines(file);
  const problems = [];
  const valid = new Set();
  let prev = GENESIS;
  let broken = false;
  lines.forEach((l, i) => {
    const where = `${path.basename(file)}:${i + 1}`;
    if (l.__corrupt) { problems.push(`${where} okunamıyor`); broken = true; return; }
    if (l.prev !== prev) { problems.push(`${where} (${l.id}) zincir kırık: önceki satırın hash'i tutmuyor`); broken = true; }
    const h = hashOf(l);
    if (h !== l.hash) { problems.push(`${where} (${l.id}) içerik değiştirilmiş: hash tutmuyor`); broken = true; }
    else if (l.id !== "L-" + h.slice(0, 8)) { problems.push(`${where} kimlik hash ile uyuşmuyor`); broken = true; }
    if (!broken) valid.add(l.id);
    prev = l.hash;
  });
  return { ok: problems.length === 0, count: lines.length, problems, valid };
}

/** Projedeki tüm kayıtlar (en yeni sonda). */
function all(projectDir) {
  const out = [];
  for (const f of agentFiles(ledgerDir(projectDir))) for (const l of readLines(f)) if (!l.__corrupt) out.push({ ...l, file: f });
  return out.sort((a, b) => String(a.t).localeCompare(String(b.t)));
}

/** Kimliğe göre kayıt; zincir durumu ile birlikte. @returns {null | {rec, chainOk: boolean}} */
function find(projectDir, id) {
  for (const f of agentFiles(ledgerDir(projectDir))) {
    const rec = readLines(f).find((l) => l.id === id);
    if (rec) return { rec, chainOk: verifyFile(f).valid.has(id) };
  }
  return null;
}

// ---------------------------------------------------------------- atıflar (bir kanıt tek göreve)
function citationsFile(projectDir) {
  return path.join(ledgerDir(projectDir), "citations.json");
}
function readCitations(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(citationsFile(projectDir), "utf8"));
  } catch (_) {
    return {};
  }
}
function cite(projectDir, ids, taskKey) {
  const file = citationsFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  withLock(file + ".lock", () => {
    const c = readCitations(projectDir);
    for (const id of ids) if (!c[id]) c[id] = { task: taskKey, t: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(c, null, 1));
  });
}

// ---------------------------------------------------------------- uyarılar (TaskCompleted → PostToolUse)
// TaskCompleted'ın ajana metin döndürme yolu yok (exit 0 çıktısı modele gitmez). Uyarı burada
// bekletilir; ajan tarafı hemen ardından gelen PostToolUse(TaskUpdate) ile, lead tarafı lead'in
// (veya ana oturumun) sonraki araç çağrısıyla iletilir.
function noticesDir(projectDir) {
  return path.join(ledgerDir(projectDir), "notices");
}
function addNotice(projectDir, notice, now = Date.now()) {
  const dir = noticesDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const n = { t: now, agentDelivered: false, leadDelivered: false, ...notice };
  const file = path.join(dir, `${now}-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify(n));
  return file;
}

/**
 * Çağırana ait bekleyen uyarıları alır ve teslim edildi olarak işaretler.
 * who: { agentId, role, isMain, taskCompletedId }  (taskCompletedId: TaskUpdate status=completed ise görev kimliği)
 */
function takeNotices(projectDir, who, now = Date.now()) {
  const dir = noticesDir(projectDir);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (_) {
    return [];
  }
  const texts = [];
  for (const f of files) {
    const file = path.join(dir, f);
    let n;
    try {
      n = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      continue;
    }
    if (now - n.t > NOTICE_TTL_DAYS * 86400000) { try { fs.unlinkSync(file); } catch (_) {} continue; }
    let changed = false;
    const target = n.target || {};
    const isAgent =
      (who.taskCompletedId != null && String(who.taskCompletedId) === String(target.task_id)) ||
      (target.agent_id ? who.agentId === target.agent_id : !!who.role && who.role === target.role);
    let gotAgentText = false;
    if (!n.agentDelivered && isAgent) {
      texts.push(n.agentText);
      n.agentDelivered = changed = gotAgentText = true;
    }
    if (!n.leadDelivered && (who.role === "lead" || who.isMain)) {
      if (!gotAgentText) texts.push(n.leadText); // görevi lead/ana oturum kendisi kapattıysa tek uyarı yeter
      n.leadDelivered = changed = true;
    }
    if (!changed) continue;
    try {
      if (n.agentDelivered && n.leadDelivered) fs.unlinkSync(file);
      else fs.writeFileSync(file, JSON.stringify(n));
    } catch (_) {}
  }
  return texts.filter(Boolean);
}

// ---------------------------------------------------------------- saklama süresi
function prune(days = RETENTION_DAYS, now = Date.now()) {
  const limit = now - days * 86400000;
  let removed = 0;
  let projects;
  try {
    projects = fs.readdirSync(ledgerRoot());
  } catch (_) {
    return 0;
  }
  for (const p of projects) {
    const dir = path.join(ledgerRoot(), p);
    for (const f of agentFiles(dir)) {
      try {
        if (fs.statSync(f).mtimeMs < limit) { fs.unlinkSync(f); removed++; }
      } catch (_) {}
    }
    try {
      if (agentFiles(dir).length === 0 && fs.statSync(dir).mtimeMs < limit) fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
  return removed;
}

// ---------------------------------------------------------------- test özeti
// "Sonuç: 42/42" gibi bir iddiayı çıktı sonundaki test özetiyle karşılaştırmak için (yalnızca uyarı).
const SUMMARY = [
  [/Tests:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(?:\d+ todo, )?(\d+) passed, (\d+) total/i, (m) => ({ passed: +m[2], failed: +(m[1] || 0), total: +m[3] })], // Jest
  [/Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| \d+ skipped)? \((\d+)\)/i, (m) => ({ passed: +m[2], failed: +(m[1] || 0), total: +m[3] })], // Vitest
  [/Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*\d+,\s*Total:\s*(\d+)/i, (m) => ({ passed: +m[2], failed: +m[1], total: +m[3] })], // dotnet test
  [/(?:=+ |^)(?:(\d+) failed, )?(\d+) passed(?:, \d+ \w+)* in [\d.]+s/im, (m) => ({ passed: +m[2], failed: +(m[1] || 0), total: null })], // pytest (-q dahil)
  [/\+(\d+)(?: ~\d+)?(?: -(\d+))?: (?:All tests passed|Some tests failed)/i, (m) => ({ passed: +m[1], failed: +(m[2] || 0), total: null })], // flutter/dart
  [/# pass (\d+)[\s\S]*?# fail (\d+)/i, (m) => ({ passed: +m[1], failed: +m[2], total: null })], // node --test (TAP)
  [/ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/i, (m) => ({ passed: +m[1], failed: +m[2], total: null })], // node --test (spec)
];
function testSummary(text) {
  const s = String(text || "");
  let best = null;
  for (const [re, fn] of SUMMARY) {
    const all = [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
    if (all.length) best = fn(all[all.length - 1]);
    if (best) break;
  }
  return best;
}

module.exports = {
  ID_RE,
  GENESIS,
  RETENTION_DAYS,
  projectKey,
  ledgerRoot,
  ledgerDir,
  mask,
  tail,
  outcome,
  append,
  all,
  find,
  verifyFile,
  agentFiles,
  readCitations,
  cite,
  addNotice,
  takeNotices,
  prune,
  testSummary,
};
