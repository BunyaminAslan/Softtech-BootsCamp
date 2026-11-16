#!/usr/bin/env node
// session-start.js — SessionStart hook'u.
// Plugin'deki CLAUDE.md bağlama yüklenmediği için ana oturumun yönlendirme kurallarını
// hookSpecificOutput.additionalContext ile enjekte eder ve proje katmanının durumunu bildirir.
// Yalnızca ana oturumda çalışır (--agent ile başlatılan oturumlarda agent_type olur, atlanır).

"use strict";
const fs = require("fs");
const path = require("path");
const cfgLib = require("./lib/team-config");
const browserLib = require("./lib/browser");
const profLib = require("./lib/profile");

const PLUGIN = "agent-team";

function readLanguage(projectDir) {
  try {
    const md = fs.readFileSync(path.join(projectDir, cfgLib.LAYER_DIR, "project.md"), "utf8");
    const m = /^\s*[-*]?\s*\**Dil\**\s*:\s*\**\s*([^\n*<]+)/im.exec(md);
    return m ? m[1].trim() : null;
  } catch (_) {
    return null;
  }
}

function buildContext(projectDir, pw = browserLib.playwrightChromium()) {
  const layerDir = path.join(projectDir, cfgLib.LAYER_DIR);
  const hasLayer = fs.existsSync(layerDir);
  const { config, source, error } = cfgLib.loadConfig(projectDir);
  const lang = readLanguage(projectDir);

  const roles = Object.entries(config.roles)
    .filter(([, r]) => r.enabled)
    .map(([name, r]) => `${name}${r.custom ? ` [özel: ${r.kind}]` : ""}${r.profile ? ` (profil: ${r.profile})` : ""}`)
    .join(", ");
  const mapping = Object.entries(config.roles)
    .filter(([role, r]) => !r.custom || r.enabled)
    .map(([role]) => `\`${role}\` → \`${cfgLib.agentForRole(role, config, PLUGIN)}\``)
    .join(", ");

  const lines = [
    `# ${PLUGIN} framework bu oturumda etkin`,
    "",
    lang ? `Kullanıcıyla **${lang}** konuş (proje ayarı).` : "Kullanıcıyla onun yazdığı dilde konuş.",
    "",
    "## Yönlendirme (ana oturum = sen)",
    "Kullanıcı her zaman önce seninle konuşur. Hiçbir agent varsayılan ana agent yapılmaz; `settings.json` içine `\"agent\"` anahtarı ekleme.",
    "- **Kendin yap:** sorular, açıklama, araştırma; araç/ayar işleri; küçük ve tek alanlı işler; commit mesajı önerisi, değişiklik incelemesi.",
    "- **Takıma pasla (tech-lead):** yeni proje/modül; birden fazla alanı (backend, mobile, web, test) etkileyen özellik; mimari karar, sprint planı veya backlog gerektiren iş; kullanıcı açıkça \"takım\", \"lead\" veya \"projeyi yap\" derse.",
    "- Emin değilsen tek cümleyle sor: \"Bunu ben mi yapayım, yoksa tech-lead'e takım işi olarak mı paslayayım?\"",
    `- Paslama prosedürü \`${PLUGIN}:team\` skill'indedir; takımı yalnızca sen başlatırsın. lead'in \`[SPAWN-REQUEST]\` isteklerini ad ve prompt'u değiştirmeden uygula. Eşleme: ${mapping}.`,
    "- Bir takım üyesi guard tarafından engellenirse işlemi onun yerine kendin yapma; durumu kullanıcıya bildir.",
    "- Commit, push ve branch işlemleri kullanıcınındır; yalnızca açıkça istenirse yapılır.",
    "",
    "## Proje katmanı",
  ];

  if (!hasLayer) {
    lines.push(
      `- Bu projede \`${cfgLib.LAYER_DIR}/\` yok. Takım işine başlamadan önce kullanıcıya \`/${PLUGIN}:setup-project\` ile proje katmanını kurmayı öner (bağlam, kurallar, team.json, rol hafızaları). Repoda zaten kod varsa \`/${PLUGIN}:onboard\` daha uygundur: yığını, komutları ve klasör sahipliğini tarayıp taslak çıkarır.`,
      "- Küçük, takımsız işler için proje katmanı gerekmez."
    );
  } else {
    lines.push(`- \`${cfgLib.LAYER_DIR}/\` mevcut (team.json: ${source === "file" ? "var" : "yok, varsayılanlar"}). Etkin roller: ${roles}.`);
    if (error) lines.push(`- ⚠️ ${error}. Guard bu düzeltilene kadar takım rollerini engeller; kullanıcıya bildir.`);
    const roleModels = Object.entries(config.models.roles).map(([r, m]) => `${r}=${m}`).join(", ");
    lines.push(`- Özerklik: \`${config.autonomy}\` (lead'in ne zaman durup soracağı; tech-lead.md §0.1).${roleModels ? ` Teammate modelleri: ${roleModels} (lead [SPAWN-REQUEST]'te model satırıyla ister).` : ""}`);
    const check = path.join(__dirname, "..", "scripts", "profile-check.js");
    for (const p of profLib.profileStatus(projectDir, config).filter((x) => !x.valid)) {
      lines.push(`- ⚠️ Profil \`${p.role}/${p.name}\` ${p.file ? "geçersiz" : "bulunamadı"} (${p.errors.join("; ")}). Takım işinden önce kullanıcıya sor: (a) sen düzelt (şablon: \`${profLib.TEMPLATE}\`, doğrula: \`node "${check}" --project .\`), ya da (b) \`team.json\`'da \`"profile": null\` yapıp profilsiz devam et (rol generic kurallarla çalışır, profilin ağ izinleri eklenmez).`);
    }
    if (!pw.installed) {
      lines.push(`- ⚠️ Playwright Chromium kurulu değil: tasarım kapısı (K8) ekran görüntüleri, tester E2E ve lead URL incelemesi çalışmaz. Kullanıcıya bir kez sor: \`${pw.install}\` (~150 MB, sudo gerekmez) çalıştırılsın mı? Onay gelirse kendin çalıştır; onaysız indirme.${process.platform === "linux" ? " Sistem kütüphanesi hatası olursa kullanıcı kendisi `sudo npx playwright install-deps chromium` çalıştırır." : ""}`);
    }
    lines.push(`- Proje bağlamı \`${cfgLib.LAYER_DIR}/project.md\`, ek kurallar \`${cfgLib.LAYER_DIR}/rules.md\` içindedir. Kullanıcının proje hakkındaki sorularında önce bunlara bak.`);
  }
  return lines.join("\n");
}

// Kullanıcının ekranında görünen tek satırlık uyarı (yalnızca proje katmanı varsa: takım kullanılıyor)
function buildSystemMessage(projectDir, pw = browserLib.playwrightChromium()) {
  if (pw.installed || !fs.existsSync(path.join(projectDir, cfgLib.LAYER_DIR))) return null;
  return `agent-team: Playwright Chromium kurulu değil; ekran görüntüsü gerektiren işler (tasarım kapısı, E2E) çalışmaz. Kurulum: ${pw.hint}`;
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let input = {};
    try {
      input = JSON.parse(raw);
    } catch (_) {}
    if (input.agent_type) return; // --agent ile başlatılan oturum (ör. precommit-lead): yönlendirme gerekmez
    try {
      const dir = cfgLib.projectRoot(input);
      const pw = browserLib.playwrightChromium();
      const out = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: buildContext(dir, pw) } };
      const msg = buildSystemMessage(dir, pw);
      if (msg) out.systemMessage = msg;
      process.stdout.write(JSON.stringify(out));
    } catch (_) {}
  });
}

module.exports = { buildContext, buildSystemMessage };
