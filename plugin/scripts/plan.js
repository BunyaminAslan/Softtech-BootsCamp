#!/usr/bin/env node
// plan.js — sprint planı (Docs/Project/plan.json) için kontrol ve Markdown üretimi.
//   node plan.js check  [--project <dizin>] [--file <plan.json>]   döngü, sahipsiz/kapalı rol, K5, kapsam matrisi
//   node plan.js render [--project <dizin>] [--file <plan.json>]   SPRINT_PLAN.md'nin üretilen bölümünü yazar (önce check)
// Çıkış: 0 geçti, 1 plan hatası, 2 kullanım/dosya hatası.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));
const planLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "plan"));

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
function gitRoot(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const PROJECT = path.resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || gitRoot(process.cwd()) || process.cwd());
const { config } = cfgLib.loadConfig(PROJECT);
const docs = path.join(PROJECT, config.paths.projectDocs);
const file = path.resolve(PROJECT, opt("--file") || path.join(config.paths.projectDocs, "plan.json"));

if (!["check", "render"].includes(cmd)) {
  console.error("Kullanım: plan.js check|render [--project <dizin>] [--file <plan.json>]");
  process.exit(2);
}
let plan;
try { plan = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.error(`plan okunamadı (${file}): ${e.message}`); process.exit(2); }

const res = planLib.checkPlan(plan, config);
for (const e of res.errors) console.log(`HATA  ${e}`);
for (const w of res.warnings) console.log(`UYARI ${w}`);
const n = (plan.tasks || []).length;
if (res.errors.length) {
  console.log(`\nPlan kontrolü: ${res.errors.length} hata, ${res.warnings.length} uyarı (${n} görev). Düzeltmeden [PLAN-APPROVAL] gönderme.`);
  process.exit(1);
}
const maxW = Math.max(0, ...Object.values(res.waves));
console.log(`Plan kontrolü geçti: ${n} görev, ${maxW} dalga, ${(plan.scope || []).length} kapsam maddesi, ${res.warnings.length} uyarı.`);

if (cmd === "render") {
  const md = path.join(docs, "SPRINT_PLAN.md");
  let existing = "";
  try { existing = fs.readFileSync(md, "utf8"); } catch (_) {}
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(md, planLib.mergeIntoMarkdown(existing, planLib.renderPlan(plan, res.waves), plan.sprint));
  console.log(`Yazıldı: ${path.relative(PROJECT, md)} (işaretler dışındaki metin korundu)`);
}
process.exit(0);
