#!/usr/bin/env node
// review-cache.js — pre-commit incelemesi için hunk bazlı önbellek.
//
// Amaç: Son incelemeden bu yana diff'te gerçekten değişen bir şey yoksa agent'ları
// baştan çalıştırmamak; bir şey değiştiyse yalnızca yeni/değişen hunk'ları incelettirmek.
//
// Kimlik: Her hunk "dosya yolu + hunk içeriği (+/- satırları)" ile hash'lenir. Satır
// numaraları (@@ başlığı) hash'e girmez; üstüne satır eklendiği için kayan ama içeriği
// aynı kalan değişiklik "değişmedi" sayılır. Diff her zaman HEAD'e göre alınır
// (staged: index-HEAD, working tree: worktree-HEAD), bu yüzden etkileşimli modda
// working tree'de incelenip sonra stage edilen değişiklik commit hook'unda tekrar
// incelenmez.
//
// Komutlar:
//   check [--scope staged|worktree] [--force]
//       Mevcut diff'i son kayıtla karşılaştırır, sonucu stdout'a yazar:
//         STATUS: UNCHANGED | PARTIAL | FULL
//       PARTIAL'da yalnızca yeni hunk'lar .precommit-cache/delta.patch dosyasına yazılır.
//       Ayrıca .precommit-cache/pending.json'a "incelenmek üzere olan" diff kaydedilir.
//       PRECOMMIT_FORCE=1 ortam değişkeni veya --force her zaman FULL döndürür.
//   save [--also <dosya>...]
//       Reviewer'ın .precommit-cache/last-report.md dosyasına yazdığı rapordaki
//       "Karar:" satırını okur ve pending.json'daki hunk'ları "incelendi" olarak kaydeder.
//       --also: reviewer'ın yazdığı/düzenlediği test dosyaları; bunların güncel hali de
//       incelenmiş sayılır (stage edildiklerinde tekrar incelenmez).
//   reset
//       Önbelleği siler; bir sonraki kontrol FULL olur.
//
// Önbellek klasörü .precommit-cache/ kendi .gitignore'unu içerir, depoya girmez.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const VERSION = 1;

function git(args, opts = {}) {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (!opts.allowFail && r.status !== 0 && !(opts.okStatus || []).includes(r.status)) {
    throw new Error(`git ${args.join(" ")} başarısız: ${r.stderr}`);
  }
  return r;
}

function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).stdout.trim();
}

function headInfo(root) {
  const r = git(["rev-parse", "--verify", "-q", "HEAD"], { cwd: root, allowFail: true });
  const head = r.status === 0 ? r.stdout.trim() : "NONE";
  let count = 0;
  if (head !== "NONE") count = Number(git(["rev-list", "--count", "HEAD"], { cwd: root }).stdout.trim());
  return { head, sprintDoc: `Docs/Sprint_${count + 1}.md` };
}

function cacheDir(root) {
  const dir = path.join(root, ".precommit-cache");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return dir;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);

// Bir dosyanın patch metnini meta + hunk listesine ayırır.
function parseFilePatch(filePath, text) {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const header = [];
  const hunks = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      cur = { at: line, body: [] };
      hunks.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      header.push(line);
    }
  }
  const entities = [];
  // Metin dosyasında içerik zaten hunk'larda; index satırı yalnızca binary için anlamlı
  const metaLines = header.filter(
    (l) =>
      !l.startsWith("diff --git ") &&
      !l.startsWith("--- ") &&
      !l.startsWith("+++ ") &&
      !(hunks.length > 0 && l.startsWith("index "))
  );
  if (metaLines.length > 0) {
    const t = metaLines.join("\n");
    entities.push({ path: filePath, kind: "meta", hash: sha(filePath + "\0meta\0" + t), text: t });
  }
  for (const h of hunks) {
    entities.push({ path: filePath, kind: "hunk", hash: sha(filePath + "\0hunk\0" + h.body.join("\n")), text: [h.at, ...h.body].join("\n") });
  }
  return { header: header.join("\n"), entities };
}

// Diff'i dosya bazında okur. scope: "staged" (index-HEAD) | "worktree" (worktree-HEAD)
function collectDiff(root, scope, excluded) {
  const hasHead = headInfo(root).head !== "NONE";
  const base = scope === "staged" ? ["diff", "--cached"] : hasHead ? ["diff", "HEAD"] : ["diff"];
  const common = ["-M", "--no-color", "--no-ext-diff", "--no-textconv"];

  const ns = git([...base, "--name-status", "-z", ...common], { cwd: root }).stdout.split("\0");
  const files = [];
  for (let i = 0; i < ns.length; ) {
    const st = ns[i++];
    if (!st) continue;
    if (st[0] === "R" || st[0] === "C") {
      const from = ns[i++];
      const to = ns[i++];
      files.push({ status: st, paths: [from, to], path: to });
    } else {
      const p = ns[i++];
      files.push({ status: st, paths: [p], path: p });
    }
  }

  const result = [];
  for (const f of files) {
    if (excluded.has(f.path)) continue;
    const patch = git([...base, "-U0", ...common, "--", ...f.paths], { cwd: root }).stdout;
    result.push({ path: f.path, status: f.status, ...parseFilePatch(f.path, patch) });
  }
  return result;
}

// Reviewer'ın yazdığı dosyaların güncel halini (HEAD'e göre) entity'lere çevirir.
function collectAlso(root, files) {
  const out = [];
  const nullDev = ["", "dev", "null"].join("/");
  for (const rel of files) {
    const p = rel.split("\\").join("/");
    if (!fs.existsSync(path.join(root, p))) continue;
    const tracked = git(["ls-files", "--error-unmatch", "--", p], { cwd: root, allowFail: true }).status === 0;
    const r = tracked
      ? git(["diff", "HEAD", "-U0", "--no-color", "--no-ext-diff", "--", p], { cwd: root, allowFail: true })
      : git(["diff", "--no-index", "-U0", "--no-color", "--", nullDev, p], { cwd: root, okStatus: [1] });
    if (r.stdout) out.push(...parseFilePatch(p, r.stdout).entities);
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function verdictFromReport(report) {
  const m = report.match(/^.*Karar:.*$/m);
  const line = m ? m[0].trim() : "";
  let code = "UNKNOWN";
  if (line.includes("COMMIT EDİLMEMELİ") || line.includes("❌")) code = "FAIL";
  else if (line.includes("DÜZELTMELERLE") || line.includes("⚠")) code = "WARN";
  else if (line.includes("COMMIT EDİLEBİLİR") || line.includes("✅")) code = "PASS";
  return { code, line };
}

function parseArgs(argv) {
  const args = { _: [], also: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scope") args.scope = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--also") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args.also.push(argv[++i]);
    } else args._.push(a);
  }
  return args;
}

function detectScope(root) {
  return git(["diff", "--cached", "--quiet"], { cwd: root, okStatus: [1] }).status === 1 ? "staged" : "worktree";
}

function cmdCheck(args) {
  const root = repoRoot();
  const dir = cacheDir(root);
  const { head, sprintDoc } = headInfo(root);
  const scope = args.scope || detectScope(root);
  const files = collectDiff(root, scope, new Set([sprintDoc]));
  const entities = files.flatMap((f) => f.entities);

  const pending = {
    version: VERSION,
    head,
    scope,
    createdAt: new Date().toISOString(),
    entities: entities.map((e) => ({ path: e.path, kind: e.kind, hash: e.hash })),
  };
  fs.writeFileSync(path.join(dir, "pending.json"), JSON.stringify(pending, null, 2));

  const state = readJson(path.join(dir, "state.json"));
  const reportPath = ".precommit-cache/last-report.md";
  const out = [];
  const emit = (status, reason) => {
    out.unshift("STATUS: " + status, "SCOPE: " + scope, "REASON: " + reason);
    console.log(out.join("\n"));
  };

  if (entities.length === 0) return emit("FULL", "İncelenecek diff yok (yalnızca sprint dokümanı değişmiş olabilir).");
  if (args.force || process.env.PRECOMMIT_FORCE === "1") return emit("FULL", "Zorla tam kontrol istendi (PRECOMMIT_FORCE=1 / --force).");
  if (!state || state.version !== VERSION) return emit("FULL", "Önceki kontrol kaydı yok.");
  if (state.head !== head) return emit("FULL", "Son kontrolden sonra HEAD değişmiş (yeni commit atılmış).");
  if (!fs.existsSync(path.join(root, reportPath))) return emit("FULL", "Önceki review raporu bulunamadı.");
  if (state.verdict === "UNKNOWN") return emit("FULL", "Önceki kontrolün kararı okunamamıştı.");

  // Multiset karşılaştırma (aynı içerikli iki hunk olabilir)
  const prev = new Map();
  for (const e of state.entities) prev.set(e.hash, (prev.get(e.hash) || 0) + 1);
  const added = [];
  for (const e of entities) {
    const n = prev.get(e.hash) || 0;
    if (n > 0) prev.set(e.hash, n - 1);
    else added.push(e);
  }
  const removedHashes = new Set([...prev].filter(([, n]) => n > 0).map(([h]) => h));
  const removed = state.entities.filter((e) => removedHashes.has(e.hash));

  out.push(
    "PREV_VERDICT_CODE: " + state.verdict,
    "PREV_VERDICT: " + state.verdictLine,
    "PREV_REPORT: " + reportPath,
    "PREV_CHECKED_AT: " + state.savedAt
  );

  const docMissing = !fs.existsSync(path.join(root, sprintDoc));

  if (added.length === 0 && removed.length === 0) {
    if (state.verdict !== "FAIL" && docMissing) {
      return emit("FULL", "Diff aynı ama " + sprintDoc + " bulunamadı; dokümantasyon için tam akış gerekiyor.");
    }
    return emit("UNCHANGED", "Son kontrolden bu yana diff'te değişiklik yok.");
  }

  // Yalnızca yeni hunk'ları delta.patch'e yaz
  const byPath = new Map();
  for (const e of added) {
    if (!byPath.has(e.path)) byPath.set(e.path, []);
    byPath.get(e.path).push(e);
  }
  const patch = [];
  for (const f of files) {
    const list = byPath.get(f.path);
    if (!list) continue;
    patch.push(f.header);
    for (const e of list) patch.push(e.kind === "meta" ? "# meta değişikliği:\n" + e.text : e.text);
    patch.push("");
  }
  fs.writeFileSync(path.join(dir, "delta.patch"), patch.join("\n"));

  out.push("DELTA_PATCH: .precommit-cache/delta.patch", "NEW_HUNKS: " + added.length, "CHANGED_FILES:");
  for (const [p, list] of byPath) out.push("  - " + p + " (" + list.length + " yeni/değişmiş hunk)");
  if (removed.length > 0) {
    out.push("REMOVED_HUNKS: " + removed.length + " (önceden incelenip artık diff'te olmayan; geri alınmış veya değiştirilmiş)", "REMOVED_FILES:");
    for (const p of new Set(removed.map((e) => e.path))) out.push("  - " + p);
  }
  if (docMissing) out.push("NOTE: " + sprintDoc + " bulunamadı; documenter dokümanı baştan yazmalı.");
  return emit("PARTIAL", "Son kontrolden sonra bazı hunk'lar değişmiş; yalnızca bunlar incelenmeli.");
}

function cmdSave(args) {
  const root = repoRoot();
  const dir = cacheDir(root);
  const pending = readJson(path.join(dir, "pending.json"));
  if (!pending) {
    console.error("pending.json yok; önce 'check' çalıştırılmalı.");
    process.exit(1);
  }
  const reportFile = path.join(dir, "last-report.md");
  if (!fs.existsSync(reportFile)) {
    console.error(".precommit-cache/last-report.md yok; reviewer raporu bu dosyaya yazmalı.");
    process.exit(1);
  }
  if (pending.head !== headInfo(root).head) {
    console.error("check'ten sonra HEAD değişmiş; kayıt yapılmadı.");
    process.exit(1);
  }
  const { code, line } = verdictFromReport(fs.readFileSync(reportFile, "utf8"));

  const alsoEntities = collectAlso(root, args.also).map((e) => ({ path: e.path, kind: e.kind, hash: e.hash }));
  const alsoPaths = new Set(alsoEntities.map((e) => e.path));
  const entities = [...pending.entities.filter((e) => !alsoPaths.has(e.path)), ...alsoEntities];

  const state = { version: VERSION, head: pending.head, savedAt: new Date().toISOString(), verdict: code, verdictLine: line, entities };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
  const warn = code === "UNKNOWN" ? " (raporda 'Karar:' satırı okunamadı; bir sonraki kontrol FULL olacak)" : "";
  console.log("SAVED: " + entities.length + " hunk kaydedildi. Karar: " + code + warn);
}

function cmdReset() {
  const dir = path.join(repoRoot(), ".precommit-cache");
  for (const f of ["state.json", "pending.json", "delta.patch"]) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch (_) {}
  }
  console.log("Önbellek sıfırlandı; bir sonraki kontrol FULL olacak.");
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  if (cmd === "check") cmdCheck(args);
  else if (cmd === "save") cmdSave(args);
  else if (cmd === "reset") cmdReset();
  else {
    console.error("Kullanım: node .githooks/review-cache.js check [--scope staged|worktree] [--force] | save [--also <dosya>...] | reset");
    process.exit(1);
  }
} catch (err) {
  console.error("review-cache hata: " + err.message);
  process.exit(1);
}
