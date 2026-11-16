// Proje katmanı sürümü ve yükseltme (MustToHave madde 12): lib/layer.js, setup-project --upgrade, ön kontrol.
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const PLUGIN = path.join(REPO, "plugin");
const cfgLib = require(path.join(PLUGIN, "hooks", "lib", "team-config"));
const layer = require(path.join(PLUGIN, "hooks", "lib", "layer"));
const LAYER = cfgLib.LAYER_DIR;
const gitOk = spawnSync("git", ["--version"]).status === 0;

// 0.1.0'ın kurduğu katman (version 1, evidence/sandbox yok) + kullanıcı değerleri
const V1_TEAM = {
  version: 1,
  roles: { lead: { enabled: true }, backend: { enabled: true, profile: "dotnet", paths: ["api/"] }, mobile: { enabled: false, profile: null, paths: ["mobile/"] }, web: { enabled: true, profile: "nextjs", paths: ["site/"] }, tester: { enabled: true, profile: null, paths: [] } },
  paths: { contract: "Docs/Contracts/", projectDocs: "Docs/Project/", adr: "Docs/ADR/", testDocs: "Docs/Test/" },
  protected: ["infra/prod/"],
};
const V1_STATUS = "# Proje Durumu\n<!-- team-status: sprint=S2 wave=W1 done=3 total=5 blocked=0 -->\n";

function project({ team = V1_TEAM, status = V1_STATUS, git = false } = {}) {
  const dir = path.join(REPO, "tests", ".sandbox", `layer-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  fs.mkdirSync(path.join(dir, LAYER), { recursive: true });
  fs.mkdirSync(path.join(dir, "Docs", "Project"), { recursive: true });
  if (team !== null) fs.writeFileSync(path.join(dir, LAYER, "team.json"), typeof team === "string" ? team : JSON.stringify(team, null, 2));
  if (status !== null) fs.writeFileSync(path.join(dir, "Docs", "Project", "STATUS.md"), status);
  if (git) spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
const readTeam = (dir) => JSON.parse(fs.readFileSync(path.join(dir, LAYER, "team.json"), "utf8"));
const env = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" };
const setup = (dir, ...args) => spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "setup-project.js"), "--project", dir, "--no-sandbox", ...args], { env, encoding: "utf8" });

test("şablon ve varsayılan güncel katman sürümünde", () => {
  assert.strictEqual(cfgLib.DEFAULT_CONFIG.version, cfgLib.LAYER_VERSION);
  const tpl = JSON.parse(fs.readFileSync(path.join(PLUGIN, "templates", "project", LAYER, "team.json"), "utf8"));
  assert.strictEqual(tpl.version, cfgLib.LAYER_VERSION);
  assert.strictEqual(layer.MIGRATIONS[layer.MIGRATIONS.length - 1].to, cfgLib.LAYER_VERSION, "son göç güncel sürüme getirir");
  for (let i = 1; i < layer.MIGRATIONS.length; i++) assert.strictEqual(layer.MIGRATIONS[i].from, layer.MIGRATIONS[i - 1].to, "göç zinciri kesintisiz");
});

test("layerStatus: yok, güncel, eski (version yok = 1), yeni, geçersiz", () => {
  assert.strictEqual(layer.layerStatus(project({ team: null })).status, "none");
  assert.strictEqual(layer.layerStatus(project({ team: { version: cfgLib.LAYER_VERSION } })).status, "current");
  assert.strictEqual(layer.layerStatus(project({ team: { roles: {} } })).status, "outdated");
  assert.strictEqual(layer.layerStatus(project({ team: { version: 99 } })).status, "newer");
  assert.strictEqual(layer.layerStatus(project({ team: { version: "2" } })).status, "invalid");
  assert.strictEqual(layer.layerStatus(project({ team: "{bozuk" })).status, "invalid");
});

test("loadConfig: yeni katman sürümü ve geçersiz sürüm hata (guard takım rollerini engeller); eski sürüm hata değil", () => {
  assert.match(cfgLib.loadConfig(project({ team: { version: 99 } })).error, /plugin'i güncelleyin/);
  assert.match(cfgLib.loadConfig(project({ team: { version: 0 } })).error, /pozitif bir tam sayı/);
  assert.strictEqual(cfgLib.loadConfig(project()).error, null);
  const dir = project({ team: { version: 99 } });
  const r = spawnSync(process.execPath, [path.join(PLUGIN, "hooks", "agent-guard.js")], {
    input: JSON.stringify({ agent_id: "b", agent_type: "agent-team:senior-backend-developer", tool_name: "Write", tool_input: { file_path: path.join(dir, "backend", "a.js") }, cwd: dir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8",
  });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /katman sürümü 99/);
});

test("planUpgrade v1 → güncel: yalnızca eksikler eklenir, kullanıcı değerleri korunur, ikinci koşu değişiklik üretmez", () => {
  const dir = project();
  const plan = layer.planUpgrade(dir);
  assert.strictEqual(plan.error, null);
  assert.strictEqual(plan.from, 1);
  assert.deepStrictEqual(plan.changes, [
    'team.json: + "evidence": { "mode": "warn", "maxAgeHours": 24 }',
    'team.json: + "sandbox": { "allowedDomains": [] }',
    'team.json: + "autonomy": "checkpoint"',
    'team.json: + "models": { "roles": {}, "tasks": {} }',
    'team.json: + "design": { "gate": "warn", "minScore": 8, … }',
    `team.json: version 1 → ${cfgLib.LAYER_VERSION}`,
    "Docs/Project/STATUS.md: team-status satırına unverified=0",
    "Docs/Project/plan.example.json: şablon eklendi",
    "Docs/Project/retros/_TEMPLATE.md: şablon eklendi",
  ]);
  assert.deepStrictEqual(readTeam(dir), V1_TEAM, "plan yazmaz");
  plan.apply();
  const t = readTeam(dir);
  assert.strictEqual(t.version, cfgLib.LAYER_VERSION);
  assert.deepStrictEqual(t.evidence, { mode: "warn", maxAgeHours: 24 });
  assert.deepStrictEqual(t.roles, V1_TEAM.roles);
  assert.deepStrictEqual(t.protected, ["infra/prod/"]);
  assert.match(fs.readFileSync(path.join(dir, "Docs", "Project", "STATUS.md"), "utf8"), /blocked=0 unverified=0 -->/);
  assert.ok(fs.existsSync(path.join(dir, "Docs", "Project", "retros", "_TEMPLATE.md")));
  assert.strictEqual(cfgLib.loadConfig(dir).error, null);
  assert.deepStrictEqual(layer.planUpgrade(dir).changes, []);
});

test("planUpgrade: kullanıcının zaten yazdığı alanı ezmez; yeni sürümlü katmanı reddeder", () => {
  const dir = project({ team: { ...V1_TEAM, evidence: "enforce" } });
  const plan = layer.planUpgrade(dir);
  assert.ok(!plan.changes.some((c) => /evidence/.test(c)));
  plan.apply();
  assert.strictEqual(readTeam(dir).evidence, "enforce");
  assert.match(layer.planUpgrade(project({ team: { version: 99 } })).error, /plugin'den yeni/);
  assert.match(layer.planUpgrade(project({ team: null })).error, /team\.json yok/);
});

test("setup-project: eski katmanda uyarır; --upgrade --dry-run yazmaz; --upgrade yükseltir; ön kontrol sürümü gösterir", { skip: !gitOk && "git yok" }, () => {
  const dir = project({ git: true });
  const warn = setup(dir);
  const V = cfgLib.LAYER_VERSION;
  assert.ok(warn.stdout.includes(`Katman sürümü 1, güncel ${V}. Yükseltmek için: setup-project --upgrade`), warn.stdout);
  assert.match(warn.stdout, new RegExp(`WARN\\s+katman sürümü 1, güncel ${V}`));
  assert.strictEqual(readTeam(dir).version, 1, "bayraksız yükseltmez");

  const dry = setup(dir, "--upgrade", "--dry-run");
  assert.ok(dry.stdout.includes(`v1 → v${V} (dry-run: yazılmadı)`), dry.stdout);
  assert.strictEqual(readTeam(dir).version, 1);

  const up = setup(dir, "--upgrade");
  assert.ok([0, 2].includes(up.status), up.stdout + up.stderr);
  assert.ok(up.stdout.includes(`+ team.json: version 1 → ${V}`), up.stdout);
  assert.strictEqual(readTeam(dir).version, V);
  assert.match(up.stdout, new RegExp(`PASS\\s+katman sürümü ${V} \\(güncel\\)`));
  assert.ok(setup(dir, "--upgrade").stdout.includes(`Katman güncel (v${V}); değişiklik yok`));
});

test(".githooks şablondan farklıysa kurulum ve ön kontrol uyarır; --update-githooks giderir", { skip: !gitOk && "git yok" }, () => {
  const dir = project({ team: null, status: null, git: true });
  setup(dir, "--githooks");
  assert.deepStrictEqual(layer.githooksDrift(dir), { installed: true, stale: [] });
  fs.appendFileSync(path.join(dir, ".githooks", "pre-commit"), "\n# eski sürüm\n");
  assert.deepStrictEqual(layer.githooksDrift(dir).stale, ["pre-commit"]);
  const r = setup(dir);
  assert.match(r.stdout, /\.githooks\/pre-commit plugin şablonundan farklı/);
  assert.match(r.stdout, /WARN\s+\.githooks\/pre-commit plugin şablonundan farklı/);
  setup(dir, "--update-githooks");
  assert.deepStrictEqual(layer.githooksDrift(dir).stale, []);
});

test("retro: şablon bölümleri, skill ve lead kapanış adımı", () => {
  const tpl = fs.readFileSync(path.join(PLUGIN, "templates", "project", "Docs", "Project", "retros", "_TEMPLATE.md"), "utf8");
  for (const h of ["## Veriler", "### Projeye ait", "### Framework'e ait", "## Sonraki sprint için aksiyonlar"]) assert.ok(tpl.includes(h), h);
  const skill = fs.readFileSync(path.join(PLUGIN, "skills", "retro", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: retro\n/);
  assert.match(skill, /gh issue create/);
  assert.match(skill, /Onaysız hiçbir şey dışarı gönderilmez/);
  assert.match(fs.readFileSync(path.join(PLUGIN, "agents", "tech-lead.md"), "utf8"), /\*\*Retrospektif:\*\* .*retros\/S<n>\.md/);
});
