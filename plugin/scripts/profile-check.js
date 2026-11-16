#!/usr/bin/env node
// profile-check.js — yığın profili doğrulayıcı.
//   node profile-check.js <dosya.md> [--role <rol>]   tek dosya
//   node profile-check.js --project <dizin>           team.json'daki etkin rollerin profilleri
//   node profile-check.js --builtin                   plugin'deki hazır profiller
// Çıkış: 0 geçerli, 1 hata var. Uyarılar çıkışı değiştirmez.
"use strict";
const fs = require("fs");
const path = require("path");
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const prof = require(path.join(PLUGIN_ROOT, "hooks", "lib", "profile"));
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));

const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const items = [];

if (argv.includes("--builtin")) {
  for (const p of prof.builtinProfiles()) items.push({ label: `${p.role}/${p.name}`, ...prof.validateProfile(fs.readFileSync(p.file, "utf8"), p) });
} else if (opt("--project")) {
  const dir = path.resolve(opt("--project"));
  for (const s of prof.profileStatus(dir, cfgLib.loadConfig(dir).config)) items.push({ label: `${s.role}/${s.name} (${s.source || "yok"}${s.file ? ": " + s.file : ""})`, errors: s.errors, warnings: s.warnings });
} else if (argv[0] && !argv[0].startsWith("--")) {
  const file = path.resolve(argv[0]);
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { console.error(`okunamadı: ${file}`); process.exit(1); }
  items.push({ label: file, ...prof.validateProfile(text, { role: opt("--role"), name: path.basename(file, ".md") }) });
} else {
  console.error("Kullanım: profile-check.js <dosya.md> [--role <rol>] | --project <dizin> | --builtin");
  process.exit(2);
}

let bad = 0;
for (const it of items) {
  console.log(`${it.errors.length ? "GEÇERSİZ" : "GEÇERLİ "}  ${it.label}`);
  for (const e of it.errors) console.log(`  HATA  ${e}`);
  for (const w of it.warnings) console.log(`  UYARI ${w}`);
  if (it.errors.length) bad++;
}
if (!items.length) console.log("Profil tanımlı rol yok.");
process.exit(bad ? 1 : 0);
