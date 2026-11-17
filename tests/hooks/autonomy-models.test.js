// Özerklik düzeyi (MustToHave madde 7) ve model seçimi + kullanım raporu (madde 11).
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
const LAYER = cfgLib.LAYER_DIR;

function project(team) {
  const dir = path.join(REPO, "tests", ".sandbox", `am-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  fs.mkdirSync(path.join(dir, LAYER), { recursive: true });
  if (team) fs.writeFileSync(path.join(dir, LAYER, "team.json"), JSON.stringify(team));
  return dir;
}

test("varsayılanlar: checkpoint, token tasarruflu model tabloları", () => {
  const { config } = cfgLib.loadConfig(project());
  assert.strictEqual(config.autonomy, "checkpoint");
  assert.deepStrictEqual(config.models, { roles: { web: "sonnet", tester: "sonnet" }, tasks: { DOC: "sonnet" } });
});

test("geçerli ayarlar yüklenir; özel rol için model verilebilir", () => {
  const { config, error } = cfgLib.loadConfig(project({
    autonomy: "autonomous",
    roles: { devops: { agent: "devops-engineer", kind: "developer", paths: ["infra/"] } },
    models: { roles: { tester: "sonnet", devops: "haiku", backend: "claude-opus-5-5" }, tasks: { TEST: "sonnet", DOC: "haiku" } },
  }));
  assert.strictEqual(error, null);
  assert.strictEqual(config.autonomy, "autonomous");
  assert.deepStrictEqual(config.models.roles, { tester: "sonnet", devops: "haiku", backend: "claude-opus-5-5" });
  assert.deepStrictEqual(config.models.tasks, { TEST: "sonnet", DOC: "haiku" });
});

test("geçersiz ayarlar hata verir", () => {
  const cases = [
    [{ autonomy: "full" }, /autonomy şunlardan biri/],
    [{ models: [] }, /models bir nesne/],
    [{ models: { byRole: {} } }, /bilinmeyen models anahtarı: byRole/],
    [{ models: { roles: { tester: "gpt-4" } } }, /models\.roles\.tester: model/],
    [{ models: { roles: { ops: "haiku" } } }, /models\.roles\.ops: team\.json'da böyle bir rol yok/],
    [{ models: { tasks: { test: "haiku" } } }, /models\.tasks\.test: geçersiz görev etiketi/],
    [{ models: { tasks: "haiku" } }, /models\.tasks bir nesne/],
  ];
  for (const [team, re] of cases) assert.match(String(cfgLib.loadConfig(project(team)).error), re, JSON.stringify(team));
});

test("SessionStart ve ön kontrol özerklik ve modelleri gösterir", () => {
  const dir = project({ autonomy: "autonomous", models: { roles: { tester: "sonnet" }, tasks: { DOC: "haiku" } } });
  const { buildContext } = require(path.join(PLUGIN, "hooks", "session-start.js"));
  const ctx = buildContext(dir);
  assert.match(ctx, /Özerklik: `autonomous`/);
  assert.match(ctx, /Teammate modelleri: tester=sonnet/);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const pf = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "team-preflight.js"), "--project", dir], { encoding: "utf8", env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" } }).stdout;
  assert.match(pf, /PASS\s+özerklik: autonomous; modeller: tester=sonnet; görev etiketleri: \[DOC\]=haiku/);
  assert.match(pf, /WARN\s+özerklik autonomous/);
});

test("lead ve team skill özerklik/model kurallarını içerir (guard dışı davranış sözleşmesi)", () => {
  const lead = fs.readFileSync(path.join(PLUGIN, "agents", "tech-lead.md"), "utf8");
  for (const s of ["### 0.1 Özerklik düzeyi", "`supervised`", "`checkpoint`", "`autonomous`", "Plan onayı her zaman alınır", "### 0.2 Model seçimi", "usage-report.js"]) assert.ok(lead.includes(s), s);
  const skill = fs.readFileSync(path.join(PLUGIN, "skills", "team", "SKILL.md"), "utf8");
  assert.match(skill, /\*\*Model:\*\*.*`model` parametresi/);
});

// ---------------------------------------------------------------- kullanım raporu
test("usage-report: model ve rol bazında toplar, tekrar eden yanıtları bir kez sayar, eski kayıtları dışarıda bırakır", () => {
  const dir = project({ roles: { devops: { agent: "devops-engineer", kind: "developer", paths: ["infra/"] } } });
  const tp = path.join(REPO, "tests", ".sandbox", `am-transcripts-${process.pid}`);
  const sess = path.join(tp, "sess1", "subagents");
  fs.mkdirSync(sess, { recursive: true });
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  const msg = (id, model, out, t = now) => JSON.stringify({ type: "assistant", timestamp: t, message: { id, model, usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 } } });
  fs.writeFileSync(path.join(tp, "sess1.jsonl"), [msg("m1", "claude-opus-5-5", 50), msg("m1", "claude-opus-5-5", 50), msg("m0", "claude-opus-5-5", 999, old), '{"type":"user"}'].join("\n"));
  fs.writeFileSync(path.join(sess, "agent-a.jsonl"), [msg("m2", "claude-sonnet-5-5", 20), msg("m3", "claude-sonnet-5-5", 30)].join("\n"));
  fs.writeFileSync(path.join(sess, "agent-a.meta.json"), JSON.stringify({ agentType: "agent-team:senior-tester" }));
  fs.writeFileSync(path.join(sess, "agent-b.jsonl"), msg("m4", "claude-haiku-5-5", 5));
  fs.writeFileSync(path.join(sess, "agent-b.meta.json"), JSON.stringify({ agentType: "devops-engineer" }));
  const run = (...a) => spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "usage-report.js"), "--project", dir, "--projects-dir", tp, ...a], { encoding: "utf8" });
  const r = JSON.parse(run("--json", "--since", "7d").stdout);
  assert.strictEqual(r.byModel["claude-opus-5-5"].output, 50, "m1 bir kez; m0 dönem dışı");
  assert.strictEqual(r.byModel["claude-sonnet-5-5"].messages, 2);
  assert.strictEqual(r.byRole["ana oturum"].output, 50);
  assert.strictEqual(r.byRole.tester.output, 50);
  assert.strictEqual(r.byRole.devops.output, 5, "özel rol de rol adıyla");
  assert.strictEqual(r.byRole.tester.cacheRead, 2000);
  const md = run().stdout;
  assert.match(md, /## Model bazında/);
  assert.match(md, /\| tester \| 2 \|/);
  assert.match(run("--since", "yarın").stderr, /--since biçimi/);
});

test("models: açıkça yazılmış tablo varsayılanın yerine geçer (birleşmez)", () => {
  const { config, error } = cfgLib.loadConfig(project({ models: { roles: {} } }));
  assert.strictEqual(error, null);
  assert.deepStrictEqual(config.models.roles, {}, "roles: {} → ajan dosyalarındaki modeller");
  assert.deepStrictEqual(config.models.tasks, { DOC: "sonnet" }, "yazılmayan tablo varsayılan kalır");
});
