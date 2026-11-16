#!/usr/bin/env node
// usage-report.js — Sprint/oturum sonu kullanım raporu (MustToHave madde 11).
// Claude Code transcript'lerindeki (~/.claude/projects/<proje>/) mesaj başı kullanım verisini toplar:
// model ve rol bazında giriş/çıkış/önbellek token'ları. Limitler token tabanlıdır; dolar karşılığı
// fiyat tablosu değiştiği için hesaplanmaz. Hiçbir dosyayı değiştirmez.
//
// Kullanım: node "<plugin>/scripts/usage-report.js" [--project <dizin>] [--since 7d|24h] [--session <id>] [--json]
//           [--projects-dir <~/.claude/projects/...>]   (test ve özel kurulumlar için)
// Transcript biçimi Claude Code tarafından belgelenmemiştir; okuma en iyi çabadır.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));

const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const ROOT = path.resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || process.cwd());

function sinceMs(s) {
  if (!s) return 7 * 86400000;
  const m = /^(\d+)\s*(h|d)$/i.exec(s);
  if (!m) { console.error("--since biçimi: 24h, 7d"); process.exit(2); }
  return Number(m[1]) * (m[2].toLowerCase() === "h" ? 3600000 : 86400000);
}
const encode = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, "-");

function listJsonl(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function agentTypeOf(file) {
  const meta = file.replace(/\.jsonl$/, ".meta.json");
  try { return JSON.parse(fs.readFileSync(meta, "utf8")).agentType || null; } catch (_) { return null; }
}

function collect() {
  const dir = opt("--projects-dir") || path.join(os.homedir(), ".claude", "projects", encode(ROOT));
  const limit = Date.now() - sinceMs(opt("--since"));
  const session = opt("--session");
  const { config } = cfgLib.loadConfig(ROOT);
  const seen = new Set();
  const byModel = {}, byRole = {};
  let files = listJsonl(dir).filter((f) => { try { return fs.statSync(f).mtimeMs >= limit; } catch (_) { return false; } });
  if (session) files = files.filter((f) => f.includes(session));
  const zero = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 });
  for (const f of files) {
    const type = agentTypeOf(f);
    const who = type ? (cfgLib.roleFor(type, config) || type) : /[\\/]subagents[\\/]/.test(f) ? "(alt agent)" : "ana oturum";
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
    for (const line of text.split("\n")) {
      if (!line.includes('"usage"')) continue;
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      const m = e.message;
      if (!m || !m.usage || !m.model || e.type !== "assistant" || m.model === "<synthetic>") continue; // <synthetic>: Claude Code'un iç mesajı
      if (Date.parse(e.timestamp) < limit) continue;
      const key = m.id || e.requestId || e.uuid;
      if (seen.has(key)) continue; // aynı yanıt birden çok içerik bloğu satırına bölünebilir
      seen.add(key);
      const u = m.usage;
      for (const [map, k] of [[byModel, m.model], [byRole, who]]) {
        const s = map[k] || (map[k] = zero());
        s.input += u.input_tokens || 0;
        s.output += u.output_tokens || 0;
        s.cacheWrite += u.cache_creation_input_tokens || 0;
        s.cacheRead += u.cache_read_input_tokens || 0;
        s.messages++;
      }
    }
  }
  return { projectsDir: dir, files: files.length, since: new Date(limit).toISOString(), byModel, byRole, models: config.models };
}

const fmt = (n) => n.toLocaleString("tr-TR");
function render(r) {
  const L = [`# Kullanım raporu (${r.since.slice(0, 10)} sonrası)`, "", `Kaynak: ${r.projectsDir} (${r.files} transcript)`];
  if (!r.files) return L.concat("", "Bu dönemde transcript bulunamadı.").join("\n");
  const table = (title, map) => {
    L.push("", `## ${title}`, "| | Mesaj | Giriş | Çıkış | Önbelleğe yazma | Önbellekten okuma |", "|---|---|---|---|---|---|");
    for (const [k, s] of Object.entries(map).sort((a, b) => b[1].output - a[1].output)) L.push(`| ${k} | ${fmt(s.messages)} | ${fmt(s.input)} | ${fmt(s.output)} | ${fmt(s.cacheWrite)} | ${fmt(s.cacheRead)} |`);
  };
  table("Model bazında", r.byModel);
  table("Rol bazında", r.byRole);
  const roles = Object.entries(r.models.roles || {}).map(([k, v]) => `${k} → ${v}`).join(", ");
  L.push("", `team.json > models.roles: ${roles || "(boş: ajan dosyalarındaki modeller)"}`);
  L.push("Not: Limitler token tabanlıdır; çıkış token'ı en pahalısıdır. Mekanik işleri (test iskeleti, doküman, format) daha küçük modelle koşan bir üyeye vermek için team.json > models'ı kullanın.");
  return L.join("\n");
}

const r = collect();
process.stdout.write((argv.includes("--json") ? JSON.stringify(r, null, 2) : render(r)) + "\n");
