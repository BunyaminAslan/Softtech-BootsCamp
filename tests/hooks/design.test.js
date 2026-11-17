// Tasarım kapısı (MustToHave madde 10): lib/design.js ve task-completed entegrasyonu.
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
const design = require(path.join(HOOKS, "lib", "design"));
const LAYER = cfgLib.LAYER_DIR;
const VARIANTS = ["mobile-light", "mobile-dark", "desktop-light", "desktop-dark"];
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function project({ team, review = "full", score = 9, images = VARIANTS, adr = true, unchecked = 0 } = {}) {
  const dir = path.join(REPO, "tests", ".sandbox", `design-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  fs.mkdirSync(path.join(dir, LAYER), { recursive: true });
  fs.mkdirSync(path.join(dir, "Docs", "Project"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Docs", "ADR"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Docs", "Design", "reviews", "S1-02"), { recursive: true });
  if (team) fs.writeFileSync(path.join(dir, LAYER, "team.json"), JSON.stringify(team));
  if (adr) fs.writeFileSync(path.join(dir, "Docs", "ADR", "0001-design.md"), "# ADR");
  for (const v of images) fs.writeFileSync(path.join(dir, "Docs", "Design", "reviews", "S1-02", v + ".png"), PNG);
  fs.writeFileSync(path.join(dir, "Docs", "Project", "STATUS.md"), [
    "<!-- team-status: sprint=S1 wave=W2 done=0 total=2 blocked=0 unverified=0 -->",
    "| Görev | Sahip | Dalga | Bekler | Durum | Not |", "|---|---|---|---|---|---|",
    "| [WEB] S1-02 Liste ekranı | web | W2 | — | 🟡 Devam ediyor | |",
    "| [WEB] S1-05 API istemcisi | web | W2 | — | 🟡 Devam ediyor | |",
  ].join("\n"));
  if (review) {
    const rows = VARIANTS.map((v) => `| ${v} | Docs/Design/reviews/S1-02/${v}.png |`).join("\n");
    const checks = ["Token'lar uyumlu", "Kontrast", "Durumlar"].map((c, i) => `- [${i < 3 - unchecked ? "x" : " "}] ${c}`).join("\n");
    fs.writeFileSync(path.join(dir, "Docs", "Design", "reviews", "S1-02.md"),
      `# Tasarım incelemesi: S1-02\n\nADR: Docs/ADR/0001-design.md\nPuan: ${score}/10\n\n| Varyant | Görüntü |\n|---|---|\n${rows}\n\n## Kontrol listesi\n${checks}\n`);
  }
  return dir;
}

const UI_DESC = (extra = "Tasarım: Docs/Design/reviews/S1-02.md") => `UI: evet\nKomut: sh test.sh\nDizin: web\nSonuç: 3/3\n${extra}`;
const evalD = (dir, desc) => design.evaluateDesign(dir, desc, cfgLib.loadConfig(dir).config);

test("UI olmayan görev ve gate=off kapıya girmez", () => {
  const dir = project();
  assert.strictEqual(evalD(dir, "Komut: x").required, false);
  const off = project({ team: { design: { gate: "off" } } });
  assert.strictEqual(evalD(off, UI_DESC()).required, false);
  assert.ok(design.isUiTask("- **UI:** evet"));
  assert.ok(!design.isUiTask("UI: hayır"));
});

test("eksiksiz inceleme geçer; işaretlenmemiş madde yalnızca uyarı", () => {
  const ok = evalD(project(), UI_DESC());
  assert.deepStrictEqual([ok.required, ok.score, ok.problems], [true, 9, []]);
  const warn = evalD(project({ unchecked: 2 }), UI_DESC());
  assert.deepStrictEqual(warn.problems, []);
  assert.match(warn.warnings[0], /işaretlenmemiş 2 madde/);
});

test("eksikler tek tek yakalanır", () => {
  assert.match(evalD(project(), UI_DESC("")).problems[0], /`Tasarım: Docs\/Design\/reviews\/<görev>\.md` satırı yok/);
  assert.match(evalD(project({ review: null }), UI_DESC()).problems[0], /bulunamadı/);
  assert.match(evalD(project({ score: 6 }), UI_DESC()).problems.join(), /puan 6\/10, eşik 8\/10/);
  assert.match(evalD(project({ images: ["mobile-light"] }), UI_DESC()).problems.join(), /'mobile-dark' görüntüsü bulunamadı/);
  assert.match(evalD(project({ adr: false }), UI_DESC()).problems.join(), /ADR bulunamadı/);
  assert.match(evalD(project(), UI_DESC("Tasarım: ../dışarı.md")).problems[0], /proje dışında/);
  const custom = project({ team: { design: { variants: ["light", "dark"], minScore: 9 } } });
  assert.match(evalD(custom, UI_DESC()).problems.join(), /'light' varyantının ekran görüntüsü satırı yok/);
});

test("team.json design doğrulaması", () => {
  const bad = [
    [{ gate: "strict" }, /design\.gate/], [{ minScore: 11 }, /minScore/], [{ variants: [] }, /variants/],
    [{ variants: ["Mobile Light"] }, /variants/], [{ reviews: "../x" }, /design\.reviews/], [{ size: 1 }, /bilinmeyen design anahtarı/],
  ];
  for (const [d, re] of bad) assert.match(String(cfgLib.loadConfig(project({ team: { design: d } })).error), re, JSON.stringify(d));
  assert.strictEqual(cfgLib.loadConfig(project()).config.design.gate, "warn");
});

// ---------------------------------------------------------------- task-completed entegrasyonu
function close(dir, desc, subject = "[WEB] S1-02 Liste ekranı") {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "design-data-"));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: data };
  const rec = spawnSync(process.execPath, [path.join(HOOKS, "ledger-record.js")], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "sh test.sh" }, tool_response: { stdout: "# pass 3\n# fail 0" }, agent_id: "w", agent_type: "agent-team:senior-web-developer", cwd: dir }),
    env, encoding: "utf8",
  });
  const id = /L-[0-9a-f]{8}/.exec(rec.stdout)[0];
  const r = spawnSync(process.execPath, [path.join(HOOKS, "task-completed.js")], {
    input: JSON.stringify({ task_id: "2", task_subject: subject, task_description: `${desc}\nKanıt: ${id}`, cwd: dir }), env, encoding: "utf8",
  });
  r.json = r.stdout ? JSON.parse(r.stdout) : null;
  r.status_md = fs.readFileSync(path.join(dir, "Docs", "Project", "STATUS.md"), "utf8");
  return r;
}

test("kapanış: geçen tasarım kapısı ✅, sessiz", () => {
  const r = close(project(), UI_DESC());
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, "");
  assert.match(r.status_md, /S1-02 Liste ekranı \| web \| W2 \| — \| ✅ Tamamlandı/);
  assert.ok(!/design=/.test(r.status_md), "kapı kullanılmadıkça sayaç eklenmez");
});

test("kapanış (warn): eksik inceleme → görev kapanır, ⚠️ Tasarım, design sayacı, uyarı", () => {
  const r = close(project({ score: 5 }), UI_DESC());
  assert.strictEqual(r.status, 0);
  assert.match(r.json.systemMessage, /TASARIM KAPISI GEÇİLMEDİ/);
  assert.match(r.json.systemMessage, /puan 5\/10/);
  assert.match(r.status_md, /S1-02 Liste ekranı \| web \| W2 \| — \| ⚠️ Tasarım/);
  assert.match(r.status_md, /done=1 total=2 blocked=0 unverified=0 design=1 -->/);
});

test("kapanış (enforce): eksik inceleme engellenir; UI olmayan görev etkilenmez", () => {
  const dir = project({ team: { design: { gate: "enforce" } }, review: null });
  const r = close(dir, UI_DESC());
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /K8 \(design\.gate: enforce\)/);
  assert.match(r.status_md, /S1-02 .*🟡 Devam ediyor/);
  const other = close(dir, "Komut: sh test.sh\nDizin: web\nSonuç: 3/3", "[WEB] S1-05 API istemcisi");
  assert.strictEqual(other.status, 0);
  assert.strictEqual(other.stdout, "");
});

test("şablon tasarım incelemesi kurulumla gelir ve varsayılan varyantları içerir", () => {
  const tpl = fs.readFileSync(path.join(PLUGIN, "templates", "project", "Docs", "Design", "reviews", "_TEMPLATE.md"), "utf8");
  for (const v of cfgLib.DEFAULT_CONFIG.design.variants) assert.match(tpl, new RegExp(`^\\| ${v} \\|`, "m"));
  assert.match(tpl, /^Puan: /m);
  assert.match(tpl, /^ADR: /m);
});

test("browser: Playwright Chromium tespiti, SessionStart uyarısı yalnızca katman varken", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const PLUGIN = path.join(__dirname, "..", "..", "plugin");
  const browser = require(path.join(PLUGIN, "hooks", "lib", "browser.js"));
  const { buildContext, buildSystemMessage } = require(path.join(PLUGIN, "hooks", "session-start.js"));
  const pwDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-"));
  const env = { PLAYWRIGHT_BROWSERS_PATH: pwDir };
  assert.equal(browser.playwrightChromium(env).installed, false);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
  const missing = browser.playwrightChromium(env);
  assert.equal(buildSystemMessage(proj, missing), null, "katman yokken uyarı yok");
  fs.mkdirSync(path.join(proj, "AdditionalAgentInformation"));
  assert.match(buildSystemMessage(proj, missing), /npx playwright install chromium/);
  assert.match(buildContext(proj, missing), /onaysız indirme/);
  fs.mkdirSync(path.join(pwDir, "chromium-1200"));
  const ok = browser.playwrightChromium(env);
  assert.equal(ok.installed, true);
  assert.equal(buildSystemMessage(proj, ok), null);
  assert.doesNotMatch(buildContext(proj, ok), /Chromium kurulu değil/);
});

// Canlı test F9 (0.11.5): MCP'nin playwright-core'unun istediği revizyon, kurulu Chromium'dan farklı olabilir.
test("browser: mcpChromium, MCP paketinin istediği Chromium revizyonunu bulur", () => {
  const browser = require(path.join(PLUGIN, "hooks", "lib", "browser.js"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpc-"));
  const nm = path.join(root, "cache", "_npx", "abc123", "node_modules");
  fs.mkdirSync(path.join(nm, "@playwright", "mcp"), { recursive: true });
  fs.mkdirSync(path.join(nm, "playwright-core"), { recursive: true });
  fs.writeFileSync(path.join(nm, "@playwright", "mcp", "package.json"), JSON.stringify({ version: "0.0.84" }));
  fs.writeFileSync(path.join(nm, "playwright-core", "browsers.json"), JSON.stringify({ browsers: [{ name: "chromium", revision: "1252" }] }));
  const env = { npm_config_cache: path.join(root, "cache"), PLAYWRIGHT_BROWSERS_PATH: path.join(root, "pw") };
  fs.mkdirSync(path.join(root, "pw", "chromium-1255"), { recursive: true });
  let r = browser.mcpChromium("0.0.84", env);
  assert.equal(r.revision, "1252");
  assert.equal(r.installed, false, "yalnızca başka revizyon kurulu");
  assert.match(r.install, /cli\.js" install chromium/);
  assert.equal(browser.mcpChromium("9.9.9", env), null, "başka MCP sürümü");
  fs.mkdirSync(path.join(root, "pw", "chromium-1252"));
  assert.equal(browser.mcpChromium("0.0.84", env).installed, true);
  fs.rmSync(root, { recursive: true, force: true });
});
