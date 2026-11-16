// layer.js — proje katmanı sürümü ve yükseltme (MustToHave madde 12).
//
// Katman sürümü team.json > version'dadır (yoksa 1). Her göç bir sürümden bir sonrakine geçer ve
// YALNIZCA eksik olanı ekler; kullanıcının yazdığı değerlere dokunmaz. setup-project --upgrade kullanır,
// team-preflight sürüm uyarısını ve .githooks uyumunu buradan alır.
//
//   v1 (0.1.0) → v2 (0.2.0–0.6.0): team.json'a evidence ve sandbox; STATUS.md team-status'a unverified=0
//   v2 → v3 (0.7.0): team.json'a autonomy ve models
//   v3 → v4 (0.8.0): team.json'a design (tasarım kapısı)

"use strict";
const fs = require("fs");
const path = require("path");
const cfgLib = require("./team-config");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

const MIGRATIONS = [
  {
    from: 1,
    to: 2,
    title: "kanıt kaydı ve sandbox alanları (plugin 0.2.0)",
    team(team, changes) {
      if (!("evidence" in team)) { team.evidence = { mode: "warn", maxAgeHours: 24 }; changes.push('team.json: + "evidence": { "mode": "warn", "maxAgeHours": 24 }'); }
      if (!("sandbox" in team)) { team.sandbox = { allowedDomains: [] }; changes.push('team.json: + "sandbox": { "allowedDomains": [] }'); }
    },
    files(projectDir, config, edits) {
      const rel = path.posix.join(config.paths.projectDocs, "STATUS.md");
      const file = path.join(projectDir, rel);
      if (!fs.existsSync(file)) return;
      const text = fs.readFileSync(file, "utf8");
      if (/<!--\s*team-status:[^>]*-->/.test(text) && !/<!--\s*team-status:[^>]*unverified=/.test(text)) {
        edits.push({ rel, description: `${rel}: team-status satırına unverified=0`, apply: () => fs.writeFileSync(file, text.replace(/(<!--\s*team-status:[^>]*?)\s*-->/, "$1 unverified=0 -->")) });
      }
    },
  },
  {
    from: 2,
    to: 3,
    title: "özerklik düzeyi ve model seçimi (plugin 0.7.0)",
    team(team, changes) {
      if (!("autonomy" in team)) { team.autonomy = "checkpoint"; changes.push('team.json: + "autonomy": "checkpoint"'); }
      if (!("models" in team)) { team.models = { roles: {}, tasks: {} }; changes.push('team.json: + "models": { "roles": {}, "tasks": {} }'); }
    },
    files() {},
  },
  {
    from: 3,
    to: 4,
    title: "tasarım kapısı (plugin 0.8.0)",
    team(team, changes) {
      if (!("design" in team)) {
        team.design = { gate: "warn", minScore: 8, variants: ["mobile-light", "mobile-dark", "desktop-light", "desktop-dark"], reviews: "Docs/Design/reviews/" };
        changes.push('team.json: + "design": { "gate": "warn", "minScore": 8, … }');
      }
    },
    files() {},
  },
  {
    from: 4,
    to: 5,
    title: "makine okunur plan ve retrospektif (plugin 0.11.0)",
    team() {},
    files(projectDir, config, edits) {
      const tpl = path.join(__dirname, "..", "..", "templates", "project", "Docs", "Project");
      for (const f of ["plan.example.json", path.posix.join("retros", "_TEMPLATE.md")]) {
        const rel = path.posix.join(config.paths.projectDocs, f);
        const file = path.join(projectDir, rel);
        if (fs.existsSync(file)) continue;
        edits.push({ rel, description: `${rel}: şablon eklendi`, apply: () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(path.join(tpl, f), file); } });
      }
    },
  },
];

function readTeam(projectDir) {
  const file = path.join(projectDir, cfgLib.LAYER_DIR, cfgLib.CONFIG_FILE);
  if (!fs.existsSync(file)) return { file, team: null, error: null };
  try {
    const team = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof team !== "object" || team === null || Array.isArray(team)) return { file, team: null, error: "team.json bir JSON nesnesi değil" };
    return { file, team, error: null };
  } catch (e) {
    return { file, team: null, error: `team.json okunamadı: ${e.message}` };
  }
}

/** Katmanın sürüm durumu. @returns {{version: number|null, current: number, status: "none"|"current"|"outdated"|"newer"|"unsupported"|"invalid", error?: string}} */
function layerStatus(projectDir) {
  const { team, error } = readTeam(projectDir);
  const current = cfgLib.LAYER_VERSION;
  if (error) return { version: null, current, status: "invalid", error };
  if (!team) return { version: null, current, status: "none" };
  const v = "version" in team ? team.version : 1;
  if (!Number.isInteger(v) || v < 1) return { version: v, current, status: "invalid", error: "version pozitif bir tam sayı olmalı" };
  if (v > current) return { version: v, current, status: "newer" };
  if (v < cfgLib.MIN_LAYER_VERSION) return { version: v, current, status: "unsupported" };
  return { version: v, current, status: v === current ? "current" : "outdated" };
}

/**
 * Yükseltme planı. Hiçbir şey yazmaz; apply() ile uygulanır.
 * @returns {{from: number, to: number, steps: string[], changes: string[], apply: () => void, error: string|null}}
 */
function planUpgrade(projectDir) {
  const { file, team, error } = readTeam(projectDir);
  const empty = { from: null, to: cfgLib.LAYER_VERSION, steps: [], changes: [], apply() {}, error };
  if (error || !team) return { ...empty, error: error || `${cfgLib.LAYER_DIR}/team.json yok; önce setup-project` };
  const from = "version" in team ? team.version : 1;
  if (!Number.isInteger(from) || from < 1) return { ...empty, error: "team.json > version geçersiz" };
  if (from > cfgLib.LAYER_VERSION) return { ...empty, from, error: `katman sürümü ${from} bu plugin'den yeni (en fazla ${cfgLib.LAYER_VERSION}); plugin'i güncelleyin` };

  const next = JSON.parse(JSON.stringify(team));
  const changes = [], steps = [], edits = [];
  const { config } = cfgLib.loadConfig(projectDir); // yollar (STATUS.md yeri) için; hata olsa da varsayılanlar döner
  for (const m of MIGRATIONS) {
    if (m.from < from) continue;
    steps.push(`v${m.from} → v${m.to}: ${m.title}`);
    m.team(next, changes);
    m.files(projectDir, config, edits);
  }
  if (from !== cfgLib.LAYER_VERSION) { next.version = cfgLib.LAYER_VERSION; changes.push(`team.json: version ${from} → ${cfgLib.LAYER_VERSION}`); }
  for (const e of edits) changes.push(e.description);
  return {
    from,
    to: cfgLib.LAYER_VERSION,
    steps,
    changes,
    error: null,
    apply() {
      if (JSON.stringify(next) !== JSON.stringify(team)) fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
      for (const e of edits) e.apply();
    },
  };
}

/** Kurulu .githooks dosyaları plugin şablonuyla aynı mı? @returns {{installed: boolean, stale: string[]}} */
function githooksDrift(projectDir) {
  const stale = [];
  let installed = false;
  for (const f of ["pre-commit", "review-cache.js"]) {
    const mine = path.join(projectDir, ".githooks", f);
    if (!fs.existsSync(mine)) continue;
    installed = true;
    const norm = (s) => s.replace(/\r\n/g, "\n");
    if (norm(fs.readFileSync(mine, "utf8")) !== norm(fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "githooks", f), "utf8"))) stale.push(f);
  }
  return { installed, stale };
}

module.exports = { MIGRATIONS, layerStatus, planUpgrade, githooksDrift };
