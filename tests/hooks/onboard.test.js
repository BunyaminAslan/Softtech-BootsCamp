// onboard-scan.js testleri (MustToHave madde 4): yığın, profil, komut, sahiplik tespiti ve güvenli taslak yazımı.
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const PLUGIN = path.join(REPO, "plugin");
const SCAN = path.join(PLUGIN, "scripts", "onboard-scan.js");
const LAYER = "AdditionalAgentInformation";
const gitOk = spawnSync("git", ["--version"]).status === 0;

function repo(files) {
  const dir = path.join(REPO, "tests", ".sandbox", `onboard-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof c === "string" ? c : JSON.stringify(c));
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const scan = (dir, ...args) => spawnSync(process.execPath, [SCAN, "--project", dir, ...args], { encoding: "utf8" });
const json = (dir) => JSON.parse(scan(dir, "--json").stdout);

const MONOREPO = {
  "package.json": { name: "notlar", private: true, workspaces: ["apps/*"] },
  "apps/api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>',
  "apps/api.tests/Api.Tests.csproj": '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>',
  "apps/api/openapi.yaml": "openapi: 3.1.0",
  "apps/mobile/package.json": { name: "mobile", dependencies: { expo: "~52.0.0", "react-native": "0.76.0" }, scripts: { test: "jest --watch", start: "expo start", lint: "eslint ." } },
  "apps/mobile/yarn.lock": "",
  "apps/web/package.json": { name: "web", dependencies: { next: "15.0.0", react: "19.0.0" }, scripts: { build: "next build", dev: "next dev", test: "vitest run", lint: "next lint" } },
  "apps/web/package-lock.json": "{}",
  "apps/web/node_modules/express/package.json": { name: "express", dependencies: { express: "1" } },
  "docs/adr/0001-x.md": "# ADR",
  "README.md": "# Notlar",
  "CLAUDE.md": "kurallar",
};

test("monorepo: üç rol, profiller, dizinler, komutlar, sözleşme ve ADR yolu tespit edilir", () => {
  const r = json(repo(MONOREPO));
  const byRole = Object.fromEntries(r.apps.map((a) => [a.role, a]));
  assert.strictEqual(r.apps.length, 3, "test projesi, kök workspace ve node_modules sayılmaz: " + JSON.stringify(r.apps.map((a) => a.evidence)));
  assert.deepStrictEqual([byRole.backend.profile, byRole.backend.dir, byRole.backend.confidence], ["dotnet", "apps/api/", "tespit"]);
  assert.deepStrictEqual([byRole.mobile.profile, byRole.mobile.dir], ["react-native-expo", "apps/mobile/"]);
  assert.deepStrictEqual([byRole.web.profile, byRole.web.dir], ["nextjs", "apps/web/"]);
  assert.strictEqual(byRole.web.commands.install, "npm ci");
  assert.strictEqual(byRole.web.commands.test, "npm test");
  assert.strictEqual(byRole.mobile.commands.install, "yarn install --frozen-lockfile");
  assert.strictEqual(byRole.mobile.commands.test, "yarn test");
  assert.ok(byRole.mobile.notes.some((n) => /watch modunda/.test(n)), "jest --watch uyarısı");
  assert.ok(byRole.mobile.notes.some((n) => /'start'.*sunucu\/watch/.test(n)));
  assert.ok(byRole.web.notes.some((n) => /'dev'/.test(n)));
  assert.deepStrictEqual(r.paths.contract, { value: "apps/api/", confidence: "tespit", evidence: "apps/api/openapi.yaml" });
  assert.strictEqual(r.paths.adr.value, "docs/adr/");
  assert.strictEqual(r.docs.claudeMd, "CLAUDE.md");
  assert.strictEqual(r.name, "notlar");

  const t = r.teamDraft;
  assert.deepStrictEqual(t.roles.backend.paths, ["apps/api/"]);
  assert.deepStrictEqual(t.roles.mobile.paths, ["apps/mobile/", "Docs/Mobile/"]);
  assert.strictEqual(t.roles.web.profile, "nextjs");
  assert.strictEqual(t.paths.contract, "apps/api/");
});

test("kökte tek Next.js uygulaması: kök yerine kaynak klasörleri sahiplenilir, diğer roller kapanır", () => {
  const dir = repo({
    "package.json": { name: "site", dependencies: { next: "15" }, scripts: { build: "next build" } },
    "app/page.tsx": "", "components/a.tsx": "", "public/x.svg": "",
  });
  const r = json(dir);
  assert.strictEqual(r.apps.length, 1);
  assert.deepStrictEqual(r.teamDraft.roles.web.paths, ["app/", "components/", "public/", "Docs/Web/"]);
  assert.strictEqual(r.teamDraft.roles.backend.enabled, false);
  assert.strictEqual(r.teamDraft.roles.mobile.enabled, false);
  assert.ok(r.roles.web.notes.some((n) => /repo kökünde/.test(n)));
});

test("Flutter, saf Dart paketi, Go ve Python (framework'lü / framework'süz)", () => {
  const r = json(repo({
    "mobile/pubspec.yaml": "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n",
    "tools/pubspec.yaml": "name: cli\ndependencies:\n  args: ^2.0.0\n",
    "svc/go.mod": "module x\n",
    "ml/requirements.txt": "numpy\n",
    "api/pyproject.toml": "[project]\ndependencies = [\"fastapi\"]\n[tool.ruff]\n",
  }));
  const roles = r.apps.map((a) => `${a.role}:${a.stack}:${a.dir}`).sort();
  assert.deepStrictEqual(roles, ["backend:Go:svc/", "backend:Python (fastapi):api/", "mobile:Flutter:mobile/"]);
  assert.strictEqual(r.apps.find((a) => a.stack === "Python (fastapi)").commands.lint, "ruff check .");
  assert.strictEqual(r.roles.backend.paths.length, 2);
});

test("tanınan manifest yoksa rapor bunu söyler", () => {
  const out = scan(repo({ "notes.txt": "x" })).stdout;
  assert.match(out, /Tanınan bir uygulama manifesti bulunamadı/);
});

test("--write: şablondan değiştirilmemiş dosyalar güncellenir, değiştirilmişse .draft yazılır", { skip: !gitOk && "git yok" }, () => {
  const dir = repo(MONOREPO);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const noLayer = scan(dir, "--write");
  assert.strictEqual(noLayer.status, 1);
  assert.match(noLayer.stderr, /önce setup-project/);

  const setup = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "setup-project.js"), "--project", dir, "--no-sandbox"], { encoding: "utf8", env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" } });
  assert.ok([0, 2].includes(setup.status), setup.stdout + setup.stderr);
  const w = scan(dir, "--write");
  assert.strictEqual(w.status, 0, w.stderr);
  const team = JSON.parse(fs.readFileSync(path.join(dir, LAYER, "team.json"), "utf8"));
  assert.strictEqual(team.roles.backend.profile, "dotnet");
  const pm = fs.readFileSync(path.join(dir, LAYER, "project.md"), "utf8");
  assert.match(pm, /\*\*Backend:\*\* ASP\.NET Core `apps\/api\/` \(tespit: apps\/api\/Api\.csproj\)/);
  assert.match(pm, /\| web \| `cd apps\/web && npm ci` \(tahmin, doğrulanmadı\)/);
  assert.match(pm, /## Onboard taraması/);

  // Kullanıcı düzenledi → bir sonraki yazım dokunmaz, .draft üretir
  fs.writeFileSync(path.join(dir, LAYER, "team.json"), JSON.stringify({ ...team, protected: ["infra/"] }, null, 2));
  fs.writeFileSync(path.join(dir, LAYER, "project.md"), "KULLANICI");
  const again = scan(dir, "--write");
  assert.strictEqual(again.status, 0, again.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, LAYER, "team.json"), "utf8")).protected, ["infra/"]);
  assert.strictEqual(fs.readFileSync(path.join(dir, LAYER, "project.md"), "utf8"), "KULLANICI");
  assert.ok(fs.existsSync(path.join(dir, LAYER, "team.json.draft")));
  assert.ok(fs.existsSync(path.join(dir, LAYER, "project.md.draft")));
  assert.match(again.stderr, /taslak yanına yazıldı/);
});
