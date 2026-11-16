"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN = path.join(__dirname, "..", "..", "plugin");
const prof = require(path.join(PLUGIN, "hooks", "lib", "profile.js"));
const sb = require(path.join(PLUGIN, "hooks", "lib", "sandbox.js"));
const cfgLib = require(path.join(PLUGIN, "hooks", "lib", "team-config.js"));
const CHECK = path.join(PLUGIN, "scripts", "profile-check.js");

const VALID = `# Profil: backend / ornek

## Yığın
| Katman | Varsayılan |
|---|---|
| Runtime | X |

## Konvansiyonlar
- kural

## Komutlar
| Amaç | Komut |
|---|---|
| Test | \`x test\` |

## Test
- unit

## Ağ izinleri (sandbox)
- \`registry.ornek.org\`: paketler

## DoD ek maddeleri
- [ ] testler geçiyor
`;

function project(profiles, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prof-"));
  const layer = path.join(dir, cfgLib.LAYER_DIR);
  fs.mkdirSync(path.join(layer, "profiles"), { recursive: true });
  for (const [n, t] of Object.entries(profiles)) fs.writeFileSync(path.join(layer, "profiles", n + ".md"), t);
  const team = { version: cfgLib.LAYER_VERSION, roles: { backend: { profile: "ornek" } } };
  if (mutate) mutate(team);
  fs.writeFileSync(path.join(layer, "team.json"), JSON.stringify(team));
  return dir;
}

test("her hazır profil şablon biçimine uyar", () => {
  const all = prof.builtinProfiles();
  assert.ok(all.length >= 8, `profil sayısı ${all.length}`);
  for (const p of all) {
    const v = prof.validateProfile(fs.readFileSync(p.file, "utf8"), p);
    assert.deepStrictEqual(v.errors, [], `${p.role}/${p.name}`);
    assert.deepStrictEqual(v.warnings, [], `${p.role}/${p.name}`);
  }
});

test("yeni profiller var: backend/node, backend/python, web/aspnet-mvc", () => {
  const names = prof.builtinProfiles().map((p) => `${p.role}/${p.name}`);
  for (const n of ["backend/node", "backend/python", "web/aspnet-mvc"]) assert.ok(names.includes(n), n);
});

test("şablon: tüm zorunlu bölümler var, doldurulmamış uyarısı verir", () => {
  const v = prof.validateProfile(fs.readFileSync(prof.TEMPLATE, "utf8"));
  for (const s of prof.REQUIRED_SECTIONS) assert.ok(!v.errors.some((e) => e.includes(`'## ${s.key}'`)), s.key);
  assert.ok(v.warnings.some((w) => /doldurulmamış/.test(w)));
});

test("validateProfile: geçerli örnek, eksik bölüm, bozuk alan adı, boş DoD, watch komutu", () => {
  assert.deepStrictEqual(prof.validateProfile(VALID, { role: "backend", name: "ornek" }), { errors: [], warnings: [] });
  assert.match(prof.validateProfile(VALID.replace("## Test\n- unit\n", "")).errors.join(), /Test/);
  assert.match(prof.validateProfile(VALID.replace("registry.ornek.org", "http://bad url")).errors.join(), /geçersiz alan adı/);
  assert.match(prof.validateProfile(VALID.replace("- [ ] testler geçiyor", "- testler")).errors.join(), /DoD/);
  assert.match(prof.validateProfile(VALID.replace("`x test`", "`npm run dev`")).warnings.join(), /watch\/sunucu/);
  assert.match(prof.validateProfile(VALID, { role: "web" }).warnings.join(), /rol/);
  assert.match(prof.validateProfile("").errors.join(), /boş/);
  assert.match(prof.validateProfile("selam").errors.join(), /başlık/);
});

test("profileStatus + sandbox: geçersiz proje profili izin eklemez, geçerli olan ekler", () => {
  const bad = project({ ornek: "# Profil: backend / ornek\n## Ağ izinleri\n- `evil.example.com`: x\n" });
  const st = prof.profileStatus(bad, cfgLib.loadConfig(bad).config);
  assert.strictEqual(st.length, 1);
  assert.strictEqual(st[0].valid, false);
  assert.strictEqual(st[0].source, "project");
  const r = sb.requiredSandbox(bad, cfgLib.loadConfig(bad).config);
  assert.ok(!r.domains.includes("evil.example.com"));
  assert.ok(r.invalid.some((i) => /backend\/ornek: profil geçersiz/.test(i)));

  const good = project({ ornek: VALID });
  assert.ok(sb.requiredSandbox(good, cfgLib.loadConfig(good).config).domains.includes("registry.ornek.org"));
  const missing = project({}, (t) => (t.roles.backend.profile = "yok"));
  assert.deepStrictEqual(prof.profileStatus(missing, cfgLib.loadConfig(missing).config)[0].errors, ["bulunamadı"]);
});

test("SessionStart: geçersiz profil kullanıcıya sorulur (düzelt / profilsiz devam)", () => {
  const { buildContext } = require(path.join(PLUGIN, "hooks", "session-start.js"));
  const bad = project({ ornek: "# Profil: backend / ornek\n" });
  const ctx = buildContext(bad, { installed: true });
  assert.match(ctx, /backend\/ornek.*geçersiz/);
  assert.match(ctx, /profilsiz/);
  assert.doesNotMatch(buildContext(project({ ornek: VALID }), { installed: true }), /geçersiz/);
});

test("profile-check.js: dosya, --project, --builtin çıkış kodları", () => {
  const good = project({ ornek: VALID });
  const run = (...a) => spawnSync(process.execPath, [CHECK, ...a], { encoding: "utf8" });
  assert.strictEqual(run(path.join(good, cfgLib.LAYER_DIR, "profiles", "ornek.md")).status, 0);
  assert.strictEqual(run("--project", good).status, 0);
  assert.strictEqual(run("--builtin").status, 0);
  const bad = project({ ornek: "# Profil: backend / ornek\n" });
  const r = run("--project", bad);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /GEÇERSİZ/);
  assert.strictEqual(run().status, 2);
});

test("onboard-scan: Node/Python backend ve ASP.NET MVC hazır profile eşlenir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-"));
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  w("api/package.json", JSON.stringify({ name: "api", dependencies: { express: "4" }, scripts: { test: "node --test" } }));
  w("svc/pyproject.toml", "[project]\ndependencies = [\"fastapi\"]\n");
  w("site/Site.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  w("site/Views/Home/Index.cshtml", "<h1/>");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const r = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "onboard-scan.js"), "--json", "--project", dir], { encoding: "utf8" });
  const apps = JSON.parse(r.stdout).apps;
  const by = (d) => apps.find((a) => a.dir.startsWith(d));
  assert.strictEqual(by("api").profile, "node");
  assert.strictEqual(by("svc").profile, "python");
  assert.strictEqual(by("site").role, "web");
  assert.strictEqual(by("site").profile, "aspnet-mvc");
});
