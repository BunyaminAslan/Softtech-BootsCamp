// TaskCompleted hook'u: agent team'de bir görev "tamamlandı" işaretlenmeden önce çalışır.
// "[DOC] Sprint dokümanını tamamla" görevi için Docs/Sprint_N.md dosyasını kontrol eder.
// Eksik varsa exit 2 ile görevin kapanmasını engeller; stderr'e yazılan mesaj
// teammate'e geri bildirim olarak gider ve teammate eksiği tamamlamaya devam eder.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GATED_TASK = "[DOC] Sprint dokümanını tamamla";

// Dokümanda mutlaka bulunması gereken bölümler
const REQUIRED_SECTIONS = [
  "## 1. Özet",
  "## 5. Test Sonuçları",
  "## 6. Tasarım ve SOLID Değerlendirmesi",
  "## 7. Güvenlik Değerlendirmesi",
];

function block(reason) {
  process.stderr.write(reason + "\n");
  process.exit(2);
}

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (_) {}

  if (input.task_subject !== GATED_TASK) return; // diğer görevlere karışma

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  let commitCount = 0;
  try {
    commitCount = Number(execSync("git rev-list --count HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
  } catch (_) {} // henüz commit yok

  const docRel = `Docs/Sprint_${commitCount + 1}.md`;
  const docPath = path.join(root, docRel);

  if (!fs.existsSync(docPath)) {
    block(`${docRel} bulunamadı. Görevi kapatmadan önce sprint dokümanını oluştur.`);
  }

  const content = fs.readFileSync(docPath, "utf8");

  const missing = REQUIRED_SECTIONS.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    block(`${docRel} içinde eksik bölümler var: ${missing.join(", ")}. Bu bölümleri reviewer raporuna göre doldur.`);
  }

  if (content.includes("Review raporu iletilmedi")) {
    block(`${docRel} review raporu olmadan yazılmış. reviewer teammate'inden raporu bekle veya SendMessage ile iste.`);
  }
});
