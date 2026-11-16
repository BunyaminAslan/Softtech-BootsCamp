// resume-status.js testleri (MustToHave madde 5): kesintiden sonra devam özeti.
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
const SCRIPT = path.join(PLUGIN, "scripts", "resume-status.js");
const ledger = require(path.join(PLUGIN, "hooks", "lib", "ledger"));
const LAYER = "AdditionalAgentInformation";
const gitOk = spawnSync("git", ["--version"]).status === 0;

const STATUS = `# Proje Durumu
**Sprint:** S1 — notlar   **İlerleme:** 1/4 görev   **Aktif dalga:** W2
<!-- team-status: sprint=S1 wave=W2 done=1 total=4 blocked=0 unverified=1 -->

| Görev | Sahip | Dalga | Bekler | Durum | Not |
|---|---|---|---|---|---|
| [BACKEND] S1-01 API | backend | W1 | — | ✅ Tamamlandı | |
| [WEB] S1-02 Liste ekranı | web | W2 | S1-01 | 🟡 Devam ediyor | |
| [TEST] S1-03 E2E | tester | W3 | S1-02 | ⚪ Bekliyor | |
| [BACKEND] S1-04 Silme | backend | W2 | — | ⚠️ Kanıtsız | |

## Şu an kim ne yapıyor / kim kimi bekliyor
- web: S1-02 liste ekranı, sayfalama yarım

## Bloklar
—

## Sonraki adım
S1-02 bitince tester başlar.

## Yeniden başlatma için (kesinti olursa: kim neredeydi, açık süreçler, sıradaki adım)
web next build arka planda çalışıyordu; port 3000.
`;

function fixture() {
  const dir = path.join(REPO, "tests", ".sandbox", `resume-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "resume-data-"));
  const tasks = fs.mkdtempSync(path.join(os.tmpdir(), "resume-tasks-"));
  fs.mkdirSync(path.join(dir, "Docs", "Project"), { recursive: true });
  fs.mkdirSync(path.join(dir, LAYER, "agents", "web"), { recursive: true });
  fs.writeFileSync(path.join(dir, LAYER, "team.json"), JSON.stringify({ roles: { mobile: { enabled: false } } }));
  fs.writeFileSync(path.join(dir, "Docs", "Project", "STATUS.md"), STATUS);
  fs.writeFileSync(path.join(dir, "Docs", "Project", "SPRINT_PLAN.md"), "# Plan\n**Ana hedef:** Not uygulaması (ekle, listele, sil)\n");
  fs.writeFileSync(path.join(dir, LAYER, "agents", "web", "WORKLOG.md"), "# Worklog\n\n## 2026-11-15\n- eski\n\n## 2026-11-16\n- S1-02: liste bileşeni bitti, sayfalama yarım\n");
  // Görev listeleri: biri bu projeye ait, biri başka projeye
  const mine = path.join(tasks, "session-aaaa");
  const other = path.join(tasks, "session-bbbb");
  fs.mkdirSync(mine); fs.mkdirSync(other);
  const t = (d, id, subject, status, extra = {}) => fs.writeFileSync(path.join(d, id + ".json"), JSON.stringify({ id, subject, status, blocks: [], blockedBy: [], ...extra }));
  t(mine, "1", "[BACKEND] S1-01 API", "completed");
  t(mine, "2", "[WEB] S1-02 Liste ekranı", "in_progress", { owner: "web" });
  t(mine, "3", "[TEST] S1-03 E2E", "pending", { blockedBy: ["2"] });
  t(other, "1", "[WEB] S9-99 Başka proje", "in_progress");
  process.env.CLAUDE_PLUGIN_DATA = data;
  ledger.append(dir, { agent_id: "w1", role: "web", cmd: "npm run build", exit: 0, result: "ok" });
  ledger.append(dir, { agent_id: "w1", role: "web", cmd: "npx next start -p 3000", result: "background" });
  return { dir, data, tasks };
}
const run = (f, ...args) => spawnSync(process.execPath, [SCRIPT, "--project", f.dir, "--tasks-dir", f.tasks, ...args], {
  env: { ...process.env, CLAUDE_PLUGIN_DATA: f.data, HOME: f.tasks, USERPROFILE: f.tasks }, encoding: "utf8",
});

test("devam özeti: plan, bitmemiş görevler, görev listesi, worklog, kanıt kaydı, yeniden başlatılacak roller", () => {
  const f = fixture();
  const r = run(f, "--json");
  assert.strictEqual(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.match(s.goal, /Not uygulaması/);
  assert.deepStrictEqual(s.status.teamStatus, { sprint: "S1", wave: "W2", done: "1", total: "4", blocked: "0", unverified: "1" });
  assert.deepStrictEqual(s.status.open.map((o) => o.task), ["[WEB] S1-02 Liste ekranı", "[TEST] S1-03 E2E", "[BACKEND] S1-04 Silme"]);
  assert.strictEqual(s.status.open[2].unverified, true);
  assert.match(s.status.restart, /port 3000/);
  assert.strictEqual(s.status.blocks, null, "boş bölüm (—) yok sayılır");
  assert.strictEqual(s.tasks.team, "session-aaaa", "başka projenin görev listesi seçilmez");
  assert.deepStrictEqual(s.tasks.unfinished.map((t) => t.id), ["2", "3"]);
  assert.match(s.worklogs.web, /^## 2026-11-16/);
  assert.ok(!s.worklogs.web.includes("eski"), "yalnızca son giriş");
  assert.strictEqual(s.ledger.byRole.web.cmd, "npx next start -p 3000");
  assert.strictEqual(s.ledger.background.length, 1);
  assert.deepStrictEqual(s.respawn.sort(), ["backend", "web"], "bekleyen (⚪) tester başlatılmaz; kanıtsız görevin sahibi başlatılır");
});

test("Markdown çıktısı kullanıcıya ve lead'e gösterilecek bölümleri içerir", () => {
  const out = run(fixture()).stdout;
  for (const re of [/# Devam özeti/, /Ana hedef: .*Not uygulaması/, /\| \[WEB\] S1-02 Liste ekranı \| web \| W2 \| S1-01 \| 🟡 Devam ediyor \|/,
    /Liste `session-aaaa`.*2\/3 bitmemiş/, /#3 \[TEST\] S1-03 E2E — pending, bekliyor: 2/, /Açık kalmış olabilecek arka plan süreçleri/,
    /`npx next start -p 3000`/, /Yeniden başlatma notu \(lead\)/, /Yeniden başlatılacak roller/]) assert.match(out, re);
});

test("git: commit'lenmemiş değişiklikler sahibi olan role göre gruplanır", { skip: !gitOk && "git yok" }, () => {
  const f = fixture();
  spawnSync("git", ["init", "-q"], { cwd: f.dir });
  fs.mkdirSync(path.join(f.dir, "web", "src"), { recursive: true });
  fs.writeFileSync(path.join(f.dir, "web", "src", "List.tsx"), "x");
  fs.writeFileSync(path.join(f.dir, "notes.txt"), "x");
  const s = JSON.parse(run(f, "--json").stdout);
  assert.ok(s.git.changes.web.some((l) => /web\/src\/List\.tsx|web\//.test(l)), JSON.stringify(s.git.changes));
  assert.ok(s.git.changes["diğer"].some((l) => /notes\.txt/.test(l)));
});

test("proje katmanı yoksa devam edilecek iş olmadığını söyler", () => {
  const dir = path.join(REPO, "tests", ".sandbox", `resume-empty-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, "--project", dir], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /devam edilecek bir takım işi bulunamadı/);
});
