// task-completed.js testleri (K1 satırları, kanıt kaydı doğrulaması, STATUS güncellemesi).
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN = path.resolve(__dirname, "..", "..", "plugin");
const HOOK = path.join(PLUGIN, "hooks", "task-completed.js");
const RECORD = path.join(PLUGIN, "hooks", "ledger-record.js");
const ledger = require(path.join(PLUGIN, "hooks", "lib", "ledger"));

const STATUS = [
  "# Proje Durumu",
  "**Sprint:** S1 — x   **İlerleme:** 0/3 görev   **Aktif dalga:** W1",
  "<!-- team-status: sprint=S1 wave=W1 done=0 total=3 blocked=0 -->",
  "",
  "| Görev | Sahip | Dalga | Bekler | Durum | Not |",
  "|---|---|---|---|---|---|",
  "| [BACKEND] S1-01 Login | backend | W1 | — | 🟡 Devam ediyor | |",
  "| [MOBILE] S1-02 Ekran | mobile | W1 | — | 🔴 Bloklu | |",
  "| [TEST] S1-03 Testler | tester | W2 | S1-01 | ⚪ Bekliyor | |",
].join("\n");

function project({ team, projectMd } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "tc-data-"));
  fs.mkdirSync(path.join(dir, "Docs", "Project"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Docs", "Project", "STATUS.md"), STATUS);
  if (team || projectMd) fs.mkdirSync(path.join(dir, "AdditionalAgentInformation"));
  if (team) fs.writeFileSync(path.join(dir, "AdditionalAgentInformation", "team.json"), JSON.stringify(team));
  if (projectMd) fs.writeFileSync(path.join(dir, "AdditionalAgentInformation", "project.md"), projectMd);
  return { dir, data };
}
const envOf = (p) => ({ ...process.env, CLAUDE_PROJECT_DIR: p.dir, CLAUDE_PLUGIN_DATA: p.data });

function run(p, payload) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: p.dir, task_id: "1", ...payload }), env: envOf(p), encoding: "utf8" });
  r.json = r.stdout ? JSON.parse(r.stdout) : null;
  return r;
}

const ROLE_AGENT = { backend: "senior-backend-developer", mobile: "senior-mobile-developer", tester: "senior-tester" };
/** Hook üzerinden gerçek bir kayıt üretir; kimliği döndürür. */
function evidence(p, { role = "backend", command = "npm test", ok = true, stdout = "Tests:       42 passed, 42 total", agentId } = {}) {
  const input = ok
    ? { hook_event_name: "PostToolUse", tool_response: { stdout, stderr: "", interrupted: false } }
    : { hook_event_name: "PostToolUseFailure", error: "Exit code 1\n" + stdout };
  const r = spawnSync(process.execPath, [RECORD], {
    input: JSON.stringify({ ...input, tool_name: "Bash", tool_input: { command }, cwd: p.dir, agent_id: agentId || "a-" + role, agent_type: "agent-team:" + ROLE_AGENT[role] }),
    env: envOf(p),
    encoding: "utf8",
  });
  return /L-[0-9a-f]{8}/.exec(r.stdout)[0];
}
const desc = (id, sonuc = "42/42 geçti, exit 0") => `Komut: npm test\nDizin: /home/x/repo/backend\nSonuç: ${sonuc}${id ? "\nKanıt: " + id : ""}`;
const status = (p) => fs.readFileSync(path.join(p.dir, "Docs", "Project", "STATUS.md"), "utf8");
const BACKEND_TASK = "[BACKEND] S1-01 Login";

// ---------------------------------------------------------------- K1 satırları (değişmedi)
test("K1 satırları olmayan geliştirme görevi kapanmaz", () => {
  const r = run(project(), { task_subject: BACKEND_TASK, task_description: "Bitti, testler temiz." });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /K1/);
  assert.match(r.stderr, /Kanıt: /);
});

test("açıklama alanı yoksa engellemez", () => {
  assert.strictEqual(run(project(), { task_subject: "[WEB] S1-04 Sayfa" }).status, 0);
});

test("ilgisiz görevlere karışmaz", () => {
  assert.strictEqual(run(project(), { task_subject: "[ARCH] S1-00 Mimari", task_description: "x" }).status, 0);
});

test("[DOC] görevi sprint dokümanı yoksa kapanmaz", () => {
  assert.strictEqual(run(project(), { task_subject: "[DOC] Sprint dokümanını tamamla" }).status, 2);
});

// ---------------------------------------------------------------- doğrulanan kanıt
test("doğrulanan kanıt: kapanır, sessizdir, STATUS ✅, atıf kaydedilir", () => {
  const p = project();
  const id = evidence(p);
  const r = run(p, { task_subject: BACKEND_TASK, task_description: desc(id) });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, "");
  const s = status(p);
  assert.match(s, /S1-01 Login \| backend \| W1 \| — \| ✅ Tamamlandı/);
  assert.match(s, /done=1 total=3 blocked=1 unverified=0 -->/);
  assert.match(s, /\*\*İlerleme:\*\* 1\/3/);
  process.env.CLAUDE_PLUGIN_DATA = p.data;
  assert.strictEqual(ledger.readCitations(p.dir)[id].task, "S1-01");
});

test("[FIX] görevi herhangi bir geliştiricinin kanıtını kabul eder", () => {
  const p = project();
  const r = run(p, { task_subject: "[FIX] S1-09 Hata", task_description: desc(evidence(p, { role: "mobile" })) });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
});

// ---------------------------------------------------------------- warn modu: kapanır ama ciddi uyarı
function assertUnverified(p, r, why) {
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.json.systemMessage, /KANITSIZ KAPANIŞ/);
  assert.match(r.json.systemMessage, why);
  const s = status(p);
  assert.match(s, /S1-01 Login \| backend \| W1 \| — \| ⚠️ Kanıtsız/);
  assert.match(s, /done=(\d) total=(\d) blocked=1 unverified=1 -->/);
  const [, d, t] = /done=(\d) total=(\d)/.exec(s);
  assert.strictEqual(Number(t) - Number(d), 2, "S1-02 ve S1-03 açık kalır");
}

test("warn: Kanıt atfı yoksa kapanır, uyarı ajana ve lead'e iletilir", () => {
  const p = project();
  const r = run(p, { task_subject: BACKEND_TASK, task_description: desc(null) });
  assertUnverified(p, r, /atfı yok/);
  process.env.CLAUDE_PLUGIN_DATA = p.data;
  const agent = ledger.takeNotices(p.dir, { role: "tester", taskCompletedId: "1" });
  assert.strictEqual(agent.length, 1);
  assert.match(agent[0], /ön planda yeniden çalıştır/);
  const lead = ledger.takeNotices(p.dir, { role: "lead" });
  assert.match(lead[0], /yeniden aç/);
});

test("warn: kayıtta olmayan kimlik", () => {
  const p = project();
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc("L-0badc0de") }), /kayıtta yok/);
});

test("warn: başarısız komutun kanıtı", () => {
  const p = project();
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc(evidence(p, { ok: false })) }), /başarılı bir komut değil/);
});

test("warn: başka rolün kanıtı", () => {
  const p = project();
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc(evidence(p, { role: "mobile" })) }), /mobile rolüne ait/);
});

test("warn: görevi kapatan agent'tan farklı agent'ın kanıtı", () => {
  const p = project();
  const id = evidence(p, { agentId: "a-backend-2" });
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc(id), agent_id: "a-backend-1" }), /başka bir agent/);
});

test("warn: aynı kanıt ikinci bir görevde kullanılamaz", () => {
  const p = project();
  const id = evidence(p);
  assert.strictEqual(run(p, { task_subject: "[BACKEND] S1-05 Başka", task_description: desc(id) }).stdout, "");
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc(id) }), /S1-05 görevinde/);
});

test("warn: eski kanıt (maxAgeHours)", () => {
  const p = project();
  process.env.CLAUDE_PLUGIN_DATA = p.data;
  const old = ledger.append(p.dir, { agent_id: "a-backend", role: "backend", cmd: "npm test", exit: 0, result: "ok" }, Date.now() - 30 * 3600000);
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc(old.id) }), /30 saat önce/);
});

test("warn: değiştirilmiş kayıt", () => {
  const p = project();
  const id = evidence(p, { ok: false });
  process.env.CLAUDE_PLUGIN_DATA = p.data;
  const file = ledger.agentFiles(ledger.ledgerDir(p.dir))[0];
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"exit":1', '"exit":0').replace('"result":"fail"', '"result":"ok"'));
  assertUnverified(p, run(p, { task_subject: BACKEND_TASK, task_description: desc(id) }), /zinciri bozuk/);
});

test("Sonuç satırı çıktıdaki test özetiyle uyuşmazsa uyarır ama doğrulanmış sayar", () => {
  const p = project();
  const id = evidence(p, { stdout: "Tests:       2 failed, 40 passed, 42 total" });
  const r = run(p, { task_subject: BACKEND_TASK, task_description: desc(id, "42/42 geçti") });
  assert.strictEqual(r.status, 0);
  assert.match(r.json.systemMessage, /Kapanış uyarısı.*\n- Sonuç satırı "42\/42".*40 geçen \/ 2 kalan/);
  assert.match(status(p), /✅ Tamamlandı/);
});

test("team-status satırında unverified yoksa eklenir, varsa güncellenir", () => {
  const p = project();
  run(p, { task_subject: BACKEND_TASK, task_description: desc(null) });
  assert.match(status(p), /blocked=1 unverified=1 -->/);
  run(p, { task_subject: "[TEST] S1-03 Testler", task_description: desc(null) });
  assert.match(status(p), /done=2 total=3 blocked=1 unverified=2 -->/);
});

// ---------------------------------------------------------------- enforce / strict
test("enforce: kanıtsız kapanış engellenir, doğrulanan kapanır", () => {
  const p = project({ team: { evidence: "enforce" } });
  const r = run(p, { task_subject: BACKEND_TASK, task_description: desc(null) });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /evidence: enforce/);
  assert.match(status(p), /🟡 Devam ediyor/);
  assert.strictEqual(run(p, { task_subject: BACKEND_TASK, task_description: desc(evidence(p)) }).status, 0);
});

test("strict: yalnızca project.md > Komutlar tablosundaki komutlar kanıt sayılır", () => {
  const projectMd = [
    "# Proje", "## Komutlar", "| Alan | Kurulum | Build | Test | Lint / format |", "|---|---|---|---|---|",
    "| backend | npm ci | npm run build | `npm test` | <doldur> |", "", "## Ortam", "- x",
  ].join("\n");
  const p = project({ team: { evidence: { mode: "strict" } }, projectMd });
  const bad = run(p, { task_subject: BACKEND_TASK, task_description: desc(evidence(p, { command: "echo 42 passed" })) });
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /Komutlar tablosunda yok/);
  const good = run(p, { task_subject: BACKEND_TASK, task_description: desc(evidence(p, { command: "cd backend && npm test" })) });
  assert.strictEqual(good.status, 0, good.stderr);
});

// Canlı test (0.11.4): tabloda satırı olmayan görev kapanınca satır eklenir, sayaçlar güncellenir.
test("STATUS: tabloda olmayan görev satır olarak eklenir", () => {
  const p = project();
  const r = run(p, { task_subject: "[BACKEND] S1-04 Yeni iş", task_description: desc(evidence(p)) });
  assert.strictEqual(r.status, 0, r.stderr);
  const s = status(p);
  assert.match(s, /\| S1-04 Yeni iş \| backend \|  \|  \| ✅ Tamamlandı \| hook ekledi/);
  assert.match(s, /done=1 total=4/);
  assert.strictEqual((s.match(/\[BACKEND\] S1-01/g) || []).length, 1, "mevcut satırlar çoğalmaz");
});
