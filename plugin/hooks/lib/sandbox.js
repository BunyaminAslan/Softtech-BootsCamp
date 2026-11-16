// sandbox.js — Claude Code sandbox ayarı için ortak yardımcılar (setup-project ve team-preflight kullanır).
//
// Plugin sandbox'ı kendisi açamaz; ayar ürün reposunun .claude/settings.json dosyasına yazılır.
// Gereken ağ izinleri üç kaynaktan toplanır:
//   1. Framework ortak listesi (COMMON_DOMAINS)
//   2. Etkin rollerin profillerindeki "## Ağ izinleri" bölümü (tester için profil yoksa profiles/tester/README.md)
//   3. team.json > sandbox.allowedDomains (projeye özel)
// Profil biçimi:
//   ## Ağ izinleri (sandbox)
//   - `registry.npmjs.org`: npm paketleri
//   ### Sandbox dışında çalışan komutlar        (isteğe bağlı, gerekçeli)
//   - `docker compose *`: Docker soketi gerekir
//
// Yalnızca Node'un yerleşik modülleri kullanılır.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cfgLib = require("./team-config");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const COMMON_DOMAINS = ["github.com", "codeload.github.com", "objects.githubusercontent.com"];
const BASE_BLOCK = Object.freeze({ enabled: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true });
const DOMAIN_RE = cfgLib.DOMAIN_RE;

// ---------------------------------------------------------------- profiller
function profilePath(projectDir, role, name) {
  return require("./profile").findProfile(projectDir, role, name).file;
}

/** "## Ağ izinleri" bölümünü ayrıştırır. @returns {{domains: string[], excludedCommands: string[], invalid: string[]}} */
function parseNetworkSection(text) {
  const out = { domains: [], excludedCommands: [], invalid: [] };
  let inSection = false, sub = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inSection = /^##\s+Ağ izinleri\b/i.test(line); sub = null; continue; }
    if (!inSection) continue;
    if (/^###\s/.test(line)) { sub = /sandbox dışında/i.test(line) ? "excluded" : "other"; continue; }
    const m = /^\s*[-*]\s+`([^`]+)`/.exec(line);
    if (!m) continue;
    const v = m[1].trim();
    if (sub === "excluded") out.excludedCommands.push(v);
    else if (sub === null) (DOMAIN_RE.test(v) ? out.domains : out.invalid).push(v);
  }
  return out;
}

/**
 * Projenin ihtiyaç duyduğu sandbox izinleri.
 * @returns {{domains: string[], excludedCommands: string[], sources: Object<string,string[]>, invalid: string[]}}
 */
function requiredSandbox(projectDir, config) {
  const domains = new Map(); // alan adı → kaynaklar
  const excluded = new Map();
  const invalid = [];
  const add = (map, v, src) => { if (!map.has(v)) map.set(v, []); map.get(v).push(src); };
  for (const d of COMMON_DOMAINS) add(domains, d, "ortak");

  for (const [role, rc] of Object.entries(config.roles)) {
    if (!rc.enabled) continue;
    let file = null, label = null;
    if (rc.profile) { file = profilePath(projectDir, role, rc.profile); label = `${role}/${rc.profile}`; }
    else if (role === "tester") { file = path.join(PLUGIN_ROOT, "profiles", "tester", "README.md"); label = "tester"; }
    if (!file || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (rc.profile) {
      const v = require("./profile").validateProfile(text, { role, name: rc.profile });
      if (v.errors.length) { invalid.push(`${label}: profil geçersiz, izinleri eklenmedi (${v.errors.join("; ")})`); continue; }
    }
    const p = parseNetworkSection(text);
    for (const d of p.domains) add(domains, d, label);
    for (const c of p.excludedCommands) add(excluded, c, label);
    for (const i of p.invalid) invalid.push(`${label}: ${i}`);
  }
  for (const d of (config.sandbox && config.sandbox.allowedDomains) || []) add(domains, d, "team.json");
  return {
    domains: [...domains.keys()],
    excludedCommands: [...excluded.keys()],
    sources: Object.fromEntries(domains),
    invalid,
  };
}

// ---------------------------------------------------------------- settings.json birleştirme
/**
 * Var olan ayar nesnesine sandbox bloğunu ekler. Var olan anahtarlar ezilmez; listeler birleştirilir.
 * @returns {{settings: object, changes: string[], kept: string[]}}
 */
function mergeSettings(existing, required) {
  const settings = JSON.parse(JSON.stringify(existing || {}));
  const changes = [], kept = [];
  if (settings.sandbox !== undefined && (typeof settings.sandbox !== "object" || settings.sandbox === null || Array.isArray(settings.sandbox))) {
    throw new Error("settings.json > sandbox bir nesne değil");
  }
  const sb = settings.sandbox || (settings.sandbox = {});
  for (const [k, v] of Object.entries(BASE_BLOCK)) {
    if (!(k in sb)) { sb[k] = v; changes.push(`sandbox.${k} = ${JSON.stringify(v)}`); }
    else if (sb[k] !== v) kept.push(`sandbox.${k} = ${JSON.stringify(sb[k])} (önerilen ${JSON.stringify(v)}; dokunulmadı)`);
  }
  const mergeList = (obj, key, label, values) => {
    if (!values.length) return;
    if (obj[key] !== undefined && !Array.isArray(obj[key])) throw new Error(`settings.json > ${label} bir dizi değil`);
    const list = obj[key] || (obj[key] = []);
    const missing = values.filter((v) => !list.includes(v));
    list.push(...missing);
    if (missing.length) changes.push(`${label} += ${missing.join(", ")}`);
  };
  if (sb.network !== undefined && (typeof sb.network !== "object" || sb.network === null || Array.isArray(sb.network))) {
    throw new Error("settings.json > sandbox.network bir nesne değil");
  }
  const net = sb.network || (sb.network = {});
  mergeList(net, "allowedDomains", "sandbox.network.allowedDomains", required.domains);
  mergeList(sb, "excludedCommands", "sandbox.excludedCommands", required.excludedCommands);
  return { settings, changes, kept };
}

// ---------------------------------------------------------------- etkin ayar (kullanıcı < proje < yerel)
function readJson(file) {
  if (!fs.existsSync(file)) return { data: null, error: null };
  try {
    return { data: JSON.parse(fs.readFileSync(file, "utf8")), error: null };
  } catch (e) {
    return { data: null, error: `${file}: ${e.message}` };
  }
}
function settingsFiles(projectDir) {
  return [
    path.join(os.homedir(), ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.local.json"),
  ];
}
/** Sandbox ayarının etkin hali (skaler: sonraki kapsam kazanır; listeler: birleşir). */
function effectiveSandbox(projectDir) {
  const eff = { enabled: false, allowUnsandboxedCommands: true, domains: [], excludedCommands: [], enabledFrom: null, errors: [] };
  for (const f of settingsFiles(projectDir)) {
    const { data, error } = readJson(f);
    if (error) eff.errors.push(error);
    const sb = data && data.sandbox;
    if (!sb || typeof sb !== "object") continue;
    if (typeof sb.enabled === "boolean") { eff.enabled = sb.enabled; eff.enabledFrom = f; }
    if (typeof sb.allowUnsandboxedCommands === "boolean") eff.allowUnsandboxedCommands = sb.allowUnsandboxedCommands;
    if (sb.network && Array.isArray(sb.network.allowedDomains)) eff.domains.push(...sb.network.allowedDomains);
    if (Array.isArray(sb.excludedCommands)) eff.excludedCommands.push(...sb.excludedCommands);
  }
  eff.domains = [...new Set(eff.domains)];
  return eff;
}

// ---------------------------------------------------------------- platform ve bağımlılıklar
function which(cmd, envPath = process.env.PATH || "") {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, cmd);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      if (fs.statSync(f).isFile()) return f;
    } catch (_) {}
  }
  return null;
}
function isWSL() {
  try {
    return /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch (_) {
    return false;
  }
}
function installHint(whichFn = which) {
  if (whichFn("apt-get")) return "sudo apt install -y bubblewrap socat";
  if (whichFn("dnf")) return "sudo dnf install -y bubblewrap socat";
  if (whichFn("pacman")) return "sudo pacman -S bubblewrap socat";
  if (whichFn("zypper")) return "sudo zypper install bubblewrap socat";
  return "bubblewrap ve socat paketlerini dağıtımınızın paket yöneticisiyle kurun";
}
/**
 * @returns {{supported: boolean, platform: string, missing: string[], hint: string|null}}
 */
function platformStatus(platform = process.env.AGENT_TEAM_TEST_PLATFORM || process.platform, whichFn = which) {
  if (platform === "darwin") return { supported: true, platform: "macOS (Seatbelt)", missing: [], hint: null };
  if (platform === "linux") {
    const missing = ["bwrap", "socat"].filter((c) => !whichFn(c));
    return { supported: true, platform: isWSL() ? "WSL2 (bubblewrap)" : "Linux (bubblewrap)", missing, hint: missing.length ? installHint(whichFn) : null };
  }
  return { supported: false, platform: platform === "win32" ? "native Windows" : platform, missing: [], hint: null };
}

module.exports = {
  COMMON_DOMAINS,
  BASE_BLOCK,
  DOMAIN_RE,
  profilePath,
  parseNetworkSection,
  requiredSandbox,
  mergeSettings,
  effectiveSandbox,
  settingsFiles,
  platformStatus,
  installHint,
  which,
};
