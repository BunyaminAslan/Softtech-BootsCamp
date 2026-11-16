// TaskCompleted hook'u: agent team'de bir görev "tamamlandı" işaretlenmeden önce çalışır.
// Exit 2 + stderr: görevin kapanması engellenir, mesaj teammate'e geri bildirim olarak gider.
// Exit 0 + {"systemMessage"}: görev kapanır, mesaj kullanıcıya gösterilir.
//
// 1) "[DOC] Sprint dokümanını tamamla" (precommit takımı): Docs/Sprint_N.md bölümlerini kontrol eder.
// 2) Geliştirme görevleri [BACKEND] [MOBILE] [WEB] [TEST] [FIX]:
//    a) TEAM_RULES K1 satırları (Komut: / Dizin: / Sonuç:) yoksa kapanışı engeller.
//    b) Kanıt kaydı: açıklamadaki "Kanıt: L-xxxxxxxx" kimliklerini kayıttan doğrular (lib/ledger.js).
//       team.json > evidence.mode: "warn" (varsayılan) → engellemez, ciddi uyarı verir;
//       "enforce" → kanıtsız kapanışı engeller; "strict" → ayrıca yalnızca project.md > Komutlar
//       tablosundaki komutlar kanıt sayılır.
//    c) <projectDocs>/STATUS.md satırını ✅ (doğrulandı) veya ⚠️ Kanıtsız yapar, team-status sayaçlarını günceller.

"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const cfgLib = require("./lib/team-config");
const ledger = require("./lib/ledger");
const designLib = require("./lib/design");

const GATED_DOC_TASK = "[DOC] Sprint dokümanını tamamla";
const REQUIRED_SECTIONS = [
  "## 1. Özet",
  "## 5. Test Sonuçları",
  "## 6. Tasarım ve SOLID Değerlendirmesi",
  "## 7. Güvenlik Değerlendirmesi",
];
const DEV_TASK = /^\[([A-Z][A-Z0-9-]*)\]\s+(S\d+-\d+)\b/i;
const K1_LINES = [/Komut\s*:/i, /Dizin\s*:/i, /Sonu[çc]\s*:/i];
// Etiket → rol: team-config.rolesForTag (BACKEND, MOBILE, WEB, TEST, FIX + kind=developer özel roller: [<AD>])
const UNVERIFIED = "⚠️ Kanıtsız";
const DESIGN_PENDING = "⚠️ Tasarım";

function block(reason) {
  process.stderr.write(reason + "\n");
  process.exit(2);
}

function checkSprintDoc(root) {
  let commitCount = 0;
  try {
    commitCount = Number(execSync("git rev-list --count HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
  } catch (_) {} // henüz commit yok

  const docRel = `Docs/Sprint_${commitCount + 1}.md`;
  const docPath = path.join(root, docRel);
  if (!fs.existsSync(docPath)) block(`${docRel} bulunamadı. Görevi kapatmadan önce sprint dokümanını oluştur.`);

  const content = fs.readFileSync(docPath, "utf8");
  const missing = REQUIRED_SECTIONS.filter((s) => !content.includes(s));
  if (missing.length > 0) block(`${docRel} içinde eksik bölümler var: ${missing.join(", ")}. Bu bölümleri reviewer raporuna göre doldur.`);
  if (content.includes("Review raporu iletilmedi")) block(`${docRel} review raporu olmadan yazılmış. reviewer teammate'inden raporu bekle veya SendMessage ile iste.`);
}

const K1_HELP =
  "Komut: <çalıştırılan komutun tamamı>\nDizin: <pwd>\nSonuç: <test sayısı, geçen/kalan, hata sayısı, exit code>\n" +
  "Kanıt: <komutun ardından hook'un döndürdüğü L-xxxxxxxx kimliği>\n";

function checkK1Lines(text) {
  const missing = K1_LINES.filter((re) => !re.test(text));
  if (missing.length) {
    block(
      "TEAM_RULES K1: Görev kanıtsız kapatılamaz. Görev açıklamasına (TaskUpdate, ayrı bir çağrıyla) şu satırları ekle ve tekrar dene. Kapanışla aynı çağrıda gönderilen açıklama bu kontrole ulaşmaz: önce yalnızca açıklamayı güncelle, sonra ayrı bir çağrıyla durumu tamamlandı yap:\n" +
      K1_HELP + "Komut çalıştırılmadıysa 'Sonuç: çalıştırılmadı — <neden>' yaz."
    );
  }
}

// project.md > "## Komutlar" tablosundaki komutlar (strict mod)
function projectCommands(root) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, cfgLib.LAYER_DIR, "project.md"), "utf8");
  } catch (_) {
    return [];
  }
  const sec = /^##\s+Komutlar\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text);
  if (!sec) return [];
  const cmds = [];
  for (const line of sec[1].split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith("|") || /^\|[\s|:-]+\|$/.test(l)) continue;
    const cells = l.split("|").slice(2, -1).map((c) => c.trim().replace(/^`|`$/g, "").trim());
    for (const c of cells) if (c && !/^(<doldur>|—|-|yok|n\/a)$/i.test(c) && !/^(Kurulum|Build|Test|Lint)/i.test(c)) cmds.push(c);
  }
  return cmds;
}
const normCmd = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Atıf yapılan kanıtları doğrular.
 * @returns {{ids: string[], valid: string[], problems: string[], warnings: string[]}}
 */
function evaluateEvidence(root, input, config, tag, taskKey, now = Date.now()) {
  const text = String(input.task_description || "");
  const ids = [...new Set(text.match(ledger.ID_RE) || [])];
  const problems = [];
  const warnings = [];
  const valid = [];
  const roles = cfgLib.rolesForTag(tag, config) || [];
  const mode = config.evidence.mode;
  const maxAgeMs = config.evidence.maxAgeHours * 3600000;

  if (!ids.length) {
    problems.push("açıklamada `Kanıt: L-…` atfı yok; K1 satırları beyan olarak kaldı, kayıttan doğrulanamadı");
    return { ids, valid, problems, warnings };
  }
  const citations = ledger.readCitations(root);
  const commands = mode === "strict" ? projectCommands(root) : null;
  if (commands && !commands.length) problems.push("strict mod: project.md > Komutlar tablosu boş; hiçbir komut kanıt sayılamaz");

  for (const id of ids) {
    const found = ledger.find(root, id);
    if (!found) { problems.push(`${id} kayıtta yok (bu projede bu kimlikle bir komut çalıştırılmamış)`); continue; }
    const r = found.rec;
    const before = problems.length;
    if (!found.chainOk) problems.push(`${id} kayıt zinciri bozuk veya kayıt değiştirilmiş`);
    if (!roles.includes(r.role)) problems.push(`${id} ${r.role || "bilinmeyen"} rolüne ait; [${tag}] görevi için kanıt sayılmaz`);
    if (input.agent_id && r.agent_id && r.agent_id !== input.agent_id) problems.push(`${id} görevi kapatan agent'a değil başka bir agent'a ait`);
    if (r.result !== "ok" || r.exit !== 0) problems.push(`${id} başarılı bir komut değil (${r.result}, exit ${r.exit === null ? "?" : r.exit})`);
    const age = now - Date.parse(r.t);
    if (!(age <= maxAgeMs)) problems.push(`${id} ${Math.round(age / 3600000)} saat önce çalıştırılmış (sınır ${config.evidence.maxAgeHours} saat)`);
    const c = citations[id];
    if (c && c.task !== taskKey) problems.push(`${id} daha önce ${c.task} görevinde kanıt olarak kullanılmış`);
    if (commands && commands.length && !commands.some((k) => normCmd(r.cmd).includes(normCmd(k)))) {
      problems.push(`${id} komutu project.md > Komutlar tablosunda yok (strict): ${String(r.cmd).slice(0, 120)}`);
    }
    if (problems.length === before) valid.push(id);
  }

  // "Sonuç: 42/42" iddiası ile çıktıdaki test özeti (yalnızca uyarı)
  const claim = /Sonu[çc]\s*:\s*([^\n]*)/i.exec(text);
  const nums = claim && /(\d+)\s*\/\s*(\d+)/.exec(claim[1]);
  if (nums) {
    const [claimedPassed, claimedTotal] = [Number(nums[1]), Number(nums[2])];
    const summaries = valid.map((id) => [id, ledger.testSummary(ledger.find(root, id).rec.out_tail)]).filter(([, s]) => s);
    if (summaries.length && !summaries.some(([, s]) => s.passed === claimedPassed && (s.total == null || s.total === claimedTotal))) {
      const [id, s] = summaries[summaries.length - 1];
      warnings.push(`Sonuç satırı "${nums[0]}" diyor, ${id} çıktısındaki özet ${s.passed} geçen / ${s.failed} kalan${s.total != null ? " / " + s.total + " toplam" : ""}`);
    }
  }
  return { ids, valid, problems, warnings };
}

// STATUS.md: görev satırını işaretle, sayaçları yeniden hesapla (en iyi çaba; hata kapanışı engellemez)
// label: "✅ Tamamlandı" | UNVERIFIED | DESIGN_PENDING. İkisi de "tamam" sayılır ama ayrı sayaçlarda tutulur.
// Satır yoksa (lead tabloyu doldurmamış) görev tablonun sonuna eklenir; yoksa kapanış ve sayaçlar kaybolur (canlı test, 0.11.4).
function updateStatus(root, config, taskId, label, row = {}) {
  const file = path.join(root, config.paths.projectDocs, "STATUS.md");
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);

  // Görev tablosu: başlığında "Durum" olan ilk tablo
  const headerIdx = lines.findIndex((l) => /^\|.*\bGörev\b.*\bDurum\b.*\|$/.test(l.trim()));
  if (headerIdx < 0) return;
  const headers = lines[headerIdx].split("|").map((c) => c.trim());
  const statusCol = headers.indexOf("Durum");
  if (statusCol < 0) return;

  let end = headerIdx + 2;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  const idRe = new RegExp("(^|[^\\w-])" + taskId + "(?![\\w-])");
  if (!lines.slice(headerIdx + 2, end).some((l) => idRe.test(l.split("|")[1] || ""))) {
    const cells = headers.slice(1, -1).map((h) => {
      if (h === "Görev") return taskId + (row.title ? " " + row.title : "");
      if (h === "Sahip") return row.owner || "";
      if (h === "Durum") return label;
      if (h === "Not") return "hook ekledi (tabloda satır yoktu)";
      return "";
    });
    lines.splice(end, 0, "| " + cells.join(" | ") + " |");
  }

  let done = 0, total = 0, blocked = 0, unverified = 0, design = 0;
  for (let i = headerIdx + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const cells = lines[i].split("|");
    if (cells.length <= statusCol) continue;
    if (new RegExp(`\\b${taskId}\\b`).test(cells[1] || "")) {
      cells[statusCol] = ` ${label} `;
      lines[i] = cells.join("|");
    }
    total++;
    const st = cells[statusCol];
    if (st.includes("✅") || st.includes(UNVERIFIED) || st.includes(DESIGN_PENDING)) done++;
    if (st.includes(UNVERIFIED)) unverified++;
    if (st.includes(DESIGN_PENDING)) design++;
    if (st.includes("🔴")) blocked++;
  }

  let out = lines.join(eol);
  out = out.replace(/(<!--\s*team-status:[^>]*?)done=\d+/, "$1done=" + done)
    .replace(/(<!--\s*team-status:[^>]*?)total=\d+/, "$1total=" + total)
    .replace(/(<!--\s*team-status:[^>]*?)blocked=\d+/, "$1blocked=" + blocked)
    .replace(/(\*\*İlerleme:\*\*\s*)\d+\/\d+/, "$1" + done + "/" + total);
  for (const [k, v] of [["unverified", unverified], ["design", design]]) {
    if (k === "design" && !v && !new RegExp("<!--\\s*team-status:[^>]*?design=").test(out)) continue; // tasarım kapısı hiç kullanılmadıysa satırı kirletme
    const re = new RegExp("(<!--\\s*team-status:[^>]*?)" + k + "=\\d+");
    if (re.test(out)) out = out.replace(re, "$1" + k + "=" + v);
    else out = out.replace(/(<!--\s*team-status:[^>]*?)\s*-->/, "$1 " + k + "=" + v + " -->");
  }
  if (out !== original) fs.writeFileSync(file, out);
}

function handleDevTask(root, input, tag, taskKey) {
  const text = String(input.task_description || "");
  // Açıklama alanı gelmiyorsa doğrulama yapılamaz; kapanışı engelleme (lead K1'i elle uygular).
  if (!text) return;
  checkK1Lines(text);

  const { config, error } = cfgLib.loadConfig(root);
  const mode = config.evidence.mode;
  const ev = evaluateEvidence(root, input, config, tag, taskKey);
  const ds = designLib.evaluateDesign(root, text, config);
  const subject = String(input.task_subject || taskKey);

  if (ev.problems.length && mode !== "warn") {
    block(
      `TEAM_RULES K1 (evidence: ${mode}): Görev kanıt kaydıyla doğrulanamadı:\n- ${ev.problems.join("\n- ")}\n` +
      "Kanıt gerektiren komutu ön planda yeniden çalıştır; hook'un döndürdüğü kimliği açıklamaya `Kanıt: L-…` olarak ekle (TaskUpdate, ayrı çağrı) ve tekrar dene."
    );
  }
  if (ds.problems.length && config.design.gate === "enforce") {
    block(
      `TEAM_RULES K8 (design.gate: enforce): Tasarım kapısı geçilmedi:\n- ${ds.problems.join("\n- ")}\n` +
      "Ekran görüntülerini (design.variants) al, inceleme dosyasını şablona göre doldur, puan eşiğini geç ve açıklamaya `Tasarım: <dosya>` yaz."
    );
  }

  try {
    if (ev.valid.length) ledger.cite(root, ev.valid, taskKey);
  } catch (_) {}
  const verified = ev.problems.length === 0;
  const designOk = ds.problems.length === 0;
  const label = !verified ? UNVERIFIED : !designOk ? DESIGN_PENDING : "✅ Tamamlandı";
  try {
    const title = subject.replace(DEV_TASK, "").trim();
    updateStatus(root, config, taskKey, label, { title, owner: input.teammate_name || (cfgLib.rolesForTag(tag, config) || []).join("/") || tag.toLowerCase() });
  } catch (_) {}

  if (verified && designOk && !ev.warnings.length && !ds.warnings.length && !error) return;

  const who = input.teammate_name ? ` (${input.teammate_name})` : "";
  const lines = [];
  if (!verified) lines.push(...ev.problems);
  lines.push(...ev.warnings);
  if (!designOk) lines.push(...ds.problems.map((p) => "Tasarım: " + p));
  lines.push(...ds.warnings.map((w) => "Tasarım: " + w));
  if (error) lines.push(`team.json okunamadı, varsayılan ayarlar kullanıldı: ${error}`);
  const list = "\n- " + lines.join("\n- ");
  const head = !verified ? `⚠️ KANITSIZ KAPANIŞ: ${subject}${who}`
    : !designOk ? `⚠️ TASARIM KAPISI GEÇİLMEDİ: ${subject}${who}`
    : `⚠️ Kapanış uyarısı: ${subject}${who}`;

  const fixes = [];
  if (!verified) fixes.push("Kanıt gerektiren komutu ön planda yeniden çalıştır, dönen `Kanıt: L-…` kimliğini görev açıklamasına ekle.");
  if (!designOk) fixes.push(`Ekran görüntülerini al (${config.design.variants.join(", ")}), ${config.design.reviews}_TEMPLATE.md şablonuyla incelemeyi yaz (eşik ${config.design.minScore}/10), açıklamaya \`Tasarım: <dosya>\` ekle.`);
  const agentText = fixes.length
    ? `${head}${list}\nGörev kapandı ama doğrulanamadı (evidence: ${mode}, design.gate: ${config.design.gate}). ${fixes.join(" ")} Durumu lead'e bildir.`
    : `${head}${list}\nUyarıları gider veya farkı lead'e açıkla.`;
  const leadText = fixes.length
    ? `${head}${list}\nSTATUS.md'de "${label}" olarak işaretlendi. Eksik kanıtı/incelemeyi iste veya görevi yeniden aç; doğrulanmamış işi kabul etme (K1, K8).`
    : `${head}${list}`;

  try {
    const roles = cfgLib.rolesForTag(tag, config) || [];
    ledger.addNotice(root, {
      task: taskKey,
      target: { task_id: input.task_id != null ? String(input.task_id) : null, agent_id: input.agent_id || null, role: roles.length === 1 ? roles[0] : null },
      agentText,
      leadText,
    });
  } catch (_) {}

  process.stdout.write(JSON.stringify({ systemMessage: fixes.length ? `${head}${list}\n(Görev kapandı; STATUS.md: ${label})` : `${head}${list}` }));
}

function main(raw) {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (_) {}
  const root = cfgLib.projectRoot(input);
  const subject = String(input.task_subject || "");

  if (subject === GATED_DOC_TASK) return checkSprintDoc(root);

  const m = DEV_TASK.exec(subject);
  if (!m) return;
  const tag = m[1].toUpperCase();
  if (!cfgLib.rolesForTag(tag, cfgLib.loadConfig(root).config)) return; // geliştirme görevi değil ([ARCH], [DOC] …): karışma
  handleDevTask(root, input, tag, m[2].toUpperCase());
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => main(raw));
}

module.exports = { evaluateEvidence, projectCommands, updateStatus };
