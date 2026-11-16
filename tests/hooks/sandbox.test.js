// Sandbox desteği testleri: lib/sandbox.js, setup-project birleştirmesi, team-preflight kontrolleri.
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js
// Platform, AGENT_TEAM_TEST_PLATFORM ile taklit edilir (Windows'ta Linux davranışı da sınanır).

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const PLUGIN = path.join(REPO, "plugin");
const SANDBOX_DIR = path.join(REPO, "tests", ".sandbox");
const sb = require(path.join(PLUGIN, "hooks", "lib", "sandbox"));
const cfgLib = require(path.join(PLUGIN, "hooks", "lib", "team-config"));
const gitOk = spawnSync("git", ["--version"]).status === 0;

const cfg = (mut) => {
  const c = JSON.parse(JSON.stringify(cfgLib.DEFAULT_CONFIG));
  if (mut) mut(c);
  return c;
};
function tmpProject(name) {
  const dir = path.join(SANDBOX_DIR, `${name}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------- profiller
test("parseNetworkSection: alan adları, sandbox dışı komutlar, geçersiz girişler, bölüm sınırı", () => {
  const p = sb.parseNetworkSection([
    "## Komutlar", "- `npm test`: bu bölüm değil",
    "## Ağ izinleri (sandbox)", "Açıklama `inline` metni sayılmaz.",
    "- `registry.npmjs.org`: npm", "- `*.example.com:443`: örnek", "- `http://kotu.com`: geçersiz",
    "### Sandbox dışında çalışan komutlar", "- `docker compose *`: Docker soketi",
    "## DoD ek maddeleri", "- `pub.dev`: sayılmaz",
  ].join("\n"));
  assert.deepStrictEqual(p.domains, ["registry.npmjs.org", "*.example.com:443"]);
  assert.deepStrictEqual(p.excludedCommands, ["docker compose *"]);
  assert.deepStrictEqual(p.invalid, ["http://kotu.com"]);
});

test("her yerleşik profilde geçerli bir 'Ağ izinleri' bölümü var", () => {
  const files = [];
  for (const role of fs.readdirSync(path.join(PLUGIN, "profiles"))) {
    const dir = path.join(PLUGIN, "profiles", role);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".md")) files.push(path.join(dir, f));
  }
  assert.ok(files.length >= 6);
  for (const f of files) {
    const p = sb.parseNetworkSection(fs.readFileSync(f, "utf8"));
    assert.ok(p.domains.length > 0, `${path.relative(PLUGIN, f)}: Ağ izinleri bölümü yok veya boş`);
    assert.deepStrictEqual(p.invalid, [], path.relative(PLUGIN, f));
  }
});

test("requiredSandbox: ortak + etkin rollerin profilleri + team.json; kapalı rol ve proje profili önceliği", () => {
  const proj = tmpProject("req");
  fs.mkdirSync(path.join(proj, cfgLib.LAYER_DIR, "profiles"), { recursive: true });
  fs.writeFileSync(path.join(proj, cfgLib.LAYER_DIR, "profiles", "nextjs.md"), "# Profil: web / nextjs\n## Yığın\n## Konvansiyonlar\n## Komutlar\n| Test | `npm test` |\n## Test\n## Ağ izinleri\n- `npm.sirket.local`: iç registry\n## DoD\n- [ ] testler\n");
  const r = sb.requiredSandbox(proj, cfg((c) => {
    c.roles.backend.profile = "dotnet";
    c.roles.web.profile = "nextjs"; // proje profili yerleşiği gölgeler
    c.roles.mobile.enabled = false;
    c.roles.mobile.profile = "flutter";
    c.sandbox.allowedDomains = ["api.sirket.com"];
  }));
  for (const d of [...sb.COMMON_DOMAINS, "api.nuget.org", "npm.sirket.local", "api.sirket.com", "cdn.playwright.dev"]) assert.ok(r.domains.includes(d), d);
  assert.ok(!r.domains.includes("pub.dev"), "kapalı rolün profili eklenmez");
  assert.ok(!r.domains.includes("fonts.googleapis.com"), "proje profili yerleşik profilin yerine geçer");
  assert.deepStrictEqual(r.sources["api.sirket.com"], ["team.json"]);
  assert.strictEqual(new Set(r.domains).size, r.domains.length, "tekrar yok");
});

// ---------------------------------------------------------------- birleştirme
test("mergeSettings: temel blok eklenir, var olan değerler ezilmez, listeler birleşir, tekrar çalıştırma değiştirmez", () => {
  const required = { domains: ["github.com", "registry.npmjs.org"], excludedCommands: [] };
  const fresh = sb.mergeSettings({}, required);
  assert.deepStrictEqual(fresh.settings, { sandbox: { enabled: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true, network: { allowedDomains: ["github.com", "registry.npmjs.org"] } } });
  assert.strictEqual(fresh.changes.length, 4);

  const existing = { permissions: { allow: ["Bash(npm test)"] }, sandbox: { enabled: false, network: { allowedDomains: ["registry.npmjs.org", "x.com"] } } };
  const m = sb.mergeSettings(existing, required);
  assert.strictEqual(m.settings.sandbox.enabled, false, "kullanıcının kararı korunur");
  assert.ok(m.kept.some((k) => /sandbox\.enabled = false/.test(k)));
  assert.deepStrictEqual(m.settings.sandbox.network.allowedDomains, ["registry.npmjs.org", "x.com", "github.com"]);
  assert.deepStrictEqual(m.settings.permissions, existing.permissions);
  assert.deepStrictEqual(existing.sandbox.network.allowedDomains, ["registry.npmjs.org", "x.com"], "girdi nesnesi değiştirilmez");
  assert.deepStrictEqual(sb.mergeSettings(m.settings, required).changes, []);
  assert.ok(!("agent" in m.settings));

  assert.throws(() => sb.mergeSettings({ sandbox: true }, required), /nesne değil/);
  assert.throws(() => sb.mergeSettings({ sandbox: { network: { allowedDomains: "github.com" } } }, required), /dizi değil/);
});

test("team.json sandbox.allowedDomains doğrulanır", () => {
  const proj = tmpProject("cfg");
  fs.mkdirSync(path.join(proj, cfgLib.LAYER_DIR));
  const put = (v) => fs.writeFileSync(path.join(proj, cfgLib.LAYER_DIR, "team.json"), JSON.stringify({ sandbox: v }));
  put({ allowedDomains: ["api.sirket.com", "*.sirket.com:8443"] });
  assert.strictEqual(cfgLib.loadConfig(proj).error, null);
  put({ allowedDomains: ["https://api.sirket.com"] });
  assert.match(cfgLib.loadConfig(proj).error, /geçersiz alan adı/);
  put({ allowedDomains: "api.sirket.com" });
  assert.match(cfgLib.loadConfig(proj).error, /dizi olmalı/);
  put({ enabled: true });
  assert.match(cfgLib.loadConfig(proj).error, /bilinmeyen sandbox anahtarı/);
});

test("effectiveSandbox: yerel ayar projeyi geçersiz kılar, listeler birleşir", () => {
  const proj = tmpProject("eff");
  const home = tmpProject("home");
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = home;
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ sandbox: { network: { allowedDomains: ["a.com"] } } }));
    fs.mkdirSync(path.join(proj, ".claude"));
    fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ sandbox: { enabled: true, allowUnsandboxedCommands: false, network: { allowedDomains: ["b.com"] } } }));
    let e = sb.effectiveSandbox(proj);
    assert.strictEqual(e.enabled, true);
    assert.deepStrictEqual(e.domains, ["a.com", "b.com"]);
    fs.writeFileSync(path.join(proj, ".claude", "settings.local.json"), JSON.stringify({ sandbox: { enabled: false } }));
    e = sb.effectiveSandbox(proj);
    assert.strictEqual(e.enabled, false);
    fs.writeFileSync(path.join(proj, ".claude", "settings.local.json"), "{bozuk");
    assert.strictEqual(sb.effectiveSandbox(proj).errors.length, 1);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("platformStatus: macOS yerleşik, Linux eksik bağımlılık ve kurulum komutu, Windows desteklenmez", () => {
  assert.strictEqual(sb.platformStatus("darwin").supported, true);
  const none = sb.platformStatus("linux", () => null);
  assert.deepStrictEqual(none.missing, ["bwrap", "socat"]);
  const apt = sb.platformStatus("linux", (c) => (["apt-get", "bwrap"].includes(c) ? "/usr/bin/" + c : null));
  assert.deepStrictEqual(apt.missing, ["socat"]);
  assert.strictEqual(apt.hint, "sudo apt install -y bubblewrap socat");
  assert.strictEqual(sb.platformStatus("linux", (c) => (c === "dnf" ? "/usr/bin/dnf" : null)).hint, "sudo dnf install -y bubblewrap socat");
  assert.deepStrictEqual(sb.platformStatus("linux", (c) => "/usr/bin/" + c).missing, []);
  assert.strictEqual(sb.platformStatus("win32").supported, false);
});

// ---------------------------------------------------------------- setup-project + preflight (uçtan uca)
function setup(proj, args, platform, home) {
  const env = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", AGENT_TEAM_TEST_PLATFORM: platform, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "setup-project.js"), "--project", proj, ...args], { cwd: proj, env, encoding: "utf8" });
}
const settingsOf = (proj) => JSON.parse(fs.readFileSync(path.join(proj, ".claude", "settings.json"), "utf8"));

test("setup-project (Linux): sandbox'ı açar, profil seçilince eksik alan adlarını ekler, ön kontrol denetler", { skip: !gitOk && "git yok" }, () => {
  const proj = tmpProject("sbx-linux");
  const home = tmpProject("sbx-home");
  spawnSync("git", ["init", "-q"], { cwd: proj });

  const dry = setup(proj, ["--dry-run"], "linux", home);
  assert.strictEqual(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /\+ sandbox\.enabled = true/);
  assert.ok(!fs.existsSync(path.join(proj, ".claude", "settings.json")), "dry-run yazmaz");

  const first = setup(proj, [], "linux", home);
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  let s = settingsOf(proj);
  assert.strictEqual(s.sandbox.enabled, true);
  assert.strictEqual(s.sandbox.allowUnsandboxedCommands, false);
  assert.ok(s.sandbox.network.allowedDomains.includes("github.com"));
  assert.ok(!("agent" in s));
  if (process.platform !== "linux") assert.match(first.stdout, /bağımlılıkları eksik: bwrap, socat/);

  // Kullanıcı profili seçer ve kendi ayarını ekler; yeniden kurulum yalnızca eksikleri ekler
  const tj = path.join(proj, cfgLib.LAYER_DIR, "team.json");
  const team = JSON.parse(fs.readFileSync(tj, "utf8"));
  team.roles.backend.profile = "dotnet";
  team.sandbox.allowedDomains = ["api.sirket.com"];
  fs.writeFileSync(tj, JSON.stringify(team, null, 2));
  s.permissions = { allow: ["Bash(dotnet test)"] };
  s.sandbox.autoAllowBashIfSandboxed = false;
  fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify(s));

  const pfBefore = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "team-preflight.js"), "--project", proj], {
    encoding: "utf8", env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", AGENT_TEAM_TEST_PLATFORM: "linux", HOME: home, USERPROFILE: home },
  });
  assert.match(pfBefore.stdout, /eksik alan adı.*api\.nuget\.org.*api\.sirket\.com/);

  const second = setup(proj, [], "linux", home);
  assert.strictEqual(second.status, 0, second.stdout + second.stderr);
  s = settingsOf(proj);
  assert.ok(s.sandbox.network.allowedDomains.includes("api.nuget.org"));
  assert.ok(s.sandbox.network.allowedDomains.includes("api.sirket.com"));
  assert.strictEqual(s.sandbox.autoAllowBashIfSandboxed, false, "kullanıcının değeri korunur");
  assert.deepStrictEqual(s.permissions, { allow: ["Bash(dotnet test)"] });
  assert.match(second.stdout, /= sandbox\.autoAllowBashIfSandboxed = false/);
  assert.match(second.stdout, /ağ izinleri profillerle uyumlu/);

  const third = setup(proj, [], "linux", home);
  assert.match(third.stdout, /sandbox ayarı zaten güncel/);
});

test("setup-project: bozuk settings.json'a dokunmaz; --no-sandbox atlar; Windows'ta yalnızca --sandbox ile yazar", { skip: !gitOk && "git yok" }, () => {
  const home = tmpProject("sbx-home2");
  const broken = tmpProject("sbx-broken");
  spawnSync("git", ["init", "-q"], { cwd: broken });
  fs.mkdirSync(path.join(broken, ".claude"));
  fs.writeFileSync(path.join(broken, ".claude", "settings.json"), "{ bozuk");
  const b = setup(broken, [], "linux", home);
  assert.strictEqual(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stdout, /okunamadı.*dokunulmadı/);
  assert.strictEqual(fs.readFileSync(path.join(broken, ".claude", "settings.json"), "utf8"), "{ bozuk");

  const skip = tmpProject("sbx-skip");
  spawnSync("git", ["init", "-q"], { cwd: skip });
  assert.match(setup(skip, ["--no-sandbox"], "linux", home).stdout, /atlandı \(--no-sandbox\)/);
  assert.ok(!fs.existsSync(path.join(skip, ".claude", "settings.json")));

  const win = tmpProject("sbx-win");
  spawnSync("git", ["init", "-q"], { cwd: win });
  const w = setup(win, [], "win32", home);
  assert.match(w.stdout, /native Windows sandbox'ı desteklemiyor/);
  assert.match(w.stdout, /WARN\s+sandbox: native Windows desteklemiyor/);
  assert.ok(!fs.existsSync(path.join(win, ".claude", "settings.json")));
  setup(win, ["--sandbox"], "win32", home);
  assert.strictEqual(settingsOf(win).sandbox.enabled, true);
});
