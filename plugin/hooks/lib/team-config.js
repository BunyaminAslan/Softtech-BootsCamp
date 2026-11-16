// team-config.js — agent-team hook'ları ve betiklerinin ortak yardımcıları.
//
// 1) Rol tespiti: hook girdisindeki agent_type ("agent-team:senior-backend-developer" veya
//    projede override edilmişse "senior-backend-developer") → takım rolü (backend …).
//    agent_type yoksa ama agent_id varsa, SubagentStart hook'unun tuttuğu kayıttan bulunur.
// 2) Proje katmanı: <proje>/AdditionalAgentInformation/team.json okunur, varsayılanlarla
//    birleştirilir ve doğrulanır. Dosya yoksa varsayılanlar kullanılır; dosya bozuksa
//    `error` döner (guard bu durumda takım rollerini fail-closed engeller).
//
// Bu dosya yalnızca Node'un yerleşik modüllerini kullanır; bağımlılık yoktur.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const LAYER_DIR = "AdditionalAgentInformation";
const CONFIG_FILE = "team.json";

// agent dosya adı (frontmatter name) → takım rolü
const ROLE_BY_AGENT = {
  "tech-lead": "lead",
  "senior-backend-developer": "backend",
  "senior-mobile-developer": "mobile",
  "senior-web-developer": "web",
  "senior-tester": "tester",
};
const AGENT_BY_ROLE = Object.fromEntries(Object.entries(ROLE_BY_AGENT).map(([a, r]) => [r, a]));
const TEAM_ROLES = Object.values(ROLE_BY_AGENT);
const DEV_ROLES = ["backend", "mobile", "web"]; // alan sahipliği olan geliştirici rolleri

const DEFAULT_CONFIG = Object.freeze({
  version: 5, // katman şeması sürümü (LAYER_VERSION); eski katmanlar setup-project --upgrade ile yükseltilir
  roles: {
    lead: { enabled: true },
    backend: { enabled: true, profile: null, paths: ["backend/"] },
    mobile: { enabled: true, profile: null, paths: ["mobile/", "Docs/Mobile/"] },
    web: { enabled: true, profile: null, paths: ["web/", "Docs/Web/"] },
    tester: { enabled: true, profile: null, paths: [] },
  },
  paths: {
    contract: "Docs/Contracts/",
    projectDocs: "Docs/Project/",
    adr: "Docs/ADR/",
    testDocs: "Docs/Test/",
  },
  protected: [],
  // Kanıt kaydı (TEAM_RULES K1): "warn" kanıtsız kapanışı engellemez, ciddi uyarı verir;
  // "enforce" engeller; "strict" ayrıca yalnızca project.md > Komutlar tablosundaki komutları kanıt sayar.
  evidence: { mode: "warn", maxAgeHours: 24 },
  // Projeye özel sandbox ağ izinleri; setup-project bunları .claude/settings.json'a ekler.
  sandbox: { allowedDomains: [] },
  // lead'in kullanıcıya ne zaman durup soracağı (MustToHave madde 7): supervised | checkpoint | autonomous
  autonomy: "checkpoint",
  // Teammate modeli (madde 11): roles.<rol> spawn anındaki model; tasks.<ETİKET> lead'in o işe ayrı üye açarken
  // kullanacağı model. Boşsa ajan dosyasındaki model geçerlidir. Değer: opus | sonnet | haiku | inherit | claude-…
  models: { roles: {}, tasks: {} },
  // Tasarım kapısı (madde 10): "UI: evet" işaretli görev, ekran görüntülü ve puanlı bir inceleme dosyasıyla kapanır.
  // gate: off | warn (kapanır, uyarır) | enforce (engeller). variants: zorunlu ekran görüntüsü varyantları.
  design: { gate: "warn", minScore: 8, variants: ["mobile-light", "mobile-dark", "desktop-light", "desktop-dark"], reviews: "Docs/Design/reviews/" },
});
const DESIGN_GATES = ["off", "warn", "enforce"];
const AUTONOMY_LEVELS = ["supervised", "checkpoint", "autonomous"];
const MODEL_RE = /^(opus|sonnet|haiku|inherit|claude-[a-z0-9.-]+)$/;
// Alan adı: "registry.npmjs.org", "*.example.com", isteğe bağlı ":port"
const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]+(:\d{1,5})?$|^localhost(:\d{1,5})?$/i;
const EVIDENCE_MODES = ["warn", "enforce", "strict"];
const LAYER_VERSION = 5; // proje katmanı şema sürümü; lib/layer.js göçleri buna kadar getirir
const MIN_LAYER_VERSION = 1;

/** "agent-team:senior-backend-developer" → "senior-backend-developer" */
function agentBaseName(agentType) {
  const s = String(agentType || "");
  return s.slice(s.lastIndexOf(":") + 1);
}

function roleFromAgentType(agentType) {
  return ROLE_BY_AGENT[agentBaseName(agentType)] || null;
}

// ---------------------------------------------------------------- agent_id → agent_type kaydı
/** Plugin'in kalıcı veri dizini (hook'larda CLAUDE_PLUGIN_DATA dolu gelir). */
function dataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "agent-team");
}
function registryDir() {
  return path.join(dataDir(), "agent-registry");
}
const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);

function registerAgent(agentId, agentType) {
  if (!agentId || !agentType) return;
  const dir = registryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safeId(agentId) + ".json"), JSON.stringify({ agent_type: agentType, at: Date.now() }));
}

function lookupAgent(agentId) {
  if (!agentId) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(registryDir(), safeId(agentId) + ".json"), "utf8")).agent_type || null;
  } catch (_) {
    return null;
  }
}

/**
 * Hook girdisinden çağıranı belirler.
 * @returns {{kind: "main"|"agent"|"unknown-agent", agentType: string|null, role: string|null}}
 *   main           → ana oturum (agent_id ve agent_type yok)
 *   agent          → agent_type biliniyor (role takım rolü değilse null)
 *   unknown-agent  → agent_id var ama türü bulunamadı
 */
function identifyCaller(input, config) {
  let agentType = input.agent_type || null;
  if (!agentType && input.agent_id) agentType = lookupAgent(input.agent_id);
  if (agentType) return { kind: "agent", agentType, role: roleFor(agentType, config) };
  if (input.agent_id) return { kind: "unknown-agent", agentType: null, role: null };
  return { kind: "main", agentType: null, role: null };
}

// ---------------------------------------------------------------- team.json
function normDir(p) {
  let s = String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!s.endsWith("/") && !/\.[a-z0-9]+$/i.test(s.split("/").pop())) s += "/";
  return s;
}

function validRelPath(p) {
  const s = String(p).replace(/\\/g, "/");
  return s.length > 0 && !s.startsWith("/") && !/^[a-zA-Z]:/.test(s) && !s.split("/").includes("..");
}

/**
 * @returns {{config: object, source: "default"|"file", file: string, error: string|null}}
 */
function loadConfig(projectDir) {
  const file = path.join(projectDir, LAYER_DIR, CONFIG_FILE);
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!fs.existsSync(file)) return { config: finalize(base), source: "default", file, error: null };

  let user;
  try {
    user = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { config: finalize(base), source: "file", file, error: `${LAYER_DIR}/${CONFIG_FILE} okunamadı: ${e.message}` };
  }
  const errors = [];
  if (typeof user !== "object" || user === null || Array.isArray(user)) errors.push("kök bir JSON nesnesi olmalı");

  const roles = (user && user.roles) || {};
  for (const [role, rc] of Object.entries(roles)) {
    if (typeof rc !== "object" || rc === null || Array.isArray(rc)) { errors.push(`roles.${role} nesne olmalı`); continue; }
    if (!TEAM_ROLES.includes(role)) { addCustomRole(base, role, rc, errors); continue; }
    if ("agent" in rc || "kind" in rc) { errors.push(`roles.${role}: yerleşik rolün agent/kind değeri değiştirilemez`); continue; }
    const target = base.roles[role];
    if ("enabled" in rc) target.enabled = rc.enabled !== false;
    if ("profile" in rc) target.profile = rc.profile == null ? null : String(rc.profile);
    if ("paths" in rc) {
      if (!Array.isArray(rc.paths) || !rc.paths.every(validRelPath)) errors.push(`roles.${role}.paths göreli yol dizisi olmalı (.. ve mutlak yol yok)`);
      else target.paths = rc.paths.slice();
    }
  }
  const paths = (user && user.paths) || {};
  for (const [k, v] of Object.entries(paths)) {
    if (!(k in base.paths)) { errors.push(`bilinmeyen paths anahtarı: ${k}`); continue; }
    if (!validRelPath(v)) errors.push(`paths.${k} göreli bir yol olmalı`);
    else base.paths[k] = v;
  }
  if (user && "protected" in user) {
    if (!Array.isArray(user.protected) || !user.protected.every(validRelPath)) errors.push("protected göreli yol dizisi olmalı");
    else base.protected = user.protected.slice();
  }
  if (user && "sandbox" in user) {
    const sb = user.sandbox;
    if (typeof sb !== "object" || sb === null || Array.isArray(sb)) errors.push("sandbox bir nesne olmalı: { allowedDomains: [...] }");
    else {
      for (const k of Object.keys(sb)) if (k !== "allowedDomains") errors.push(`bilinmeyen sandbox anahtarı: ${k}`);
      if ("allowedDomains" in sb) {
        const bad = Array.isArray(sb.allowedDomains) ? sb.allowedDomains.filter((d) => typeof d !== "string" || !DOMAIN_RE.test(d)) : null;
        if (!bad) errors.push("sandbox.allowedDomains bir dizi olmalı");
        else if (bad.length) errors.push(`sandbox.allowedDomains geçersiz alan adı: ${bad.join(", ")}`);
        else base.sandbox.allowedDomains = sb.allowedDomains.slice();
      }
    }
  }
  if (user && "design" in user) {
    const d = user.design;
    if (typeof d !== "object" || d === null || Array.isArray(d)) errors.push("design bir nesne olmalı: { gate, minScore, variants, reviews }");
    else {
      for (const k of Object.keys(d)) if (!["gate", "minScore", "variants", "reviews"].includes(k)) errors.push(`bilinmeyen design anahtarı: ${k}`);
      if ("gate" in d) { if (!DESIGN_GATES.includes(d.gate)) errors.push(`design.gate şunlardan biri olmalı: ${DESIGN_GATES.join(", ")}`); else base.design.gate = d.gate; }
      if ("minScore" in d) { if (!(Number.isInteger(d.minScore) && d.minScore >= 1 && d.minScore <= 10)) errors.push("design.minScore 1 ile 10 arasında bir tam sayı olmalı"); else base.design.minScore = d.minScore; }
      if ("variants" in d) {
        if (!Array.isArray(d.variants) || !d.variants.length || !d.variants.every((v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(v))) errors.push("design.variants küçük harfli adlardan oluşan, boş olmayan bir dizi olmalı (ör. mobile-light)");
        else base.design.variants = [...new Set(d.variants)];
      }
      if ("reviews" in d) { if (!validRelPath(d.reviews)) errors.push("design.reviews göreli bir yol olmalı"); else base.design.reviews = d.reviews; }
    }
  }
  if (user && "autonomy" in user) {
    if (!AUTONOMY_LEVELS.includes(user.autonomy)) errors.push(`autonomy şunlardan biri olmalı: ${AUTONOMY_LEVELS.join(", ")}`);
    else base.autonomy = user.autonomy;
  }
  if (user && "models" in user) {
    const m = user.models;
    if (typeof m !== "object" || m === null || Array.isArray(m)) errors.push("models bir nesne olmalı: { roles: {...}, tasks: {...} }");
    else {
      for (const k of Object.keys(m)) if (k !== "roles" && k !== "tasks") errors.push(`bilinmeyen models anahtarı: ${k}`);
      for (const [k, keyRe, what] of [["roles", /^[a-z][a-z0-9-]*$/, "rol"], ["tasks", /^[A-Z][A-Z0-9-]*$/, "görev etiketi (BÜYÜK harf, ör. TEST)"]]) {
        if (!(k in m)) continue;
        if (typeof m[k] !== "object" || m[k] === null || Array.isArray(m[k])) { errors.push(`models.${k} bir nesne olmalı`); continue; }
        for (const [key, val] of Object.entries(m[k])) {
          if (!keyRe.test(key)) errors.push(`models.${k}.${key}: geçersiz ${what}`);
          else if (typeof val !== "string" || !MODEL_RE.test(val)) errors.push(`models.${k}.${key}: model opus, sonnet, haiku, inherit veya claude-… olmalı`);
          else base.models[k][key] = val;
        }
      }
    }
  }
  if (user && "evidence" in user) {
    const ev = typeof user.evidence === "string" ? { mode: user.evidence } : user.evidence;
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) errors.push('evidence "warn" | "enforce" | "strict" ya da { mode, maxAgeHours } olmalı');
    else {
      if ("mode" in ev) {
        if (!EVIDENCE_MODES.includes(ev.mode)) errors.push(`evidence.mode şunlardan biri olmalı: ${EVIDENCE_MODES.join(", ")}`);
        else base.evidence.mode = ev.mode;
      }
      if ("maxAgeHours" in ev) {
        if (!(typeof ev.maxAgeHours === "number" && ev.maxAgeHours > 0 && ev.maxAgeHours <= 24 * 30)) errors.push("evidence.maxAgeHours 0 ile 720 arasında bir sayı olmalı");
        else base.evidence.maxAgeHours = ev.maxAgeHours;
      }
    }
  }
  // Katman sürümü (MustToHave madde 12): yoksa 1 sayılır (0.1.0 katmanları). Yeni sürüm → plugin eski;
  // MIN altı → desteklenmiyor. Eski ama desteklenen sürüm hata değildir; ön kontrol --upgrade önerir.
  if (user && "version" in user && !(Number.isInteger(user.version) && user.version >= 1)) errors.push("version pozitif bir tam sayı olmalı");
  else {
    const v = user && "version" in user ? user.version : 1;
    base.version = v;
    if (v > LAYER_VERSION) errors.push(`katman sürümü ${v}, bu plugin en fazla ${LAYER_VERSION} destekliyor; plugin'i güncelleyin (claude plugin update)`);
    else if (v < MIN_LAYER_VERSION) errors.push(`katman sürümü ${v} artık desteklenmiyor (en az ${MIN_LAYER_VERSION}); setup-project --upgrade ile yükseltin`);
  }
  for (const role of Object.keys(base.models.roles)) {
    if (!base.roles[role]) errors.push(`models.roles.${role}: team.json'da böyle bir rol yok`);
  }
  const config = finalize(base);
  // Sahiplik çakışması: iki geliştirici rolü aynı yola sahip olamaz (ikisi de birbirini engellerdi)
  const owners = devRoles(config).map((r) => [r, config.roles[r].paths || []]);
  const overlaps = (a, b) => a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase());
  for (let i = 0; i < owners.length; i++) {
    for (let j = i + 1; j < owners.length; j++) {
      for (const a of owners[i][1]) for (const b of owners[j][1]) {
        if (overlaps(a, b)) errors.push(`sahiplik çakışması: ${owners[i][0]} (${a}) ve ${owners[j][0]} (${b})`);
      }
    }
  }
  return { config, source: "file", file, error: errors.length ? `${LAYER_DIR}/${CONFIG_FILE}: ${errors.join("; ")}` : null };
}

// ---------------------------------------------------------------- özel roller (MustToHave madde 9)
// team.json > roles.<ad> = { agent, kind, paths, enabled?, profile?, description? }
//   agent: "plugin:ajan" (tam eşleşme) veya "ajan" (projenin .claude/agents/ajan.md'si; ad eşleşmesi)
//   kind : developer  → paths'in SAHİBİ; sahipsiz yollara da yazar (yerleşik geliştiriciler gibi)
//          reviewer   → yalnızca kendi katman klasörü + paths (rapor klasörü; boş olabilir)
//          docs       → yalnızca paths (doküman klasörleri; en az bir yol)
//          allowlist  → yalnızca paths (en az bir yol)
const ROLE_KINDS = ["developer", "reviewer", "docs", "allowlist"];
const ROLE_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED_TAGS = ["BACKEND", "MOBILE", "WEB", "TEST", "FIX", "DOC", "ARCH", "LEAD", "TESTER"];
const CUSTOM_KEYS = ["agent", "kind", "paths", "enabled", "profile", "description"];

function addCustomRole(base, role, rc, errors) {
  const where = `roles.${role}`;
  if (!ROLE_NAME_RE.test(role)) { errors.push(`${where}: rol adı küçük harf, rakam ve '-' içermeli (2-31 karakter)`); return; }
  if (RESERVED_TAGS.includes(role.toUpperCase())) { errors.push(`${where}: '${role}' ayrılmış bir ad`); return; }
  for (const k of Object.keys(rc)) if (!CUSTOM_KEYS.includes(k)) errors.push(`${where}: bilinmeyen anahtar ${k}`);
  if (typeof rc.agent !== "string" || !/^([A-Za-z0-9_.-]+:)?[A-Za-z0-9_.-]+$/.test(rc.agent)) { errors.push(`${where}.agent "ajan-adı" veya "plugin:ajan-adı" olmalı`); return; }
  if (ROLE_BY_AGENT[agentBaseName(rc.agent)]) { errors.push(`${where}.agent yerleşik bir takım ajanı olamaz`); return; }
  if (!ROLE_KINDS.includes(rc.kind)) { errors.push(`${where}.kind şunlardan biri olmalı: ${ROLE_KINDS.join(", ")}`); return; }
  const paths = "paths" in rc ? rc.paths : [];
  if (!Array.isArray(paths) || !paths.every(validRelPath)) { errors.push(`${where}.paths göreli yol dizisi olmalı (.. ve mutlak yol yok)`); return; }
  if ((rc.kind === "docs" || rc.kind === "allowlist" || rc.kind === "developer") && !paths.length) { errors.push(`${where}: ${rc.kind} rolü en az bir yol ister`); return; }
  for (const [other, oc] of Object.entries(base.roles)) {
    if (oc.custom && oc.agent === rc.agent) { errors.push(`${where}.agent ${other} rolüyle aynı`); return; }
  }
  base.roles[role] = {
    custom: true,
    agent: rc.agent,
    kind: rc.kind,
    enabled: rc.enabled !== false,
    profile: rc.profile == null ? null : String(rc.profile),
    paths: paths.slice(),
    description: typeof rc.description === "string" ? rc.description : null,
  };
}

/** Bir agent tipine karşılık gelen rol (yerleşik roller önce; config verilirse özel roller). */
function roleFor(agentType, config) {
  const builtin = roleFromAgentType(agentType);
  if (builtin || !agentType) return builtin;
  for (const [role, rc] of Object.entries(config ? config.roles : {})) {
    if (!rc.custom) continue;
    if (rc.agent.includes(":") ? agentType === rc.agent : agentBaseName(agentType) === rc.agent) return role;
  }
  return roleFromTeammateName(agentType, config);
}
/**
 * Agent teams'te teammate'in hook girdisindeki agent_type, ajan tipi değil teammate ADIDIR
 * ("backend", "lead", "tester-test"). Ad bir role eşitse veya "<rol>-" ile başlıyorsa o rol.
 * Önekli tipler ("x:y") ad sayılmaz. Eşleşmezse null (takım dışı).
 */
function roleFromTeammateName(name, config) {
  const s = String(name || "").toLowerCase();
  if (!s || s.includes(":")) return null;
  const roles = config ? Object.keys(config.roles) : TEAM_ROLES;
  return roles
    .filter((r) => s === r.toLowerCase() || s.startsWith(r.toLowerCase() + "-"))
    .sort((a, b) => b.length - a.length)[0] || null;
}
/** Rolün agent tipi (spawn eşlemesi için). Yerleşikler "agent-team:<ad>", özel roller team.json'daki değer. */
function agentForRole(role, config, pluginName = "agent-team") {
  if (AGENT_BY_ROLE[role]) return `${pluginName}:${AGENT_BY_ROLE[role]}`;
  const rc = config && config.roles[role];
  return rc && rc.custom ? rc.agent : null;
}
/** Alan sahipliği olan roller: yerleşik geliştiriciler + kind=developer özel roller. */
function devRoles(config) {
  return [...DEV_ROLES, ...Object.entries((config && config.roles) || {}).filter(([, rc]) => rc.custom && rc.kind === "developer").map(([r]) => r)];
}
/** Görev etiketi ([BACKEND] …) → kanıt kapısının kabul ettiği roller. Özel geliştirici rolü: [<AD>]. */
function rolesForTag(tag, config) {
  const t = String(tag).toUpperCase();
  const builtin = { BACKEND: ["backend"], MOBILE: ["mobile"], WEB: ["web"], TEST: ["tester"] };
  if (builtin[t]) return builtin[t];
  if (t === "FIX") return [...devRoles(config), "tester"];
  const role = t.toLowerCase();
  const rc = config && config.roles[role];
  return rc && rc.custom && rc.kind === "developer" ? [role] : null;
}

function finalize(cfg) {
  for (const r of Object.values(cfg.roles)) if (r.paths) r.paths = r.paths.map(normDir);
  for (const k of Object.keys(cfg.paths)) cfg.paths[k] = normDir(cfg.paths[k]);
  if (cfg.design) cfg.design.reviews = normDir(cfg.design.reviews);
  cfg.protected = cfg.protected.map(normDir);
  return cfg;
}

/** Proje kökünü bul: CLAUDE_PROJECT_DIR > girdi cwd > git kökü > process.cwd() */
function projectRoot(input) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (input && input.cwd) return input.cwd;
  return process.cwd();
}

module.exports = {
  LAYER_DIR,
  CONFIG_FILE,
  ROLE_BY_AGENT,
  AGENT_BY_ROLE,
  TEAM_ROLES,
  DEV_ROLES,
  DEFAULT_CONFIG,
  EVIDENCE_MODES,
  AUTONOMY_LEVELS,
  DESIGN_GATES,
  LAYER_VERSION,
  MIN_LAYER_VERSION,
  DOMAIN_RE,
  agentBaseName,
  roleFromAgentType,
  roleFor,
  roleFromTeammateName,
  agentForRole,
  devRoles,
  rolesForTag,
  ROLE_KINDS,
  identifyCaller,
  registerAgent,
  lookupAgent,
  dataDir,
  registryDir,
  safeId,
  loadConfig,
  projectRoot,
};
