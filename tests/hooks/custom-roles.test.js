// Yapılandırmadan tanımlanan roller (MustToHave madde 9): team.json > roles.<ad> = { agent, kind, paths }.
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const PLUGIN = path.join(REPO, "plugin");
const HOOKS = path.join(PLUGIN, "hooks");
const cfgLib = require(path.join(HOOKS, "lib", "team-config"));
const ALLOW = 0, BLOCK = 2;

const CUSTOM = {
  devops: { agent: "devops-engineer", kind: "developer", paths: ["infra/"], description: "CI/CD ve altyapı" },
  security: { agent: "sec-plugin:security-reviewer", kind: "reviewer", paths: ["Docs/Security/"] },
  writer: { agent: "tech-writer", kind: "docs", paths: ["docs-site/"] },
  dba: { agent: "dba", kind: "allowlist", paths: ["db/migrations/"] },
};
function project(team = { roles: CUSTOM }) {
  const dir = path.join(REPO, "tests", ".sandbox", `custom-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  fs.mkdirSync(path.join(dir, cfgLib.LAYER_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, cfgLib.LAYER_DIR, "team.json"), typeof team === "string" ? team : JSON.stringify(team));
  return dir;
}
const put = (dir, team) => fs.writeFileSync(path.join(dir, cfgLib.LAYER_DIR, "team.json"), JSON.stringify(team));

function guard(dir, agentType, tool, toolInput) {
  return spawnSync(process.execPath, [path.join(HOOKS, "agent-guard.js")], {
    input: JSON.stringify({ agent_id: "a-" + agentType, agent_type: agentType, tool_name: tool, tool_input: toolInput, cwd: dir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
}
const write = (dir, agentType, rel) => guard(dir, agentType, "Write", { file_path: path.join(dir, rel), content: "x" }).status;

// ---------------------------------------------------------------- yapılandırma
test("özel roller yüklenir; yerleşik rollerle birlikte çalışır", () => {
  const dir = project();
  const { config, error } = cfgLib.loadConfig(dir);
  assert.strictEqual(error, null);
  assert.deepStrictEqual(config.roles.devops, { custom: true, agent: "devops-engineer", kind: "developer", enabled: true, profile: null, paths: ["infra/"], description: "CI/CD ve altyapı" });
  assert.strictEqual(config.roles.backend.paths[0], "backend/");
  assert.deepStrictEqual(cfgLib.devRoles(config), ["backend", "mobile", "web", "devops"]);
  assert.strictEqual(cfgLib.roleFor("devops-engineer", config), "devops", "proje ajanı (öneksiz)");
  assert.strictEqual(cfgLib.roleFor("some-plugin:devops-engineer", config), "devops", "öneksiz tanım ad eşleşmesiyle");
  assert.strictEqual(cfgLib.roleFor("sec-plugin:security-reviewer", config), "security");
  assert.strictEqual(cfgLib.roleFor("other:security-reviewer", config), null, "önekli tanım tam eşleşme ister");
  assert.strictEqual(cfgLib.roleFor("agent-team:senior-backend-developer", config), "backend");
  assert.strictEqual(cfgLib.agentForRole("devops", config), "devops-engineer");
  assert.strictEqual(cfgLib.agentForRole("web", config), "agent-team:senior-web-developer");
  assert.deepStrictEqual(cfgLib.rolesForTag("DEVOPS", config), ["devops"]);
  assert.strictEqual(cfgLib.rolesForTag("SECURITY", config), null, "geliştirici olmayan rolün görevi kanıt kapısına girmez");
  assert.ok(cfgLib.rolesForTag("FIX", config).includes("devops"));
});

test("geçersiz özel rol tanımları hata verir", () => {
  const dir = project();
  const cases = [
    [{ Ops: { agent: "x", kind: "developer", paths: ["a/"] } }, /rol adı/],
    [{ fix: { agent: "x", kind: "developer", paths: ["a/"] } }, /ayrılmış/],
    [{ ops: { kind: "developer", paths: ["a/"] } }, /agent/],
    [{ ops: { agent: "senior-web-developer", kind: "developer", paths: ["a/"] } }, /yerleşik bir takım ajanı/],
    [{ ops: { agent: "x", kind: "admin", paths: ["a/"] } }, /kind/],
    [{ ops: { agent: "x", kind: "docs", paths: [] } }, /en az bir yol/],
    [{ ops: { agent: "x", kind: "developer", paths: ["../dışarı/"] } }, /göreli yol/],
    [{ ops: { agent: "x", kind: "developer", paths: ["a/"], tools: ["Bash"] } }, /bilinmeyen anahtar tools/],
    [{ ops: { agent: "x", kind: "developer", paths: ["a/"] }, ops2: { agent: "x", kind: "reviewer" } }, /ops rolüyle aynı/],
    [{ ops: { agent: "x", kind: "developer", paths: ["backend/api/"] } }, /sahiplik çakışması: backend \(backend\/\) ve ops \(backend\/api\/\)/],
    [{ backend: { kind: "reviewer" } }, /yerleşik rolün agent\/kind/],
  ];
  for (const [roles, re] of cases) {
    put(dir, { roles });
    assert.match(String(cfgLib.loadConfig(dir).error), re, JSON.stringify(roles));
  }
  put(dir, { roles: { ops: { agent: "x", kind: "reviewer" } } });
  assert.strictEqual(cfgLib.loadConfig(dir).error, null, "reviewer yolsuz olabilir");
});

// ---------------------------------------------------------------- guard
test("guard: özel developer kendi yolunun sahibi; yerleşikler ve diğerleri oraya yazamaz", () => {
  const dir = project();
  assert.strictEqual(write(dir, "devops-engineer", "infra/main.tf"), ALLOW);
  assert.strictEqual(write(dir, "devops-engineer", "scripts/ci.sh"), ALLOW, "sahipsiz yol");
  assert.strictEqual(write(dir, "devops-engineer", "backend/app.js"), BLOCK);
  assert.strictEqual(write(dir, "devops-engineer", "Docs/Contracts/openapi.yaml"), BLOCK, "sözleşme backend'in");
  assert.strictEqual(write(dir, "devops-engineer", "Docs/Project/STATUS.md"), BLOCK);
  assert.strictEqual(write(dir, "devops-engineer", ".github/workflows/ci.yml"), BLOCK, "korumalı yollar özel rollere de uygulanır");
  assert.strictEqual(write(dir, "devops-engineer", `${cfgLib.LAYER_DIR}/agents/devops/MEMORY.md`), ALLOW);
  assert.strictEqual(write(dir, "devops-engineer", `${cfgLib.LAYER_DIR}/agents/devops/instructions.md`), BLOCK);
  const r = guard(dir, "agent-team:senior-backend-developer", "Write", { file_path: path.join(dir, "infra/x.tf") });
  assert.strictEqual(r.status, BLOCK);
  assert.match(r.stderr, /devops rolüne \(devops-engineer\) ait/);
});

test("guard: reviewer / docs / allowlist yalnızca kendi yollarına yazar", () => {
  const dir = project();
  assert.strictEqual(write(dir, "sec-plugin:security-reviewer", "Docs/Security/report.md"), ALLOW);
  assert.strictEqual(write(dir, "sec-plugin:security-reviewer", "backend/fix.js"), BLOCK);
  assert.strictEqual(write(dir, "sec-plugin:security-reviewer", `${cfgLib.LAYER_DIR}/agents/security/WORKLOG.md`), ALLOW);
  assert.strictEqual(write(dir, "tech-writer", "docs-site/index.md"), ALLOW);
  assert.strictEqual(write(dir, "tech-writer", "README.md"), BLOCK);
  assert.strictEqual(write(dir, "dba", "db/migrations/001.sql"), ALLOW);
  assert.strictEqual(write(dir, "dba", "db/seed.sql"), BLOCK);
  const bash = guard(dir, "tech-writer", "Bash", { command: "echo x > src/a.js" });
  assert.strictEqual(bash.status, BLOCK, "Bash yazma hedefleri de");
  assert.strictEqual(guard(dir, "tech-writer", "Bash", { command: "git push" }).status, BLOCK, "genel Bash kuralları");
  assert.strictEqual(guard(dir, "tech-writer", "Agent", { subagent_type: "x" }).status, BLOCK, "alt agent yasağı");
});

test("guard: team.json bozukken özel rol fail-closed engellenir, ilgisiz agent etkilenmez", () => {
  const dir = project('{ "roles": { "devops": { "agent": "devops-engineer", "kind": "developer", "paths": ["infra/"] } ');
  const r = guard(dir, "devops-engineer", "Write", { file_path: path.join(dir, "infra/a.tf") });
  assert.strictEqual(r.status, BLOCK);
  assert.match(r.stderr, /okunamadı/);
  assert.strictEqual(write(dir, "Explore", "x.md"), ALLOW);
  assert.strictEqual(write(dir, "agent-team:senior-backend-developer", "backend/a.js"), BLOCK, "yerleşik roller de engellenir");
});

test("guard: devre dışı özel rol yine tanınır ve kısıtlanır", () => {
  const dir = project({ roles: { ...CUSTOM, dba: { ...CUSTOM.dba, enabled: false } } });
  assert.strictEqual(write(dir, "dba", "src/a.js"), BLOCK);
});

// ---------------------------------------------------------------- diğer hook'lar
test("SessionStart eşlemesi özel rolleri içerir; SubagentStart özel role bağlam verir", () => {
  const dir = project();
  const { buildContext } = require(path.join(HOOKS, "session-start.js"));
  const ctx = buildContext(dir);
  assert.match(ctx, /`devops` → `devops-engineer`/);
  assert.match(ctx, /`security` → `sec-plugin:security-reviewer`/);
  assert.match(ctx, /devops \[özel: developer\]/);

  const run = (agentType) => spawnSync(process.execPath, [path.join(HOOKS, "subagent-start.js")], {
    input: JSON.stringify({ agent_id: "s1", agent_type: agentType, cwd: dir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "cr-data-")) },
    encoding: "utf8",
  });
  const out = JSON.parse(run("devops-engineer").stdout).hookSpecificOutput.additionalContext;
  assert.match(out, /sen `devops` rolüsün \(özel rol, developer\)/);
  assert.ok(out.includes(path.join(PLUGIN, "TEAM_RULES.md")), "TEAM_RULES mutlak yolu");
  assert.match(out, /\[DEVOPS\] S<n>-<m>/);
  assert.strictEqual(run("agent-team:senior-backend-developer").stdout, "", "yerleşik rollere ek bağlam yok");
  assert.strictEqual(run("Explore").stdout, "");
});

test("kanıt: özel rolün komutu kaydedilir; [DEVOPS] görevi kanıtla kapanır", () => {
  const dir = project();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cr-ledger-"));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: data };
  const rec = spawnSync(process.execPath, [path.join(HOOKS, "ledger-record.js")], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "terraform validate" }, tool_response: { stdout: "Success!" }, agent_id: "d1", agent_type: "devops-engineer", cwd: dir }),
    env, encoding: "utf8",
  });
  const id = /L-[0-9a-f]{8}/.exec(rec.stdout)[0];
  const close = (subject, agentId) => spawnSync(process.execPath, [path.join(HOOKS, "task-completed.js")], {
    input: JSON.stringify({ task_id: "1", task_subject: subject, task_description: `Komut: terraform validate\nDizin: ${dir}/infra\nSonuç: geçerli, exit 0\nKanıt: ${id}`, agent_id: agentId, cwd: dir }),
    env, encoding: "utf8",
  });
  const ok = close("[DEVOPS] S1-07 CI hattı", "d1");
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.strictEqual(ok.stdout, "", "doğrulandı, uyarı yok");
  const wrong = close("[BACKEND] S1-08 Başka", "d1");
  assert.match(JSON.parse(wrong.stdout).systemMessage, /devops rolüne ait/);
  const notGated = close("[SECURITY] S1-09 Tarama", "s1");
  assert.strictEqual(notGated.status, 0);
  assert.strictEqual(notGated.stdout, "", "geliştirici olmayan rolün görevi kapıya girmez");
});

test("preflight: eksik özel ajan FAIL, proje ajanı bulunursa PASS ve guard denemesi geçer", { skip: spawnSync("git", ["--version"]).status !== 0 && "git yok" }, () => {
  const dir = project({ roles: { devops: CUSTOM.devops, writer: CUSTOM.writer } });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const pf = () => spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "team-preflight.js"), "--project", dir], {
    env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }, encoding: "utf8",
  }).stdout;
  let out = pf();
  assert.match(out, /FAIL\s+devops \(özel, developer\): ajan dosyası bulunamadı/);
  fs.mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  const tpl = fs.readFileSync(path.join(PLUGIN, "templates", "agents", "custom-role.md"), "utf8");
  for (const [role, agent] of [["devops", "devops-engineer"], ["writer", "tech-writer"]]) {
    fs.writeFileSync(path.join(dir, ".claude", "agents", agent + ".md"), tpl.replace(/<ajan-adı>/g, agent).replace(/<rol>/g, role));
  }
  out = pf();
  assert.match(out, /PASS\s+devops \(özel, developer\): ajan devops-engineer bulundu/);
  assert.match(out, /PASS\s+guard devops: backend\/probe\.ts engellendi, infra\/PROBE\.md serbest/);
  assert.match(out, /PASS\s+guard writer: agent-team-probe\/probe\.ts engellendi, docs-site\/PROBE\.md serbest/);
});
