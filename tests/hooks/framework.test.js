// Framework bütünlük testleri: plugin yapısı, ajanların generic kalması, kurulum ve ön kontrol.
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const PLUGIN = path.join(REPO, "plugin");
const SANDBOX = path.join(REPO, "tests", ".sandbox");
const cfgLib = require(path.join(PLUGIN, "hooks", "lib", "team-config"));

const THIRD_PARTY_SKILLS = ["verification-before-completion", "test-driven-development", "systematic-debugging", "owasp-security",
  "differential-review", "supply-chain-risk-auditor", "frontend-design", "ui-ux-pro-max", "impeccable", "animate",
  "review-animations", "animation-performance", "webapp-testing"];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(PLUGIN, p).split(path.sep).join("/");
const frontmatter = (file) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, "utf8"));
  return m ? m[1] : null;
};
const isThirdParty = (r) => THIRD_PARTY_SKILLS.some((s) => r.startsWith(`skills/${s}/`));

// ---------------------------------------------------------------- yapı
test("plugin manifest ve marketplace geçerli JSON, adlar tutarlı", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
  const market = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.strictEqual(plugin.name, "agent-team");
  assert.ok(/^\d+\.\d+\.\d+$/.test(plugin.version), "semver sürüm");
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, "marketplace'te plugin kaydı");
  assert.strictEqual(entry.source, "./plugin");
});

test("hooks.json geçerli ve referans verdiği betikler var", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  assert.ok(hooks.hooks && typeof hooks.hooks === "object", "üst seviye 'hooks' sarmalayıcısı");
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    for (const g of groups) for (const h of g.hooks) {
      const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(h.command);
      assert.ok(m, `${event}: komut \${CLAUDE_PLUGIN_ROOT} kullanmalı`);
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `${event}: ${m[1]} yok`);
    }
  }
  assert.ok(hooks.hooks.PreToolUse[0].matcher.split("|").includes("Agent"), "guard Agent aracını da yakalamalı");
});

test("takım ajanları plugin kurallarına uygun (tools/memory/hooks yok, Agent kapalı)", () => {
  for (const agent of Object.values(cfgLib.AGENT_BY_ROLE)) {
    const fm = frontmatter(path.join(PLUGIN, "agents", agent + ".md"));
    assert.ok(fm, agent + ": frontmatter");
    assert.match(fm, new RegExp(`^name: ${agent}$`, "m"));
    assert.doesNotMatch(fm, /^tools:/m, agent + ": tools allowlist'i proje MCP'lerini keser");
    assert.doesNotMatch(fm, /^memory:/m, agent + ": hafıza proje katmanında olmalı");
    assert.doesNotMatch(fm, /^hooks:/m, agent + ": plugin ajanlarında hooks yok sayılır");
    assert.match(fm, /^disallowedTools: Agent\b/m, agent + ": Agent kapalı olmalı");
  }
});

test("tüm ajan ve skill'lerin frontmatter'ı var; skill adları klasörle aynı", () => {
  for (const f of fs.readdirSync(path.join(PLUGIN, "agents"))) {
    const fm = frontmatter(path.join(PLUGIN, "agents", f));
    assert.ok(fm && /^name: /m.test(fm) && /^description: /m.test(fm), f);
  }
  for (const d of fs.readdirSync(path.join(PLUGIN, "skills"), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const file = path.join(PLUGIN, "skills", d.name, "SKILL.md");
    assert.ok(fs.existsSync(file), d.name + ": SKILL.md");
    assert.match(frontmatter(file), new RegExp(`^name: ${d.name}\\s*$`, "m"), d.name + ": name");
  }
});

test("${CLAUDE_PLUGIN_ROOT}/... referansları plugin içinde mevcut", () => {
  const missing = [];
  for (const f of walk(PLUGIN).filter((p) => /\.(md|js|json|sh)$/.test(p) && !isThirdParty(rel(p)))) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      const target = m[1].replace(/[.,)]+$/, "");
      if (target.includes("<")) continue;
      if (!fs.existsSync(path.join(PLUGIN, target))) missing.push(`${rel(f)} → ${target}`);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test("plugin'de projeye/kişiye/makineye özgü iz yok", () => {
  const banned = [/Not Defteri/i, /notdefteri/i, /\bAzad/i, /BootsCamp/i, /\/home\/azad/i, /C:\\\\?Users\\\\?Azad/i, /claude_do_it/i];
  const hits = [];
  for (const f of walk(PLUGIN).filter((p) => !isThirdParty(rel(p)) && !/\.claude-plugin[\\/]plugin\.json$/.test(p))) {
    const text = fs.readFileSync(f, "utf8");
    for (const re of banned) if (re.test(text)) hits.push(`${rel(f)}: ${re}`);
  }
  assert.deepStrictEqual(hits, []);
});

test("profil README'sindeki profiller mevcut", () => {
  const readme = fs.readFileSync(path.join(PLUGIN, "profiles", "README.md"), "utf8");
  for (const m of readme.matchAll(/^\| (backend|mobile|web) \| `([a-z0-9-]+)` \|/gm)) {
    assert.ok(fs.existsSync(path.join(PLUGIN, "profiles", m[1], m[2] + ".md")), `${m[1]}/${m[2]}`);
  }
});

test("şablon team.json varsayılan yapılandırmayla aynı", () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(PLUGIN, "templates", "project", cfgLib.LAYER_DIR, "team.json"), "utf8"));
  assert.deepStrictEqual(tpl, JSON.parse(JSON.stringify(cfgLib.DEFAULT_CONFIG)));
});

test("SessionStart bağlamı 10.000 karakter sınırının altında ve ana oturumla sınırlı", () => {
  const { buildContext } = require(path.join(PLUGIN, "hooks", "session-start.js"));
  const ctx = buildContext(REPO);
  assert.ok(ctx.length < 10000, `uzunluk ${ctx.length}`);
  assert.match(ctx, /agent-team:team/);
  const r = spawnSync(process.execPath, [path.join(PLUGIN, "hooks", "session-start.js")], {
    input: JSON.stringify({ agent_type: "agent-team:precommit-lead", cwd: REPO }), encoding: "utf8",
  });
  assert.strictEqual(r.stdout, "", "--agent oturumlarında bağlam enjekte edilmez");
});

// ---------------------------------------------------------------- kurulum + ön kontrol
const gitOk = spawnSync("git", ["--version"]).status === 0;

test("setup-project: katmanı kurar, tekrar çalıştırınca hiçbir şeyin üzerine yazmaz, preflight geçer", { skip: !gitOk && "git yok" }, () => {
  const proj = path.join(SANDBOX, "setup-" + process.pid);
  fs.rmSync(proj, { recursive: true, force: true });
  fs.mkdirSync(proj, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: proj });
  const env = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" };
  delete env.CLAUDE_PROJECT_DIR;
  const run = (args) => spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "setup-project.js"), "--project", proj, ...args], { cwd: proj, env, encoding: "utf8" });

  const first = run(["--githooks", "--name", "ornek-proje"]);
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  for (const f of ["AdditionalAgentInformation/project.md", "AdditionalAgentInformation/team.json", "AdditionalAgentInformation/agents/backend/MEMORY.md",
    "Docs/Project/STATUS.md", "Docs/ADR/0000-template.md", ".githooks/pre-commit", ".githooks/review-cache.js", ".gitignore", ".gitattributes"]) {
    assert.ok(fs.existsSync(path.join(proj, f)), f);
  }
  assert.match(fs.readFileSync(path.join(proj, "AdditionalAgentInformation/project.md"), "utf8"), /Proje adı:\*\* ornek-proje/);
  assert.match(fs.readFileSync(path.join(proj, "Docs/Project/STATUS.md"), "utf8"), /team-status: sprint=S0/);
  assert.strictEqual(spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: proj, encoding: "utf8" }).stdout.trim(), ".githooks");
  assert.match(first.stdout, /PREFLIGHT: (PASS|WARN)/);

  fs.writeFileSync(path.join(proj, "AdditionalAgentInformation/project.md"), "KULLANICI İÇERİĞİ");
  const second = run(["--githooks"]);
  assert.strictEqual(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /Oluşturulan \(0\)/);
  assert.strictEqual(fs.readFileSync(path.join(proj, "AdditionalAgentInformation/project.md"), "utf8"), "KULLANICI İÇERİĞİ");
});

test("preflight: proje katmanı yoksa FAIL (exit 1)", { skip: !gitOk && "git yok" }, () => {
  const proj = path.join(SANDBOX, "bare-" + process.pid);
  fs.rmSync(proj, { recursive: true, force: true });
  fs.mkdirSync(proj, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: proj });
  const r = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "team-preflight.js"), "--project", proj], {
    encoding: "utf8", env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" },
  });
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /AdditionalAgentInformation\/ yok/);
});

test("setup-project: framework reposuna / plugin klasörüne kurulmayı reddeder", () => {
  for (const target of [PLUGIN, REPO]) {
    const r = spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "setup-project.js"), "--project", target, "--dry-run"], { encoding: "utf8" });
    assert.strictEqual(r.status, 1, target + ": " + r.stdout + r.stderr);
    assert.match(r.stderr, /framework/);
  }
});

// ---------------------------------------------------------------- davranış testleri (evals/) bütünlüğü
test("evals: her vaka case.yaml + scaffold.sh içerir, plugin'i doğru yoldan ve en az bir grader'la verir", () => {
  const evals = path.join(REPO, "evals");
  assert.ok(fs.existsSync(path.join(evals, "run.sh")), "evals/run.sh");
  assert.ok(fs.existsSync(path.join(evals, "lib", "scaffold.sh")), "evals/lib/scaffold.sh");
  assert.ok(!fs.existsSync(path.join(PLUGIN, "evals")), "eval'ler plugin'le dağıtılmaz");
  let count = 0;
  for (const suite of ["smoke", "full"]) {
    for (const c of fs.readdirSync(path.join(evals, suite))) {
      const dir = path.join(evals, suite, c);
      if (c === "results" || !fs.statSync(dir).isDirectory()) continue;
      count++;
      const y = fs.readFileSync(path.join(dir, "case.yaml"), "utf8");
      assert.match(y, /^schema_version: "1\.1"$/m, `${suite}/${c}`);
      assert.match(y, new RegExp(`^name: ${c}$`, "m"), `${suite}/${c}: name klasör adıyla aynı olmalı`);
      assert.match(y, /^plugins: \["\.\.\/\.\.\/\.\.\/plugin"\]$/m, `${suite}/${c}: plugin yolu`);
      assert.match(y, /^graders:\s*\n\s+- name:/m, `${suite}/${c}: grader yok`);
      assert.match(y, /scaffold_script: scaffold\.sh/, `${suite}/${c}`);
      assert.match(fs.readFileSync(path.join(dir, "scaffold.sh"), "utf8"), /\.\.\/\.\.\/lib\/scaffold\.sh/, `${suite}/${c}: ortak kurulum`);
      assert.ok(path.resolve(dir, "../../../plugin") === PLUGIN, `${suite}/${c}: ../../../plugin plugin klasörüne çözülmeli`);
    }
  }
  assert.ok(count >= 9, `vaka sayısı: ${count}`);
});

test("preflight: project.md açıklamasındaki `<doldur>` alan sayılmaz; boş satırlar listelenir", () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-doldur-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "setup-project.js"), "--project", dir, "--no-sandbox"], { encoding: "utf8" });
  const pm = path.join(dir, "AdditionalAgentInformation", "project.md");
  const pf = () => spawnSync(process.execPath, [path.join(PLUGIN, "scripts", "team-preflight.js"), "--project", dir], { encoding: "utf8" }).stdout;
  assert.match(pf(), /doldurulmamış alanlar var \(<doldur>; satır \d/);
  assert.doesNotMatch(pf(), /satır 3[,)]/, "açıklama satırı sayılmaz");
  fs.writeFileSync(pm, fs.readFileSync(pm, "utf8").split(/\r?\n/).map((l) => (/(?<!`)<doldur>(?!`)/.test(l) ? l.replace(/(?<!`)<doldur>(?!`)/g, "henüz karar verilmedi") : l)).join("\n"));
  assert.doesNotMatch(pf(), /doldurulmamış/);
});
