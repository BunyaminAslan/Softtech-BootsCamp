// design.js — tasarım kapısı (MustToHave madde 10).
//
// Görev açıklamasında "UI: evet" satırı olan görev, bir tasarım inceleme dosyasıyla kapanır:
//   Tasarım: Docs/Design/reviews/S1-02.md
// İnceleme dosyası (şablon: templates/project/Docs/Design/reviews/_TEMPLATE.md) şunları içerir:
//   - "ADR: <yol>"             → var olan bir tasarım ADR'si
//   - "Puan: N/10"             → team.json > design.minScore ve üstü
//   - varyant tablosu          → design.variants'taki her varyant için var olan bir ekran görüntüsü dosyası
//   - kontrol listesi          → işaretlenmemiş madde ("- [ ]") uyarıdır
// Bu modül dosyaların içeriğine (görüntünün kendisine) bakmaz; ekran görüntüsünü üretmek ve puanlamak
// UI sahibinin (Playwright MCP + impeccable critique), kontrolü lead'in işidir. Kapı, adımların atlanmadığını garanti eder.

"use strict";
const fs = require("fs");
const path = require("path");

const UI_LINE = /^\s*[-*]?\s*\**UI\**\s*:\s*\**\s*(evet|yes|true)\b/im;
const DESIGN_LINE = /^\s*[-*]?\s*\**Tasarım\**\s*:\s*\**\s*`?([^`\s*]+)`?/im;

function isUiTask(description) {
  return UI_LINE.test(String(description || ""));
}

/**
 * @returns {{required: boolean, file: string|null, score: number|null, problems: string[], warnings: string[]}}
 */
function evaluateDesign(root, description, config) {
  const out = { required: false, file: null, score: null, problems: [], warnings: [] };
  const d = config.design;
  if (!d || d.gate === "off" || !isUiTask(description)) return out;
  out.required = true;
  const m = DESIGN_LINE.exec(String(description));
  if (!m) {
    out.problems.push(`UI görevi ama açıklamada \`Tasarım: ${d.reviews}<görev>.md\` satırı yok (ekran görüntüleri ve puanlı inceleme gerekir)`);
    return out;
  }
  const rel = m[1].replace(/\\/g, "/");
  out.file = rel;
  const abs = path.resolve(root, rel);
  const inside = !path.relative(root, abs).startsWith("..") && !path.isAbsolute(path.relative(root, abs));
  if (!inside) { out.problems.push(`tasarım incelemesi proje dışında: ${rel}`); return out; }
  if (!fs.existsSync(abs)) { out.problems.push(`tasarım incelemesi bulunamadı: ${rel}`); return out; }
  const text = fs.readFileSync(abs, "utf8");
  const dir = path.dirname(abs);
  const resolveRef = (p) => {
    const clean = p.replace(/^<|>$/g, "");
    const fromRoot = path.resolve(root, clean);
    return fs.existsSync(fromRoot) ? fromRoot : path.resolve(dir, clean);
  };

  const adr = /^\s*[-*]?\s*\**ADR\**\s*:\s*`?([^`\s]+)`?/im.exec(text);
  if (!adr) out.problems.push(`${rel}: tasarım ADR'si referansı yok (ADR: Docs/ADR/…)`);
  else if (!fs.existsSync(resolveRef(adr[1]))) out.problems.push(`${rel}: ADR bulunamadı: ${adr[1]}`);

  const score = /^\s*[-*]?\s*\**Puan\**\s*:\s*\**\s*(\d+(?:[.,]\d+)?)\s*\/\s*10/im.exec(text);
  if (!score) out.problems.push(`${rel}: "Puan: N/10" satırı yok`);
  else {
    out.score = Number(score[1].replace(",", "."));
    if (out.score < d.minScore) out.problems.push(`${rel}: puan ${out.score}/10, eşik ${d.minScore}/10; bulguları düzeltip yeniden incele`);
  }

  // Varyant tablosu: | <varyant> | <görüntü yolu> |
  const rows = [...text.matchAll(/^\|\s*`?([a-z0-9][a-z0-9-]*)`?\s*\|\s*`?([^|`]+?)`?\s*\|/gim)];
  for (const v of d.variants) {
    const row = rows.find((r) => r[1].toLowerCase() === v);
    if (!row) { out.problems.push(`${rel}: '${v}' varyantının ekran görüntüsü satırı yok`); continue; }
    const img = row[2].trim().replace(/^!\[[^\]]*\]\(|\)$/g, "");
    if (!/\.(png|jpe?g|webp)$/i.test(img)) out.problems.push(`${rel}: '${v}' için görüntü dosyası değil: ${img}`);
    else if (!fs.existsSync(resolveRef(img))) out.problems.push(`${rel}: '${v}' görüntüsü bulunamadı: ${img}`);
  }

  const open = [...text.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map((x) => x[1].trim());
  if (open.length) out.warnings.push(`${rel}: kontrol listesinde işaretlenmemiş ${open.length} madde: ${open.slice(0, 3).join("; ")}${open.length > 3 ? "; …" : ""}`);
  return out;
}

module.exports = { isUiTask, evaluateDesign };
