#!/usr/bin/env node
// setup-project.js — Bir ürün reposuna agent-team proje katmanını kurar.
//
// Kullanım (proje kökünde veya --project ile):
//   node "<plugin-kökü>/scripts/setup-project.js" [--project <dizin>] [--name <ad>]
//        [--githooks] [--update-githooks] [--init-git] [--no-sandbox] [--sandbox] [--upgrade] [--dry-run]
//
// Yaptıkları (var olan dosyanın ÜZERİNE YAZMAZ; atlananları raporlar):
//   1. AdditionalAgentInformation/ (project.md, rules.md, team.json, agents/<rol>/…) şablonlarını kopyalar
//   2. Docs/Project/ (VISION, STATUS, ARCHITECTURE) ve Docs/ADR/0000-template.md şablonlarını kopyalar
//      (yollar team.json > paths'e göre; team.json zaten varsa onun değerleri kullanılır)
//   3. --githooks: .githooks/pre-commit + review-cache.js kopyalar, core.hooksPath'i ayarlar
//      (başka bir hooksPath zaten ayarlıysa değiştirmez, uyarır). --update-githooks bu iki dosyayı yeniler.
//   4. .gitignore ve .gitattributes'a gereken satırları ekler (yoksa)
//   5. Sandbox: macOS, Linux ve WSL2'de .claude/settings.json'a sandbox bloğunu ve profillerden gelen
//      ağ izinlerini BİRLEŞTİRİR (var olan anahtar ezilmez; dosya bozuksa dokunulmaz). --no-sandbox atlar;
//      native Windows'ta yalnızca --sandbox verilirse yazar. Yeniden çalıştırmak eksik alan adlarını ekler.
//   6. --upgrade: proje katmanını güncel şema sürümüne yükseltir (lib/layer.js göçleri; yalnızca eksikleri
//      ekler, kullanıcı değerlerine dokunmaz). Eski katmanda --upgrade verilmezse yalnızca uyarır.
//   7. Sonunda team-preflight.js çalıştırır
// Exit: 0 başarılı (preflight WARN olabilir), 1 hata, 2 preflight FAIL.

"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TPL = path.join(PLUGIN_ROOT, "templates");
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));
const sbLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "sandbox"));
const layerLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "layer"));

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const DRY = flag("--dry-run");

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}
function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

// ---------------------------------------------------------------- hedef
let target = path.resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (!fs.existsSync(target)) fail(`Hedef dizin yok: ${target}`);
const top = git(["rev-parse", "--show-toplevel"], target);
if (top.status === 0) {
  target = path.resolve(top.stdout.trim());
} else if (flag("--init-git")) {
  if (!DRY && git(["init", "-q"], target).status !== 0) fail("git init başarısız");
  console.log(`🆕 git deposu oluşturuldu: ${target}`);
} else {
  fail(`${target} bir git deposu değil. Önce 'git init' yapın veya --init-git ekleyin.`);
}
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
if (inside(path.resolve(target), path.resolve(PLUGIN_ROOT)) || inside(path.resolve(PLUGIN_ROOT), path.resolve(target))) {
  fail("Hedef agent-team framework'ünün kendisi (veya onu içeren repo). Proje katmanı ürün reposuna kurulur; framework reposuna kurulmaz.");
}

const NAME = opt("--name") || path.basename(target);
const TODAY = new Date().toISOString().slice(0, 10);
const created = [], skipped = [], notes = [];

function writeIfMissing(rel, content, mode) {
  const dest = path.join(target, rel);
  if (fs.existsSync(dest)) { skipped.push(rel); return false; }
  if (!DRY) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    if (mode) fs.chmodSync(dest, mode);
  }
  created.push(rel);
  return true;
}
const render = (s) => s.replace(/\{\{PROJECT\}\}/g, NAME).replace(/\{\{DATE\}\}/g, TODAY);

function copyTree(srcDir, destRel) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const rel = path.posix.join(destRel, entry.name);
    if (entry.isDirectory()) copyTree(src, rel);
    else writeIfMissing(rel, render(fs.readFileSync(src, "utf8")));
  }
}

// ---------------------------------------------------------------- 1. proje katmanı
copyTree(path.join(TPL, "project", cfgLib.LAYER_DIR), cfgLib.LAYER_DIR);
if (!DRY && created.some((c) => c.endsWith("project.md"))) {
  const pm = path.join(target, cfgLib.LAYER_DIR, "project.md");
  fs.writeFileSync(pm, fs.readFileSync(pm, "utf8").replace("- **Proje adı:** <doldur>", `- **Proje adı:** ${NAME}`));
}

// ---------------------------------------------------------------- 2. proje dokümanları
const { config, error } = cfgLib.loadConfig(target);
if (error) notes.push(`⚠️ ${error} — doküman yolları için varsayılanlar kullanıldı.`);
const P = error ? cfgLib.DEFAULT_CONFIG.paths : config.paths;
for (const f of ["VISION.md", "STATUS.md", "ARCHITECTURE.md", "plan.example.json"]) {
  writeIfMissing(path.posix.join(P.projectDocs, f), render(fs.readFileSync(path.join(TPL, "project", "Docs", "Project", f), "utf8")));
}
writeIfMissing(path.posix.join(P.adr, "0000-template.md"), fs.readFileSync(path.join(TPL, "project", "Docs", "ADR", "0000-template.md"), "utf8"));
writeIfMissing(path.posix.join(P.projectDocs, "retros", "_TEMPLATE.md"), fs.readFileSync(path.join(TPL, "project", "Docs", "Project", "retros", "_TEMPLATE.md"), "utf8"));
const reviewsDir = error ? cfgLib.DEFAULT_CONFIG.design.reviews : config.design.reviews;
writeIfMissing(path.posix.join(reviewsDir, "_TEMPLATE.md"), fs.readFileSync(path.join(TPL, "project", "Docs", "Design", "reviews", "_TEMPLATE.md"), "utf8"));

// ---------------------------------------------------------------- 3. git hook'ları (isteğe bağlı)
if (flag("--githooks") || flag("--update-githooks")) {
  for (const f of ["pre-commit", "review-cache.js"]) {
    const rel = path.posix.join(".githooks", f);
    const content = fs.readFileSync(path.join(TPL, "githooks", f), "utf8");
    if (flag("--update-githooks") && fs.existsSync(path.join(target, rel))) {
      if (!DRY) fs.writeFileSync(path.join(target, rel), content);
      created.push(rel + " (güncellendi)");
    } else {
      writeIfMissing(rel, content, f === "pre-commit" ? 0o755 : undefined);
    }
  }
  const hp = git(["config", "--get", "core.hooksPath"], target).stdout.trim();
  if (!hp) {
    if (!DRY) git(["config", "core.hooksPath", ".githooks"], target);
    notes.push("git core.hooksPath = .githooks ayarlandı (bu klon için; her klonda tekrar gerekir).");
  } else if (hp !== ".githooks") {
    notes.push(`⚠️ core.hooksPath zaten '${hp}'; değiştirilmedi. pre-commit'i oraya taşıyın veya 'git config core.hooksPath .githooks' yapın.`);
  }
}

// ---------------------------------------------------------------- 4. .gitignore / .gitattributes
function ensureLines(rel, lines, header) {
  const file = path.join(target, rel);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (!missing.length) return;
  const block = (current && !current.endsWith("\n") ? "\n" : "") + (current ? "\n" : "") + header + "\n" + missing.join("\n") + "\n";
  if (!DRY) fs.writeFileSync(file, current + block);
  created.push(`${rel} (+${missing.length} satır)`);
}
ensureLines(".gitignore", [".precommit-cache/", ".claude/settings.local.json"], "# agent-team");
ensureLines(".gitattributes", [".githooks/* text eol=lf"], "# agent-team: hook betikleri her platformda LF");

// ---------------------------------------------------------------- 4b. katman sürümü (--upgrade)
const upgradeLines = [];
(function upgradeLayer() {
  const st = layerLib.layerStatus(target);
  if (st.status === "none") return;
  if (!flag("--upgrade")) {
    if (st.status === "outdated") upgradeLines.push(`⚠️ Katman sürümü ${st.version}, güncel ${st.current}. Yükseltmek için: setup-project --upgrade (önce --dry-run ile bakın)`);
    if (st.status === "newer") upgradeLines.push(`⚠️ Katman sürümü ${st.version} bu plugin'den yeni (en fazla ${st.current}); plugin'i güncelleyin`);
    return;
  }
  const plan = layerLib.planUpgrade(target);
  if (plan.error) { upgradeLines.push("❌ " + plan.error); return; }
  if (!plan.changes.length) { upgradeLines.push(`Katman güncel (v${plan.to}); değişiklik yok.`); return; }
  upgradeLines.push(`v${plan.from} → v${plan.to}${DRY ? " (dry-run: yazılmadı)" : ""}`, ...plan.steps.map((s) => "  " + s), ...plan.changes.map((c) => "  + " + c));
  if (!DRY) plan.apply();
  created.push(`${cfgLib.LAYER_DIR}/team.json (katman v${plan.from} → v${plan.to})`);
})();
const hooksDrift = layerLib.githooksDrift(target);
if (hooksDrift.stale.length && !flag("--update-githooks")) {
  notes.push(`⚠️ .githooks/${hooksDrift.stale.join(", .githooks/")} plugin şablonundan farklı (eski sürüm veya elle değiştirilmiş). Yenilemek için: setup-project --update-githooks`);
}

// ---------------------------------------------------------------- 5. sandbox (.claude/settings.json birleştirme)
// Plugin sandbox'ı kendisi açamaz. Var olan anahtarlar ezilmez, listeler birleştirilir; dosya bozuksa dokunulmaz.
const sandboxLines = [];
(function setupSandbox() {
  if (flag("--no-sandbox")) { sandboxLines.push("atlandı (--no-sandbox)"); return; }
  const ps = sbLib.platformStatus();
  if (!ps.supported && !flag("--sandbox")) {
    sandboxLines.push(`açılmadı: ${ps.platform} sandbox'ı desteklemiyor; komutlar sandbox'sız çalışır. Projeyi WSL2'de açıp setup-project'i orada yeniden çalıştırın (veya ayarı yine de yazmak için --sandbox).`);
    return;
  }
  const rel = path.posix.join(".claude", "settings.json");
  const file = path.join(target, rel);
  let existing = {};
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      sandboxLines.push(`⚠️ ${rel} okunamadı (${e.message}); dokunulmadı. Dosyayı düzeltip setup-project'i yeniden çalıştırın.`);
      return;
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      sandboxLines.push(`⚠️ ${rel} bir JSON nesnesi değil; dokunulmadı.`);
      return;
    }
  }
  const cfgForSandbox = error ? JSON.parse(JSON.stringify(cfgLib.DEFAULT_CONFIG)) : config;
  const required = sbLib.requiredSandbox(target, cfgForSandbox);
  let merged;
  try {
    merged = sbLib.mergeSettings(existing, required);
  } catch (e) {
    sandboxLines.push(`⚠️ ${e.message}; ${rel} dokunulmadı.`);
    return;
  }
  for (const i of required.invalid) sandboxLines.push(`⚠️ atlandı: ${i}`);
  if (!merged.changes.length) sandboxLines.push(`${rel}: sandbox ayarı zaten güncel`);
  else {
    if (!DRY) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(merged.settings, null, 2) + "\n");
    }
    created.push(`${rel} (sandbox: ${merged.changes.length} değişiklik)`);
    for (const c of merged.changes) sandboxLines.push("+ " + c);
  }
  for (const k of merged.kept) sandboxLines.push("= " + k);
  if (ps.missing.length) {
    sandboxLines.push(`⚠️ Sandbox bağımlılıkları eksik: ${ps.missing.join(", ")}. Kurulana kadar Claude Code komutları sandbox'sız çalıştırır.`);
    sandboxLines.push(`   Kurulum: ${ps.hint}   (ardından Claude Code oturumunu yeniden başlatın)`);
  } else if (ps.supported) sandboxLines.push(`platform: ${ps.platform}; bağımlılıklar tamam`);
})();

// ---------------------------------------------------------------- 5. özet + preflight
console.log(`\n📁 Proje: ${target}${DRY ? "  (dry-run: hiçbir şey yazılmadı)" : ""}`);
console.log(`\nOluşturulan (${created.length}):`);
for (const c of created) console.log("  + " + c);
if (skipped.length) {
  console.log(`\nZaten vardı, dokunulmadı (${skipped.length}):`);
  for (const s of skipped) console.log("  = " + s);
}
for (const n of notes) console.log("\n" + n);
if (upgradeLines.length) {
  console.log("\n⬆️  Katman sürümü (team.json > version):");
  for (const l of upgradeLines) console.log("  " + l);
}
if (sandboxLines.length) {
  console.log("\n🛡️  Sandbox (.claude/settings.json; PLUGIN.md > 1.1):");
  for (const l of sandboxLines) console.log("  " + l);
}

if (DRY) {
  // Ön kontrol diskteki duruma bakar; henüz yazılmamış dosyalar için yanıltıcı FAIL verirdi.
  console.log("\n🔎 Takım ön kontrolü: dry-run'da atlandı (kurulumdan sonra çalışır).");
  process.exit(0);
}
console.log("\n🔎 Takım ön kontrolü:");
const pf = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, "scripts", "team-preflight.js"), "--project", target], { stdio: "inherit" });
console.log(`
Sonraki adımlar:
  1. ${cfgLib.LAYER_DIR}/project.md içindeki <doldur> alanlarını doldurun (dil, yığın, komutlar, ortam).
  2. ${cfgLib.LAYER_DIR}/team.json: kullanılmayan rolleri "enabled": false yapın, profil seçin, klasörleri projeye göre düzeltin.
     Profil veya sandbox.allowedDomains değiştirdiyseniz bu betiği yeniden çalıştırın (yalnızca eksik ağ izinlerini ekler).
  3. Bu dosyaları siz commit edin.`);
process.exit(pf.status === 1 ? 2 : 0);
