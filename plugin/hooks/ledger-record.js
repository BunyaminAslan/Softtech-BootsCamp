// PostToolUse / PostToolUseFailure hook'u: kanıt kaydı (TEAM_RULES K1).
//
// 1) Takım rolünün her Bash/PowerShell çağrısını proje dışındaki kanıt kaydına yazar (lib/ledger.js)
//    ve ajana kaydın kimliğini döndürür:  "Kanıt: L-7f3a2c1d (exit 0, 14.2 sn)".
//    Ajan görev kapanışında bu kimliğe atıf yapar; task-completed.js atfı kayıttan doğrular.
// 2) task-completed.js'in beklettiği kapanış uyarılarını iletir: ajana (TaskUpdate → completed
//    çağrısının hemen ardından) ve lead'e / ana oturuma (sonraki araç çağrısında).
//
// Bu hook hiçbir aracı engellemez; hata olursa sessizce çıkar (exit 0).

"use strict";
const cfgLib = require("./lib/team-config");
const ledger = require("./lib/ledger");

const SHELL_TOOLS = ["Bash", "PowerShell"];

function secs(ms) {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)} sn` : "süre bilinmiyor";
}

function recordLine(line) {
  const exit = line.exit === null ? "exit ?" : `exit ${line.exit}`;
  switch (line.result) {
    case "ok":
      return `Kanıt: ${line.id} (${exit}, ${secs(line.ms)}). Görev kapanışında kanıt olarak kullanacaksan görev açıklamasına "Kanıt: ${line.id}" satırını ekle.`;
    case "background":
      return `Kanıt kaydı: ${line.id} (arka plan). Arka plan komutları kanıt sayılmaz (TEAM_RULES K2): build/test/lint komutlarını ön planda çalıştır.`;
    case "timeout":
      return `Kanıt kaydı: ${line.id} (zaman aşımı). Kanıt sayılmaz; paketi böl veya Bash zaman aşımını artır (en fazla 10 dk).`;
    case "interrupted":
      return `Kanıt kaydı: ${line.id} (kesildi). Kanıt sayılmaz.`;
    default:
      return `Kanıt kaydı: ${line.id} (${exit}, başarısız). Başarısız komut kanıt sayılmaz.`;
  }
}

function main(input) {
  const projectDir = cfgLib.projectRoot(input);
  let caller = cfgLib.identifyCaller(input);
  // Özel roller (team.json > roles) yalnızca yapılandırmayla tanınır
  if (caller.kind === "agent" && !caller.role) caller = cfgLib.identifyCaller(input, cfgLib.loadConfig(projectDir).config);
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const context = [];

  if (SHELL_TOOLS.includes(tool) && caller.role) {
    const o = ledger.outcome(input);
    try {
      const line = ledger.append(projectDir, {
        session: input.session_id,
        agent_id: input.agent_id,
        agent_type: caller.agentType,
        role: caller.role,
        tool_use_id: input.tool_use_id,
        tool,
        cmd: ti.command,
        cwd: input.cwd,
        exit: o.exit,
        ms: input.duration_ms,
        result: o.result,
        output: o.output,
      });
      context.push(recordLine(line));
    } catch (e) {
      context.push(`Kanıt kaydı yazılamadı (${e && e.message}). Bu komut kanıt olarak doğrulanamaz; lead'e bildir.`);
    }
    if (/Read-only file system|Operation not permitted/i.test(o.output) && o.result !== "ok") {
      context.push("Not: bu hata büyük olasılıkla sandbox sınırıdır. Komutu sandbox dışında yeniden denemeye çalışma; gerekiyorsa lead'e [BLOCKED] gönder.");
    }
  }

  const taskCompletedId = tool === "TaskUpdate" && ti.status === "completed" ? ti.taskId : null;
  if (caller.kind !== "unknown-agent") {
    context.push(...ledger.takeNotices(projectDir, {
      agentId: input.agent_id || null,
      role: caller.role,
      isMain: caller.kind === "main",
      taskCompletedId,
    }));
  }

  if (!context.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: input.hook_event_name || "PostToolUse", additionalContext: context.join("\n") },
  }));
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      main(JSON.parse(raw));
    } catch (_) {}
  });
}

module.exports = { main, recordLine };
