// profile.js — yığın profillerinin bulunması ve biçim doğrulaması.
// Profil yalnızca ajana bağlam ve sandbox'a ağ izni verir; guard/sahiplik/kapılar team.json'dan gelir.
// Geçersiz profil sandbox'a izin eklemez; kullanıcıya bildirilir (düzelt veya profilsiz devam).
"use strict";
const fs = require("fs");
const path = require("path");
const cfgLib = require("./team-config");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATE = path.join(PLUGIN_ROOT, "templates", "profile.md");

// Zorunlu "##" başlıkları (başlığın başı eşleşir; parantezli ekler serbest)
const REQUIRED_SECTIONS = [
  { key: "Yığın", re: /^##\s+Yığın\b/im },
  { key: "Konvansiyonlar", re: /^##\s+Konvansiyonlar\b/im },
  { key: "Komutlar", re: /^##\s+Komutlar\b/im },
  { key: "Test", re: /^##\s+Test\b/im },
  { key: "Ağ izinleri", re: /^##\s+Ağ izinleri\b/im },
  { key: "DoD", re: /^##\s+DoD\b/im },
];

function sectionBody(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /^##\s/m.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
}

/** @returns {{errors: string[], warnings: string[]}} */
function validateProfile(text, { role, name } = {}) {
  const errors = [], warnings = [];
  const t = String(text || "").replace(/\r\n/g, "\n");
  if (!t.trim()) return { errors: ["dosya boş"], warnings };
  const title = /^#\s+Profil:\s*([\w-]+)\s*\/\s*([\w.-]+)\s*$/m.exec(t);
  if (!title) errors.push("başlık yok: '# Profil: <rol> / <ad>'");
  else {
    if (role && title[1] !== role) warnings.push(`başlıktaki rol '${title[1]}', kullanıldığı rol '${role}'`);
    if (name && title[2] !== name) warnings.push(`başlıktaki ad '${title[2]}', dosya adı '${name}'`);
  }
  for (const s of REQUIRED_SECTIONS) if (!s.re.test(t)) errors.push(`'## ${s.key}' bölümü yok`);
  const cmds = sectionBody(t, /^##\s+Komutlar\b.*$/im);
  if (cmds != null && !/^\|.*`[^`]+`.*\|\s*$/m.test(cmds)) errors.push("Komutlar bölümünde `komut` içeren tablo satırı yok");
  if (cmds && /`[^`]*(--watch\b|\bnpm (run )?(dev|start)\b|\bdotnet watch\b|\buvicorn\b[^`]*--reload)[^`]*`/.test(cmds)) {
    warnings.push("Komutlar bölümünde watch/sunucu komutu var; kanıt komutu olarak kullanılmaz (K2/K5)");
  }
  const dod = sectionBody(t, /^##\s+DoD\b.*$/im);
  if (dod != null && !/^\s*-\s+\[ \]\s+\S/m.test(dod)) errors.push("DoD bölümünde '- [ ] madde' yok");
  if (/^##\s+Ağ izinleri\b/im.test(t)) {
    const net = require("./sandbox").parseNetworkSection(t);
    if (!net.domains.length) errors.push("Ağ izinleri bölümünde ``- `alan.adi`: neden`` maddesi yok");
    for (const i of net.invalid) errors.push(`geçersiz alan adı: ${i}`);
  }
  if (/<doldur>|TODO/i.test(t)) warnings.push("doldurulmamış alan var (<doldur>/TODO)");
  return { errors, warnings };
}

/** Profil dosyasını bulur: önce proje (AdditionalAgentInformation/profiles/<ad>.md), sonra plugin. */
function findProfile(projectDir, role, name) {
  const own = path.join(projectDir, cfgLib.LAYER_DIR, "profiles", name + ".md");
  if (fs.existsSync(own)) return { file: own, source: "project" };
  const builtin = path.join(PLUGIN_ROOT, "profiles", role, name + ".md");
  if (fs.existsSync(builtin)) return { file: builtin, source: "builtin" };
  return { file: null, source: null };
}

/**
 * team.json'daki etkin rollerin profil durumu.
 * @returns {Array<{role, name, file, source, errors, warnings, valid}>}
 */
function profileStatus(projectDir, config) {
  const out = [];
  for (const [role, rc] of Object.entries(config.roles)) {
    if (!rc.enabled || !rc.profile) continue;
    const f = findProfile(projectDir, role, rc.profile);
    let v = { errors: ["bulunamadı"], warnings: [] };
    if (f.file) {
      try { v = validateProfile(fs.readFileSync(f.file, "utf8"), { role, name: rc.profile }); }
      catch (e) { v = { errors: [`okunamadı: ${e.message}`], warnings: [] }; }
    }
    out.push({ role, name: rc.profile, ...f, ...v, valid: v.errors.length === 0 });
  }
  return out;
}

/** Plugin'deki hazır profiller: [{role, name, file}] */
function builtinProfiles() {
  const out = [];
  const base = path.join(PLUGIN_ROOT, "profiles");
  for (const role of fs.readdirSync(base)) {
    const dir = path.join(base, role);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".md") && f !== "README.md") out.push({ role, name: f.slice(0, -3), file: path.join(dir, f) });
  }
  return out;
}

module.exports = { REQUIRED_SECTIONS, TEMPLATE, validateProfile, findProfile, profileStatus, builtinProfiles };
