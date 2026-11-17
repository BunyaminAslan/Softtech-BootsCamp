"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN = path.join(__dirname, "..", "..", "plugin");
const planLib = require(path.join(PLUGIN, "hooks", "lib", "plan.js"));
const cfgLib = require(path.join(PLUGIN, "hooks", "lib", "team-config.js"));
const SCRIPT = path.join(PLUGIN, "scripts", "plan.js");
const TEMPLATE = path.join(PLUGIN, "templates", "project", "Docs", "Project", "plan.example.json");

const cfg = () => cfgLib.loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), "plan-cfg-"))).config;
const base = () => ({
  sprint: 1,
  goal: "Kullanıcı e-posta ile giriş yapabilsin",
  scope: [{ id: "G1", text: "Giriş API'si" }, { id: "G2", text: "Giriş ekranı" }],
  stories: [{ id: "US-1", title: "Giriş", scope: ["G1", "G2"] }],
  tasks: [
    { id: "S1-01", tag: "CONTRACT", title: "Auth sözleşmesi", owner: "backend", story: "US-1", done: ["Docs/Contracts/auth.yaml var"], estimate: "S" },
    { id: "S1-02", tag: "BACKEND", title: "POST /auth/login", owner: "backend", story: "US-1", dependsOn: ["S1-01"], done: ["`dotnet test` geçer"], estimate: "M" },
    { id: "S1-03", tag: "WEB", title: "Login sayfası", owner: "web", story: "US-1", softDependsOn: ["S1-02"], dependsOn: ["S1-01"], done: ["`npx vitest run` geçer"], ui: true },
    { id: "S1-04", tag: "TEST", title: "E2E", owner: "tester", story: "US-1", dependsOn: ["S1-02", "S1-03"], done: ["`npx playwright test` geçer"] },
  ],
});

test("geçerli plan: hata yok, dalgalar hesaplanır", () => {
  const r = planLib.checkPlan(base(), cfg());
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.waves, { "S1-01": 1, "S1-02": 2, "S1-03": 2, "S1-04": 3 });
});

test("döngü, sahipsiz, kapalı rol, bilinmeyen bağımlılık", () => {
  const p = base();
  p.tasks[0].dependsOn = ["S1-04"];
  p.tasks[1].owner = undefined;
  p.tasks[2].dependsOn.push("S9-99");
  const c = cfg();
  c.roles.tester.enabled = false;
  const e = planLib.checkPlan(p, c).errors.join("\n");
  assert.match(e, /döngüsel bağımlılık: S1-01 → .*S1-01/);
  assert.match(e, /S1-02: sahipsiz/);
  assert.match(e, /S1-04: kapalı role atanmış \(tester/);
  assert.match(e, /bilinmeyen görev S9-99/);
});

test("K5: bitmeyen komut ve ölçülemeyen kriter; timeout'lu komut serbest", () => {
  const p = base();
  p.tasks[2].done = ["`npx next dev` açılır", "çalışır"];
  p.tasks[1].done = ["`npm run dev` ile bakıldı", "`timeout 120 npx next start -p 3000 &` → kontrol"];
  p.tasks[3].done = [];
  const e = planLib.checkPlan(p, cfg()).errors.join("\n");
  assert.match(e, /S1-03: bitti kriterinde bitmeyen komut \(K5\): `npx next dev`/);
  assert.match(e, /S1-03: ölçülemeyen bitti kriteri: "çalışır"/);
  assert.match(e, /S1-02: .*`npm run dev`/);
  assert.doesNotMatch(e, /timeout 120/);
  assert.match(e, /S1-04: bitti kriteri yok/);
  assert.deepStrictEqual(planLib.nonTerminating("`npx vitest run` ve `npx vitest`"), ["npx vitest"]);
});

test("kapsam matrisi: karşılıksız madde, story'siz görev, yanlış dalga", () => {
  const p = base();
  p.scope.push({ id: "G3", text: "Şifre sıfırlama" });
  p.stories.push({ id: "US-2", title: "Sıfırlama", scope: ["G3"] });
  p.tasks[1].story = "US-9";
  p.tasks[3].wave = 2;
  const r = planLib.checkPlan(p, cfg());
  const e = r.errors.join("\n");
  assert.match(e, /kapsam G3: hiçbir göreve karşılık gelmiyor/);
  assert.match(e, /S1-02: bilinmeyen story US-9/);
  assert.match(e, /S1-04: W2 yazılmış ama .* en erken W3/);
  assert.match(r.warnings.join("\n"), /story US-2: görevi yok/);
});

test("render + merge: görev kartları, Mermaid, dalga tablosu; serbest metin korunur, tekrar çalıştırma aynı", () => {
  const p = base();
  const md = planLib.renderPlan(p);
  assert.match(md, /## Ana hedef\n\nKullanıcı e-posta/);
  assert.match(md, /S1_01 --> S1_02/);
  assert.match(md, /S1_02 -.-> S1_03/);
  assert.match(md, /\| W3 \| — \| — \| S1-04 \[TEST\] E2E \|/);
  assert.match(md, /- Açar: S1-02, S1-03/);
  assert.match(md, /- UI: evet/);
  const first = planLib.mergeIntoMarkdown("# Sprint 1\n\nNotlar: risk X\n", md, 1);
  assert.match(first, /Notlar: risk X/);
  const second = planLib.mergeIntoMarkdown(first, md, 1);
  assert.strictEqual(second, first);
});

test("plan.js CLI: check/render çıkış kodları; şablon örneği geçerli", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-cli-"));
  const docs = path.join(dir, "Docs", "Project");
  fs.mkdirSync(docs, { recursive: true });
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a, "--project", dir], { encoding: "utf8" });
  assert.strictEqual(run("check").status, 2, "plan.json yok");
  fs.writeFileSync(path.join(docs, "plan.json"), JSON.stringify(base()));
  assert.strictEqual(run("check").status, 0);
  const r = run("render");
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(docs, "SPRINT_PLAN.md"), "utf8"), /plan\.json:begin/);
  const bad = base(); bad.tasks[0].owner = null;
  fs.writeFileSync(path.join(docs, "plan.json"), JSON.stringify(bad));
  const b = run("render");
  assert.strictEqual(b.status, 1);
  assert.match(b.stdout, /sahipsiz/);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 2);
  assert.deepStrictEqual(planLib.checkPlan(JSON.parse(fs.readFileSync(TEMPLATE, "utf8")), cfg()).errors, []);
});

// 0.12.0 (token): görev başına model ve rol dilimi
test("plan: görev modeli doğrulanır; kritik görev haiku'ya verilirse uyarır", () => {
  const p = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  p.tasks[0].model = "gpt-4";
  assert.ok(planLib.checkPlan(p, cfg()).errors.some((e) => /S1-01: model/.test(e)));
  p.tasks[0].model = "haiku";
  assert.ok(planLib.checkPlan(p, cfg()).warnings.some((w) => /kritik görev haiku/.test(w)));
  p.tasks[0].model = "sonnet";
  const r = planLib.checkPlan(p, cfg());
  assert.deepStrictEqual(r.errors, []);
  assert.match(planLib.renderPlan(p, r.waves), /- Model: sonnet/);
});

test("plan slice: rolün kartları + bağlı görevlerin tek satırlık özeti; başka rolün kartı yok", () => {
  const p = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  const s = planLib.slicePlan(p, "web");
  assert.match(s, /# Plan dilimi: web/);
  assert.match(s, /### \[WEB\] S1-03/);
  assert.doesNotMatch(s, /### \[BACKEND\]/, "başka rolün kartı dilimde yok");
  assert.match(s, /- S1-01 \[CONTRACT\] .* sahip backend/, "bağımlılık özeti");
  assert.match(s, /- S1-04 \[TEST\] .* sahip tester/, "açtığı görev özeti");
  assert.ok(s.length < planLib.renderPlan(p).length, "dilim tam plandan kısa");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-slice-"));
  fs.mkdirSync(path.join(dir, "Docs", "Project"), { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(dir, "Docs", "Project", "plan.json"));
  const out = spawnSync(process.execPath, [SCRIPT, "slice", "--role", "backend", "--project", dir], { encoding: "utf8" });
  assert.strictEqual(out.status, 0, out.stderr);
  assert.match(out.stdout, /^# Plan dilimi: backend/);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT, "slice", "--project", dir], { encoding: "utf8" }).status, 2, "--role zorunlu");
});
