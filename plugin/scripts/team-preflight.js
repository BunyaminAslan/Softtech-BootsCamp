#!/usr/bin/env node
// team-preflight.js — agent team başlatılmadan önce ortam, plugin ve proje katmanı kontrolü.
//
// Kullanım (proje kökünde): node "<plugin-kökü>/scripts/team-preflight.js" [--json] [--project <dizin>]
//   tech-lead ilk [SPAWN-REQUEST]'ten, /agent-team:team ve /agent-team:setup-project kendi
//   akışlarında çalıştırır. Ajan gövdelerinde yol ${CLAUDE_PLUGIN_ROOT} ile verilir.
// Çıktı: her kontrol için PASS / WARN / FAIL satırı, en sonda "PREFLIGHT: <sonuç>".
// Exit: 0 = PASS veya yalnızca WARN, 1 = en az bir FAIL.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));
const sbLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "sandbox"));
const layerLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "layer"));
const browserLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "browser"));
const profLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "profile"));

const argv = process.argv.slice(2);
const argProject = argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : null;

function gitRoot(dir) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const PROJECT = path.resolve(argProject || process.env.CLAUDE_PROJECT_DIR || gitRoot(process.cwd()) || process.cwd());

const results = [];
const add = (level, msg) => results.push({ level, msg });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; } };

function frontmatter(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? m[1] : "";
}
const fmList = (fm, key) => {
  const line = (new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm) || [])[1];
  return line ? line.split(",").map((t) => t.trim()).filter(Boolean) : null;
};

// ---------------------------------------------------------------- 1. Plugin ajanları
const { config, source, error: cfgError } = cfgLib.loadConfig(PROJECT);
const MEMBER_TOOLS = ["SendMessage", "TaskGet", "TaskList", "TaskUpdate"];

for (const [role, agent] of Object.entries(cfgLib.AGENT_BY_ROLE)) {
  const enabled = config.roles[role] ? config.roles[role].enabled : true;
  const file = path.join(PLUGIN_ROOT, "agents", agent + ".md");
  if (!fs.existsSync(file)) {
    add(role === "lead" ? "FAIL" : enabled ? "FAIL" : "WARN", `${role}: plugin'de agents/${agent}.md yok`);
    continue;
  }
  const fm = frontmatter(file);
  const tools = fmList(fm, "tools");
  const disallowed = fmList(fm, "disallowedTools") || [];
  if (tools) {
    const need = role === "lead" ? [...MEMBER_TOOLS, "TaskCreate"] : MEMBER_TOOLS;
    const missing = need.filter((t) => !tools.includes(t));
    if (missing.length) add("FAIL", `${role}: tools allowlist'inde eksik: ${missing.join(", ")} (takımla haberleşemez)`);
    else add("WARN", `${role}: tools allowlist'i var; projenin MCP araçları bu role ulaşmaz`);
  }
  if (!disallowed.includes("Agent")) add("WARN", `${role}: disallowedTools içinde Agent yok (guard yine de engeller)`);
  if (/^hooks:/m.test(fm)) add("WARN", `${role}: frontmatter hooks: plugin ajanlarında yok sayılır; guard hooks.json'dan çalışır`);
  if (/^memory:/m.test(fm)) add("WARN", `${role}: frontmatter memory: hafızayı .claude/agent-memory/'ye yazar; proje katmanı kullanılmalı`);

  const override = path.join(PROJECT, ".claude", "agents", agent + ".md");
  if (fs.existsSync(override)) {
    add("WARN", `${role}: projede .claude/agents/${agent}.md override'ı var; plugin sürümü yerine o kullanılır ve içindeki \${CLAUDE_PLUGIN_ROOT} çözülmez`);
  }
}
add("PASS", `plugin ajanları kontrol edildi (${PLUGIN_ROOT})`);

// ---------------------------------------------------------------- 2. Node
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) add("FAIL", `node ${process.versions.node}: en az 20 gerekir`);
else if (major < 22) add("WARN", `node ${process.versions.node}: 22+ önerilir`);
else add("PASS", `node ${process.versions.node} (${process.execPath})`);
if (process.platform === "linux" && /^\/mnt\/[a-z]\//.test(process.execPath)) {
  add("FAIL", "WSL içinde Windows Node'u kullanılıyor; WSL'e Linux Node'u kurun");
}

// ---------------------------------------------------------------- 3. Proje katmanı
const layer = path.join(PROJECT, cfgLib.LAYER_DIR);
if (!fs.existsSync(layer)) {
  add("FAIL", `${cfgLib.LAYER_DIR}/ yok; önce /agent-team:setup-project çalıştırın`);
} else {
  if (cfgError) add("FAIL", cfgError + " (guard takım rollerini engeller)");
  else add("PASS", `team.json ${source === "file" ? "geçerli" : "yok, varsayılanlar kullanılıyor"}`);
  const ls = layerLib.layerStatus(PROJECT);
  if (ls.status === "outdated") add("WARN", `katman sürümü ${ls.version}, güncel ${ls.current}: yeni alanlar varsayılanlarla çalışır; yükseltmek için setup-project --upgrade (önce --dry-run)`);
  else if (ls.status === "current") add("PASS", `katman sürümü ${ls.version} (güncel)`);
  const ev = config.evidence;
  add("PASS", `kanıt kaydı: ${ev.mode} (${ev.mode === "warn" ? "kanıtsız kapanış engellenmez, uyarı verilir" : "kanıtsız kapanış engellenir"}; kanıt en fazla ${ev.maxAgeHours} saatlik)`);
  const mr = Object.entries(config.models.roles).map(([r, m]) => `${r}=${m}`).join(", ");
  const mt = Object.entries(config.models.tasks).map(([t, m]) => `[${t}]=${m}`).join(", ");
  add("PASS", `özerklik: ${config.autonomy}; modeller: ${mr || "ajan dosyalarındaki"}${mt ? `; görev etiketleri: ${mt}` : ""}`);
  const dz = config.design;
  if (dz.gate === "off") add("WARN", "tasarım kapısı kapalı (design.gate: off): UI görevleri ekran görüntüsü ve inceleme olmadan kapanır");
  else {
    add("PASS", `tasarım kapısı: ${dz.gate}; eşik ${dz.minScore}/10; varyantlar ${dz.variants.join(", ")}; incelemeler ${dz.reviews}`);
    if (!fs.existsSync(path.join(PROJECT, dz.reviews, "_TEMPLATE.md"))) add("WARN", `${dz.reviews}_TEMPLATE.md yok (setup-project kopyalar)`);
  }
  // Playwright MCP (plugin .mcp.json: --browser chromium) Playwright'ın kendi Chromium'unu ister
  const pw = browserLib.playwrightChromium();
  if (pw.installed) add("PASS", `Playwright Chromium kurulu (${pw.dir})`);
  else add("WARN", `Playwright Chromium yok (${pw.dir}): Playwright MCP ekran görüntüsü alamaz (tasarım kapısı K8, tester E2E, lead URL incelemesi). Kurulum: ${pw.hint}`);
  // MCP sunucusunu gerçekten başlat: ilk npx indirmesi Claude Code'un MCP zaman aşımını (30 sn) aşınca npm kurulumu
  // yarıda kesilir ve önbellek bozuk kalır; sunucu o andan sonra her açılışta çöker (canlı test, 0.11.4).
  // Testlerde (node --test) ve AGENT_TEAM_PREFLIGHT_NO_MCP=1 ile atlanır.
  if (!process.env.NODE_TEST_CONTEXT && process.env.AGENT_TEAM_PREFLIGHT_NO_MCP !== "1") mcpProbe();
  if (config.autonomy === "autonomous") add("WARN", "özerklik autonomous: lead plan onayından sonra kritik kararları da sormadan verip raporlar (commit/push/deploy yine sizin)");
  for (const f of ["project.md", "rules.md"]) {
    if (!fs.existsSync(path.join(layer, f))) add("WARN", `${cfgLib.LAYER_DIR}/${f} yok`);
  }
  const pm = fs.existsSync(path.join(layer, "project.md")) ? fs.readFileSync(path.join(layer, "project.md"), "utf8") : "";
  // `<doldur>` (ters tırnak içinde) açıklama metnidir, alan değildir
  const emptyLines = pm.split(/\r?\n/).map((l, i) => [i + 1, l]).filter(([, l]) => /(?<!`)<doldur>(?!`)|TODO: doldur/i.test(l)).map(([n]) => n);
  if (emptyLines.length) add("WARN", `project.md içinde doldurulmamış alanlar var (<doldur>; satır ${emptyLines.join(", ")})`);
  for (const [role, rc] of Object.entries(config.roles)) {
    if (!rc.enabled) continue;
    if (!fs.existsSync(path.join(layer, "agents", role))) add("WARN", `${cfgLib.LAYER_DIR}/agents/${role}/ yok (hafıza/worklog yeri)`);
  }
  for (const p of profLib.profileStatus(PROJECT, config)) {
    if (!p.file) add("FAIL", `${p.role}: profil '${p.name}' bulunamadı (profiles/${p.role}/${p.name}.md veya ${cfgLib.LAYER_DIR}/profiles/${p.name}.md)`);
    else if (!p.valid) add("WARN", `${p.role}: profil '${p.name}' geçersiz (${p.errors.join("; ")}); ağ izinleri eklenmez. Düzeltin veya team.json'da "profile": null yapıp profilsiz devam edin`);
    else add("PASS", `${p.role}: profil ${p.name} (${p.source === "project" ? "proje" : "plugin"})${p.warnings.length ? "; uyarı: " + p.warnings.join("; ") : ""}`);
  }
}

// ---------------------------------------------------------------- 3b. Özel roller (team.json > roles)
for (const [role, rc] of Object.entries(config.roles)) {
  if (!rc.custom || !rc.enabled) continue;
  const [plugin, name] = rc.agent.includes(":") ? rc.agent.split(":") : [null, rc.agent];
  const candidates = plugin === "agent-team"
    ? [path.join(PLUGIN_ROOT, "agents", name + ".md")]
    : plugin ? [] : [path.join(PROJECT, ".claude", "agents", name + ".md"), path.join(os.homedir(), ".claude", "agents", name + ".md")];
  const file = candidates.find((f) => fs.existsSync(f));
  if (plugin && plugin !== "agent-team") {
    add("WARN", `${role} (özel, ${rc.kind}): ajan '${rc.agent}' başka bir plugin'den; varlığı doğrulanamadı (claude plugin list)`);
  } else if (!file) {
    add("FAIL", `${role} (özel, ${rc.kind}): ajan dosyası bulunamadı: ${candidates.map((c) => path.relative(PROJECT, c) || c).join(" veya ")}. Şablon: ${path.join(PLUGIN_ROOT, "templates", "agents", "custom-role.md")}`);
  } else {
    const text = fs.readFileSync(file, "utf8");
    const fm = frontmatter(file);
    const disallowed = fmList(fm, "disallowedTools") || [];
    const problems = [];
    if (!disallowed.includes("Agent")) problems.push("disallowedTools içinde Agent yok (guard yine de engeller)");
    if (!/TEAM_RULES\.md/.test(text)) problems.push("TEAM_RULES.md'yi okumuyor");
    if (!new RegExp(`${cfgLib.LAYER_DIR}/agents/${role}/`).test(text)) problems.push(`hafıza/worklog yeri (${cfgLib.LAYER_DIR}/agents/${role}/) geçmiyor`);
    if (problems.length) add("WARN", `${role} (özel, ${rc.kind}): ${path.relative(PROJECT, file) || file}: ${problems.join("; ")}`);
    else add("PASS", `${role} (özel, ${rc.kind}): ajan ${rc.agent} bulundu`);
  }
}

// ---------------------------------------------------------------- 4. Guard (gerçek hook girdisiyle)
const guardSh = path.join(PLUGIN_ROOT, "hooks", "guard.sh");
const shCheck = spawnSync("sh", ["-c", "command -v node"], { encoding: "utf8" });
if (shCheck.status !== 0) {
  add("FAIL", "hook kabuğunda (sh) node bulunamıyor; guard agent çağrılarını engelleyecek");
} else {
  const P = config.paths;
  const firstPath = (role, fallback) => ((config.roles[role] && config.roles[role].paths) || [])[0] || fallback;
  const probes = {
    lead: { deny: firstPath("backend", "backend/") + "probe.ts", allow: P.projectDocs + "STATUS.md" },
    // yasak yol: etkin bir başka rolün yolu (devre dışı rolün yolu gerçek bir sınırı ölçmez)
    backend: { deny: (() => { const r = ["web", "mobile"].find((x) => config.roles[x] && config.roles[x].enabled && (config.roles[x].paths || []).length) || "mobile"; return firstPath(r, r + "/"); })() + "probe.ts", allow: firstPath("backend", "backend/") + "probe.ts" },
    mobile: { deny: firstPath("backend", "backend/") + "probe.ts", allow: firstPath("mobile", "mobile/") + "probe.ts" },
    web: { deny: firstPath("backend", "backend/") + "probe.ts", allow: firstPath("web", "web/") + "probe.ts" },
    tester: { deny: firstPath("backend", "backend/") + "src/probe.ts", allow: P.testDocs + "PROBE.md" },
  };
  const call = (agentType, fp, agentId = "preflight-probe") => spawnSync("sh", [guardSh], {
    input: JSON.stringify({ agent_id: agentId, agent_type: agentType, tool_name: "Write", tool_input: { file_path: path.join(PROJECT, fp) }, cwd: PROJECT }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT },
    encoding: "utf8",
  }).status;
  // Özel roller: developer → başka geliştiricinin yolu yasak, kendi yolu serbest; diğerleri → izin listesi dışı yasak
  for (const [role, rc] of Object.entries(config.roles)) {
    if (!rc.custom) continue;
    const own = rc.paths[0] || `${cfgLib.LAYER_DIR}/agents/${role}/`;
    const other = cfgLib.devRoles(config).find((r) => r !== role && (config.roles[r].paths || []).length);
    probes[role] = {
      type: rc.agent,
      deny: rc.kind === "developer" ? (other ? config.roles[other].paths[0] + "probe.ts" : P.testDocs + "PROBE.md") : "agent-team-probe/probe.ts",
      allow: own + "PROBE.md",
    };
  }
  if (!cfgError) {
    for (const [role, probe] of Object.entries(probes)) {
      if (config.roles[role] && !config.roles[role].enabled) continue;
      const type = probe.type || "agent-team:" + cfgLib.AGENT_BY_ROLE[role];
      // Agent teams'te agent_type teammate adıdır ("backend"); ikisi de denenir
      const deny = call(type, probe.deny), allow = call(type, probe.allow);
      const nDeny = call(role, probe.deny), nAllow = call(role, probe.allow);
      if (deny === 2 && allow === 0 && nDeny === 2 && nAllow === 0) add("PASS", `guard ${role}: ${probe.deny} engellendi, ${probe.allow} serbest (ajan tipi ve teammate adıyla)`);
      else add("FAIL", `guard ${role}: beklenmeyen sonuç (tip: yasak→${deny}, serbest→${allow}; ad: yasak→${nDeny}, serbest→${nAllow}; beklenen 2/0)`);
    }
  }
  const unknown = spawnSync("sh", [guardSh], { input: JSON.stringify({ agent_id: "x", tool_name: "Write", tool_input: { file_path: "a" } }), encoding: "utf8" }).status;
  const mainCall = spawnSync("sh", [guardSh], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(PROJECT, "backend/x.ts") } }), encoding: "utf8" }).status;
  if (unknown === 2 && mainCall === 0) add("PASS", "guard: türü bilinmeyen agent engelleniyor, ana oturum serbest");
  else add("FAIL", `guard: fail-closed davranışı beklenmiyor (bilinmeyen→${unknown}, ana oturum→${mainCall})`);
}

// ---------------------------------------------------------------- 5. Claude Code ayarları
const settingsFiles = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(PROJECT, ".claude", "settings.json"),
  path.join(PROJECT, ".claude", "settings.local.json"),
];
let teamsOn = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1";
// Görev araçları (TaskCreate/TaskUpdate/TaskList/TaskGet) Claude Code v2.1.268+ sürümünde yalnızca eski
// modellerde (≤ Opus 4.7 / Sonnet 4.6 / Haiku 4.5) varsayılan açıktır; diğerlerinde opt-in gerekir.
// Ortak görev listesi, TaskCompleted kapısı ve STATUS.md bu araçlara dayanır.
const truthy = (v) => /^(1|true)$/i.test(String(v == null ? "" : v));
let todoOn = truthy(process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS);
let teammateMode = null;
for (const f of settingsFiles) {
  const s = readJson(f);
  if (!s) continue;
  if ("agent" in s) add("FAIL", `${f} içinde "agent" anahtarı var; kullanıcı önce ana oturumla konuşur, kaldırın`);
  if (s.env && s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1") teamsOn = true;
  if (s.env && truthy(s.env.CLAUDE_CODE_ENABLE_TODO_TOOLS)) todoOn = true;
  if (s.teammateMode) teammateMode = s.teammateMode;
}
if (teamsOn) add("PASS", "agent teams açık (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)");
else add("FAIL", "agent teams kapalı: ~/.claude/settings.json > env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = \"1\" ekleyin (PLUGIN.md)");
if (todoOn) add("PASS", "görev araçları açık (CLAUDE_CODE_ENABLE_TODO_TOOLS=1)");
else add("FAIL", "görev araçları (TaskCreate/TaskUpdate/TaskList) güncel modellerde varsayılan kapalı; görev listesi, TaskCompleted kapısı ve STATUS.md çalışmaz. settings.json > env.CLAUDE_CODE_ENABLE_TODO_TOOLS = \"1\" ekleyin ve oturumu yeniden başlatın (PLUGIN.md §2)");
if (teammateMode === "tmux" && spawnSync("sh", ["-c", "command -v tmux"]).status !== 0) {
  add("WARN", "teammateMode=tmux ama tmux bulunamadı (teammate'ler aynı terminalde, in-process çalışır)");
}

// ---------------------------------------------------------------- 5b. Sandbox (PLUGIN.md > 1.1)
(function checkSandbox() {
  const ps = sbLib.platformStatus();
  const eff = sbLib.effectiveSandbox(PROJECT);
  for (const e of eff.errors) add("WARN", `ayar dosyası okunamadı: ${e}`);
  if (!ps.supported) {
    add("WARN", `sandbox: ${ps.platform} desteklemiyor; takımın komutları yalnızca guard ile sınırlı. WSL2 önerilir (PLUGIN.md > 1.1)`);
    return;
  }
  if (!eff.enabled) {
    add("WARN", `sandbox kapalı${eff.enabledFrom ? ` (${eff.enabledFrom})` : ""}: ikinci savunma katmanı yok. Açmak için: setup-project (veya PLUGIN.md > 1.1)`);
    return;
  }
  if (ps.missing.length) {
    add("WARN", `sandbox açık ama bağımlılık eksik (${ps.missing.join(", ")}): Claude Code komutları SANDBOX'SIZ çalıştırır. Kurulum: ${ps.hint}`);
  } else add("PASS", `sandbox açık (${ps.platform})`);
  if (eff.allowUnsandboxedCommands !== false) add("WARN", "sandbox.allowUnsandboxedCommands false değil: engellenen komut sandbox dışında yeniden denenebilir");
  if (!eff.domains.length) add("WARN", "sandbox ağ izin listesi boş: paket yöneticilerinin her bağlantısı izin isteyecek (setup-project profillerden doldurur)");
  else {
    const required = sbLib.requiredSandbox(PROJECT, config);
    const missing = required.domains.filter((d) => !eff.domains.includes(d));
    if (missing.length) add("WARN", `sandbox ağ izinlerinde eksik alan adı (profil/team.json): ${missing.join(", ")}. setup-project'i yeniden çalıştırın`);
    else add("PASS", `sandbox ağ izinleri profillerle uyumlu (${eff.domains.length} alan adı)`);
  }
  if (eff.excludedCommands.length) add("WARN", `sandbox dışında çalışan komutlar: ${eff.excludedCommands.join(", ")} (guard yine çalışır, OS kısıtı yok)`);
})();

// ---------------------------------------------------------------- 6. Git ve konum
const hooksPath = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: PROJECT, encoding: "utf8" }).stdout.trim();
const hasPreCommit = fs.existsSync(path.join(PROJECT, ".githooks", "pre-commit"));
const drift = layerLib.githooksDrift(PROJECT);
if (drift.stale.length) add("WARN", `.githooks/${drift.stale.join(", .githooks/")} plugin şablonundan farklı (eski sürüm veya elle değiştirilmiş): setup-project --update-githooks`);
if (hasPreCommit && hooksPath === ".githooks") add("PASS", "pre-commit kontrolü bağlı (.githooks)");
else if (hasPreCommit) add("WARN", "`.githooks/pre-commit` var ama core.hooksPath ayarlı değil: git config core.hooksPath .githooks");
else add("WARN", "pre-commit kontrolü kurulu değil (opsiyonel; /agent-team:setup-project kurar)");
if (/^\/mnt\/[a-z]\//.test(PROJECT)) add("WARN", `proje /mnt/ üzerinde (${PROJECT}); WSL'de npm/test çok yavaşlar, Linux dosya sistemine taşıyın`);

// ---------------------------------------------------------------- Sonuç
const worst = results.some((r) => r.level === "FAIL") ? "FAIL" : results.some((r) => r.level === "WARN") ? "WARN" : "PASS";
if (argv.includes("--json")) {
  console.log(JSON.stringify({ result: worst, project: PROJECT, plugin: PLUGIN_ROOT, checks: results }, null, 2));
} else {
  console.log(`proje: ${PROJECT}`);
  for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.msg}`);
  console.log(`PREFLIGHT: ${worst}`);
}
process.exit(worst === "FAIL" ? 1 : 0);

function mcpProbe() {
  const mcp = readJson(path.join(PLUGIN_ROOT, ".mcp.json"));
  const srv = mcp && mcp.mcpServers && mcp.mcpServers.playwright;
  if (!srv) return;
  const pkg = (srv.args || []).find((a) => a.startsWith("@playwright/mcp")) || "@playwright/mcp";
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-team-preflight", version: "1" } } }) + "\n";
  const t0 = Date.now();
  const r = spawnSync(srv.command, srv.args || [], { input: init, encoding: "utf8", timeout: 120000, shell: process.platform === "win32", cwd: os.tmpdir() });
  const secs = Math.round((Date.now() - t0) / 1000);
  const out = String(r.stdout || "") + String(r.stderr || "");
  const prefetch = `npx -y ${pkg} --help (bir kez, önbelleğe indirir), sonra Claude Code'u yeniden başlatın`;
  if (/"serverInfo"/.test(out)) {
    if (secs > 25) add("WARN", `Playwright MCP başladı ama ${secs} sn sürdü; Claude Code'un MCP zaman aşımı (30 sn) aşılabilir. Bir sonraki açılış önbellekten hızlıdır; sürmezse env.MCP_TIMEOUT = "60000"`);
    else add("PASS", `Playwright MCP başlıyor (${secs} sn)`);
    return;
  }
  const broken = /ENOENT[\s\S]*?(\S*_npx[\/][0-9a-f]+)[\/]package\.json/i.exec(out);
  if (broken) add("WARN", `Playwright MCP başlamıyor: npx önbelleği bozuk (yarıda kalmış indirme). Klasörü silin: ${broken[1]} ; sonra ${prefetch}`);
  else if (r.error && r.error.code === "ETIMEDOUT") add("WARN", `Playwright MCP 120 sn'de yanıt vermedi (ağ/ilk indirme). Önceden indirin: ${prefetch}`);
  else add("WARN", `Playwright MCP başlamıyor (exit ${r.status}): ${out.trim().split(/\r?\n/).slice(-2).join(" | ").slice(0, 240)}`);
}
