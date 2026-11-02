// SubagentStop ve TeammateIdle hook'u: reviewer işini bitirdiğinde chat'e kısa bir mesaj yazar.
// - SubagentStop: subagent olarak çalıştığında (commit hook'u / HOOK MODU)
// - TeammateIdle: agent team'de teammate olarak çalıştığında
// Claude Code olay bilgisini stdin'den JSON olarak gönderir; biz de stdout'a
// {"systemMessage": "..."} yazarak mesajı kullanıcıya gösteririz.

const fs = require("fs");

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

  const msg = MESSAGES[input.agent_type] || MESSAGES[input.teammate_name];
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
