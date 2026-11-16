// Kanıt kaydı testleri: lib/ledger.js, hooks/ledger-record.js, scripts/ledger.js.
// Çalıştırma (repo kökünde): node --test tests/hooks/*.test.js
// Her test kendi CLAUDE_PLUGIN_DATA dizinini kullanır; gerçek plugin verisine dokunulmaz.

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN = path.resolve(__dirname, "..", "..", "plugin");
const RECORD = path.join(PLUGIN, "hooks", "ledger-record.js");
const CLI = path.join(PLUGIN, "scripts", "ledger.js");
const ledger = require(path.join(PLUGIN, "hooks", "lib", "ledger"));
const cfgLib = require(path.join(PLUGIN, "hooks", "lib", "team-config"));

function env() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ldg-data-"));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ldg-proj-"));
  process.env.CLAUDE_PLUGIN_DATA = data; // kütüphane çağrıları için
  return { data, proj };
}

function hook(e, input) {
  const r = spawnSync(process.execPath, [RECORD], {
    input: JSON.stringify({ cwd: e.proj, session_id: "s1", ...input }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: e.data, CLAUDE_PROJECT_DIR: e.proj },
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
}
const backend = { agent_id: "a-backend", agent_type: "agent-team:senior-backend-developer" };
function bash(e, command, extra = {}) {
  return hook(e, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, tool_response: { stdout: "ok", stderr: "", interrupted: false }, duration_ms: 1500, ...backend, ...extra });
}
const idOf = (ctx) => (/L-[0-9a-f]{8}/.exec(ctx) || [])[0];

// ---------------------------------------------------------------- kütüphane
test("outcome: başarı, çıkış kodu, kesilme, arka plan, zaman aşımı", () => {
  assert.deepStrictEqual(ledger.outcome({ hook_event_name: "PostToolUse", tool_input: {}, tool_response: { stdout: "a", stderr: "b" } }), { exit: 0, result: "ok", output: "a\nb" });
  assert.deepStrictEqual(ledger.outcome({ hook_event_name: "PostToolUseFailure", error: "Exit code 3\nboom" }), { exit: 3, result: "fail", output: "Exit code 3\nboom" });
  assert.strictEqual(ledger.outcome({ hook_event_name: "PostToolUse", tool_response: { interrupted: true } }).result, "interrupted");
  assert.strictEqual(ledger.outcome({ hook_event_name: "PostToolUseFailure", error: "Exit code 130", is_interrupt: true }).result, "interrupted");
  assert.strictEqual(ledger.outcome({ hook_event_name: "PostToolUse", tool_input: { run_in_background: true }, tool_response: {} }).result, "background");
  assert.strictEqual(ledger.outcome({ hook_event_name: "PostToolUse", tool_input: {}, tool_response: { backgroundTaskId: "b1" } }).result, "background");
  assert.strictEqual(ledger.outcome({ hook_event_name: "PostToolUseFailure", error: "Command timed out after 2m" }).result, "timeout");
});

test("hash zinciri: ekleme, doğrulama, kimlik içerikten türer", () => {
  const e = env();
  const a = ledger.append(e.proj, { agent_id: "x", role: "backend", cmd: "npm test", exit: 0, result: "ok", output: "1" });
  const b = ledger.append(e.proj, { agent_id: "x", role: "backend", cmd: "npm run build", exit: 0, result: "ok", output: "2" });
  assert.strictEqual(a.prev, ledger.GENESIS);
  assert.strictEqual(b.prev, a.hash);
  assert.match(a.id, /^L-[0-9a-f]{8}$/);
  assert.notStrictEqual(a.id, b.id);
  const file = ledger.agentFiles(ledger.ledgerDir(e.proj))[0];
  assert.deepStrictEqual(ledger.verifyFile(file).problems, []);
  assert.strictEqual(ledger.find(e.proj, b.id).chainOk, true);
});

test("kurcalama: değiştirilen satır ve silinen satır yakalanır", () => {
  const e = env();
  const ids = ["a", "b", "c"].map((c) => ledger.append(e.proj, { agent_id: "x", role: "backend", cmd: c, exit: 0, result: "ok" }).id);
  const file = ledger.agentFiles(ledger.ledgerDir(e.proj))[0];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");

  const edited = JSON.parse(lines[1]);
  edited.exit = 0; edited.result = "ok"; edited.cmd = "npm test";
  fs.writeFileSync(file, [lines[0], JSON.stringify(edited), lines[2]].join("\n") + "\n");
  let v = ledger.verifyFile(file);
  assert.ok(v.problems.some((p) => /içerik değiştirilmiş/.test(p)), v.problems.join());
  assert.strictEqual(ledger.find(e.proj, ids[0]).chainOk, true);
  assert.strictEqual(ledger.find(e.proj, ids[1]).chainOk, false);
  assert.strictEqual(ledger.find(e.proj, ids[2]).chainOk, false, "kırılmadan sonraki satırlar da güvenilmez");

  fs.writeFileSync(file, [lines[0], lines[2]].join("\n") + "\n");
  v = ledger.verifyFile(file);
  assert.ok(v.problems.some((p) => /zincir kırık/.test(p)));
});

test("eşzamanlı yazma (paralel komutlar) zinciri bozmaz", async () => {
  const e = env();
  const n = 8;
  await Promise.all(Array.from({ length: n }, (_, i) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [RECORD], { env: { ...process.env, CLAUDE_PLUGIN_DATA: e.data, CLAUDE_PROJECT_DIR: e.proj } });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("exit " + c))));
    p.stdin.end(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "echo " + i }, tool_response: { stdout: String(i) }, cwd: e.proj, ...backend }));
  })));
  const file = ledger.agentFiles(ledger.ledgerDir(e.proj))[0];
  const v = ledger.verifyFile(file);
  assert.strictEqual(v.count, n);
  assert.deepStrictEqual(v.problems, []);
});

test("gizlilik: gizli bilgiler maskelenir, çıktının yalnızca sonu ve hash'i saklanır", () => {
  const m = ledger.mask("password=hunter2 TOKEN: abc123 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig12345678 ghp_abcdefghijklmnopqrstuvwxyz123456 postgres://user:pa55@db:5432/x API_KEY=\"k-1\"");
  for (const secret of ["hunter2", "abc123", "eyJhbGci", "ghp_abc", "pa55", "k-1"]) assert.ok(!m.includes(secret), `${secret} maskelenmedi: ${m}`);
  assert.ok(!ledger.mask("-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----").includes("MIIE"));

  const e = env();
  const big = "x".repeat(10000) + "SON";
  const line = ledger.append(e.proj, { agent_id: "x", role: "backend", cmd: "export SECRET=s3cr3t && npm test", exit: 0, result: "ok", output: big });
  assert.ok(Buffer.byteLength(line.out_tail) <= 2048 + 4);
  assert.ok(line.out_tail.endsWith("SON"));
  assert.strictEqual(line.out_sha256, require("node:crypto").createHash("sha256").update(big).digest("hex"));
  assert.ok(!line.cmd.includes("s3cr3t"));
});

test("test özeti kalıpları", () => {
  assert.deepStrictEqual(ledger.testSummary("Tests:       1 failed, 41 passed, 42 total"), { passed: 41, failed: 1, total: 42 });
  assert.deepStrictEqual(ledger.testSummary(" Tests  42 passed (42)"), { passed: 42, failed: 0, total: 42 });
  assert.deepStrictEqual(ledger.testSummary("Passed!  - Failed:     0, Passed:    42, Skipped:     0, Total:    42"), { passed: 42, failed: 0, total: 42 });
  assert.deepStrictEqual(ledger.testSummary("===== 42 passed in 1.2s ====="), { passed: 42, failed: 0, total: null });
  assert.deepStrictEqual(ledger.testSummary("00:03 +42: All tests passed!"), { passed: 42, failed: 0, total: null });
  assert.deepStrictEqual(ledger.testSummary("ℹ tests 42\nℹ pass 42\nℹ fail 0"), { passed: 42, failed: 0, total: null });
  assert.strictEqual(ledger.testSummary("derleme tamam"), null);
});

test("saklama süresi: eski kayıt dosyaları silinir", () => {
  const e = env();
  ledger.append(e.proj, { agent_id: "old", role: "backend", cmd: "a", exit: 0, result: "ok" });
  ledger.append(e.proj, { agent_id: "new", role: "backend", cmd: "b", exit: 0, result: "ok" });
  const dir = ledger.ledgerDir(e.proj);
  const old = new Date(Date.now() - 40 * 86400000);
  fs.utimesSync(path.join(dir, "old.jsonl"), old, old);
  assert.strictEqual(ledger.prune(30), 1);
  assert.deepStrictEqual(ledger.agentFiles(dir).map((f) => path.basename(f)), ["new.jsonl"]);
});

test("uyarılar: ajan tarafı TaskUpdate ile, lead tarafı lead/ana oturumla bir kez teslim edilir", () => {
  const e = env();
  ledger.addNotice(e.proj, { target: { task_id: "7", agent_id: null, role: "backend" }, agentText: "AJAN", leadText: "LEAD" });
  assert.deepStrictEqual(ledger.takeNotices(e.proj, { role: "mobile" }), []);
  assert.deepStrictEqual(ledger.takeNotices(e.proj, { role: "tester", taskCompletedId: "7" }), ["AJAN"]);
  assert.deepStrictEqual(ledger.takeNotices(e.proj, { role: "backend" }), [], "ajan tarafı bir kez");
  assert.deepStrictEqual(ledger.takeNotices(e.proj, { role: "lead" }), ["LEAD"]);
  assert.deepStrictEqual(ledger.takeNotices(e.proj, { isMain: true }), []);
  assert.deepStrictEqual(fs.readdirSync(path.join(ledger.ledgerDir(e.proj), "notices")), [], "teslim edilen uyarı silinir");

  ledger.addNotice(e.proj, { target: { task_id: "8", agent_id: null, role: null }, agentText: "AJAN2", leadText: "LEAD2" });
  assert.deepStrictEqual(ledger.takeNotices(e.proj, { isMain: true, taskCompletedId: "8" }), ["AJAN2"], "kapatan ana oturumsa tek uyarı");
});

test("team.json evidence ayarı doğrulanır", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ldg-cfg-"));
  fs.mkdirSync(path.join(proj, cfgLib.LAYER_DIR));
  const put = (v) => fs.writeFileSync(path.join(proj, cfgLib.LAYER_DIR, "team.json"), JSON.stringify({ evidence: v }));
  put("enforce");
  assert.deepStrictEqual(cfgLib.loadConfig(proj).config.evidence, { mode: "enforce", maxAgeHours: 24 });
  put({ mode: "strict", maxAgeHours: 4 });
  assert.deepStrictEqual(cfgLib.loadConfig(proj).config.evidence, { mode: "strict", maxAgeHours: 4 });
  put("off");
  assert.match(cfgLib.loadConfig(proj).error, /evidence\.mode/);
  put({ maxAgeHours: -1 });
  assert.match(cfgLib.loadConfig(proj).error, /maxAgeHours/);
  assert.strictEqual(cfgLib.loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), "ldg-none-"))).config.evidence.mode, "warn");
});

// ---------------------------------------------------------------- hook
test("hook: takım rolünün başarılı komutu kaydedilir, ajana kimlik döner", () => {
  const e = env();
  const ctx = bash(e, "npm test");
  assert.match(ctx, /^Kanıt: L-[0-9a-f]{8} \(exit 0, 1\.5 sn\)/);
  const f = ledger.find(e.proj, idOf(ctx));
  assert.strictEqual(f.rec.role, "backend");
  assert.strictEqual(f.rec.cmd, "npm test");
  assert.strictEqual(f.rec.result, "ok");
  assert.strictEqual(f.rec.agent_id, "a-backend");
});

test("hook: başarısız, arka plan ve sandbox engeli ayrı bildirilir", () => {
  const e = env();
  const fail = hook(e, { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, error: "Exit code 1\n3 failed", ...backend });
  assert.match(fail, /exit 1, başarısız/);
  assert.strictEqual(ledger.find(e.proj, idOf(fail)).rec.exit, 1);
  assert.match(bash(e, "npm run dev", { tool_input: { command: "npm run dev", run_in_background: true } }), /arka plan.*K2/);
  const ro = hook(e, { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "touch ~/x" }, error: "Exit code 1\ntouch: cannot touch '/home/u/x': Read-only file system", ...backend });
  assert.match(ro, /sandbox sınırı.*\[BLOCKED\]/);
});

test("hook: ana oturum, takım dışı agent ve bilinmeyen agent kaydedilmez", () => {
  const e = env();
  assert.strictEqual(bash(e, "npm test", { agent_id: undefined, agent_type: undefined }), "");
  assert.strictEqual(bash(e, "npm test", { agent_id: "ex1", agent_type: "Explore" }), "");
  assert.strictEqual(bash(e, "npm test", { agent_id: "zz-unknown", agent_type: undefined }), "");
  assert.deepStrictEqual(ledger.all(e.proj), []);
});

test("hook: bekleyen uyarıyı TaskUpdate(completed) çağrısının ardından ajana iletir", () => {
  const e = env();
  ledger.addNotice(e.proj, { target: { task_id: "3", agent_id: null, role: "backend" }, agentText: "⚠️ KANITSIZ KAPANIŞ (test)", leadText: "lead" });
  const ctx = hook(e, { hook_event_name: "PostToolUse", tool_name: "TaskUpdate", tool_input: { taskId: "3", status: "completed" }, tool_response: { success: true }, ...backend });
  assert.match(ctx, /KANITSIZ KAPANIŞ/);
  const lead = hook(e, { hook_event_name: "PostToolUse", tool_name: "SendMessage", tool_input: {}, tool_response: {}, agent_id: "a-lead", agent_type: "agent-team:tech-lead" });
  assert.strictEqual(lead, "lead");
});

// ---------------------------------------------------------------- CLI
function cli(e, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, "--project", e.proj], { env: { ...process.env, CLAUDE_PLUGIN_DATA: e.data }, encoding: "utf8" });
}

test("CLI: show, list, verify, export, kullanım hatası", () => {
  const e = env();
  const id = idOf(bash(e, "npm test -- --token=abc"));
  ledger.cite(e.proj, [id], "S1-01");

  const show = cli(e, "show", id);
  assert.strictEqual(show.status, 0, show.stderr);
  assert.match(show.stdout, /zincir ✓/);
  assert.match(show.stdout, /Atıf:\s+S1-01/);
  assert.ok(!show.stdout.includes("abc"), "maskeli");
  assert.strictEqual(cli(e, "show", "L-00000000").status, 1);

  const list = cli(e, "list", "--task", "S1-01", "--json");
  assert.strictEqual(JSON.parse(list.stdout).length, 1);
  assert.strictEqual(cli(e, "verify").status, 0);
  assert.match(cli(e, "export").stdout, /\| S1-01 \| L-[0-9a-f]{8} \|/);
  assert.strictEqual(cli(e, "list", "--since", "yarın").status, 2);
  assert.strictEqual(cli(e, "nope").status, 2);

  const file = ledger.agentFiles(ledger.ledgerDir(e.proj))[0];
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"result":"ok"', '"result":"ok "'));
  const v = cli(e, "verify");
  assert.strictEqual(v.status, 1);
  assert.match(v.stdout, /sorun/);
});
