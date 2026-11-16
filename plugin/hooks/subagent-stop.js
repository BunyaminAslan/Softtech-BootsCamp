// SubagentStop ve TeammateIdle hook'u:
// - reviewer işini bitirdiğinde chat'e kısa bir mesaj yazar.
// - lead (tech-lead) kullanıcıdan bir şey beklediğinde ([QUESTION], [PLAN-APPROVAL], [BLOCKED], [DONE])
//   chat'e mesaj yazar ve masaüstü bildirimi gösterir. Kapatmak için: CLAUDE_TEAM_NOTIFY=0
// - SubagentStop: subagent olarak çalıştığında (commit hook'u / HOOK MODU)
// - TeammateIdle: agent team'de teammate olarak çalıştığında
// Claude Code olay bilgisini stdin'den JSON olarak gönderir; biz de stdout'a
// {"systemMessage": "..."} yazarak mesajı kullanıcıya gösteririz.

const fs = require("fs");
const { agentBaseName } = require("./lib/team-config");
const { spawn } = require("child_process");

const LEAD_TAGS = {
  "[QUESTION]": "lead kullanıcıya soru soruyor",
  "[PLAN-APPROVAL]": "lead plan onayı bekliyor",
  "[BLOCKED]": "lead engellendi, karar gerekiyor",
  "[DONE]": "lead işi bitirdi, kapanış özeti hazır",
};

// lead'in son SendMessage içeriği (etiket orada olur) veya son metni
function leadLastOutput(input) {
  const chunks = [];
  if (input.last_assistant_message) chunks.push(String(input.last_assistant_message));
  try {
    const lines = fs.readFileSync(input.agent_transcript_path || input.transcript_path, "utf8").trim().split(/\r?\n/);
    for (let i = lines.length - 1, seen = 0; i >= 0 && seen < 30; i--, seen++) {
      const entry = JSON.parse(lines[i]);
      const content = entry.message && entry.message.content;
      if (entry.type !== "assistant" || !Array.isArray(content)) continue;
      for (const c of content) {
        if (c.type === "tool_use" && c.name === "SendMessage") chunks.push(JSON.stringify(c.input || {}));
        if (c.type === "text") chunks.push(c.text);
      }
      if (chunks.length > 1) break;
    }
  } catch (_) {}
  return chunks.join(" ");
}

// Masaüstü bildirimi: Windows'ta veya WSL'de PowerShell balon bildirimi, Linux'ta notify-send (en iyi çaba)
function notify(title, body) {
  if (process.env.CLAUDE_TEAM_NOTIFY === "0") return;
  const ps = process.platform === "win32" ? "powershell.exe"
    : fs.existsSync("/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe") ? "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe" : null;
  const esc = (t) => String(t).replace(/'/g, "''").slice(0, 200);
  try {
    if (ps) {
      const script = "Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; " +
        "$n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; " +
        "$n.ShowBalloonTip(8000, '" + esc(title) + "', '" + esc(body) + "', 'Info'); Start-Sleep -Seconds 9; $n.Dispose()";
      spawn(ps, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else {
      spawn("notify-send", [title, body], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    }
  } catch (_) {}
}

// Hangi agent bitince ne yazılacağı. Anahtar: agent tipi veya teammate adı.
const REVIEWER = {
  done: "kod incelemesini (SOLID, testler, güvenlik) yaptım",
  next: {
    SubagentStop: "şimdi agamın istediği sprint dokümantasyonuna geçiyorum",
    TeammateIdle: "raporu documenter'a gönderdim, şimdi agamın sıradaki isteğini bekliyorum",
  },
};
const MESSAGES = {
  "pre-commit-reviewer": REVIEWER,
  reviewer: REVIEWER,
};

// Agent'ın son mesajını bul: önce doğrudan alandan, yoksa agent transcript'inden
function lastMessage(input) {
  if (input.last_assistant_message) return String(input.last_assistant_message);
  try {
    const lines = fs.readFileSync(input.agent_transcript_path, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      const content = entry.message && entry.message.content;
      if (entry.type === "assistant" && Array.isArray(content)) {
        return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      }
    }
  } catch (_) {}
  return "";
}

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (_) {}

  const baseType = agentBaseName(input.agent_type);
  if (input.teammate_name === "lead" || baseType === "tech-lead") {
    const out = leadLastOutput(input);
    const tag = Object.keys(LEAD_TAGS).find((t) => out.includes(t));
    if (!tag) return;
    const text = `🔔 ${LEAD_TAGS[tag]} ${tag}`;
    notify("Claude agent team", text);
    console.log(JSON.stringify({ systemMessage: text }));
    return;
  }

  const msg = MESSAGES[baseType] || MESSAGES[input.teammate_name];
  const next = msg && msg.next[input.hook_event_name];
  if (!next) return; // ilgilenmediğimiz bir agent veya olay, sessizce çık

  // Karar satırı yoksa inceleme henüz bitmemiştir (ör. teammate bir soruyu cevaplayıp
  // boşa düştü); bu durumda mesaj gösterme.
  const text = lastMessage(input);
  if (!text.includes("Karar:")) return;

  const status = text.includes("COMMIT EDİLMEMELİ")
    ? "ama commit'i engelleyen bulgular çıktı ❌"
    : "ve başarılı bitti ✅";

  console.log(JSON.stringify({
    systemMessage: `Aga ${msg.done} ${status}, ${next}.`,
  }));
});
