#!/usr/bin/env node
// resume-status.js — Kesintiden (limit, kapanan oturum) sonra takımın kaldığı yeri toplar.
// In-process teammate'ler oturum devamında geri gelmez; bu betik lead'in takımı yeniden kurması için
// bir "devam özeti" üretir. Hiçbir dosyayı değiştirmez, komut çalıştırmaz (git yalnızca okuma).
//
// Kullanım: node "<plugin>/scripts/resume-status.js" [--project <dizin>] [--json] [--tasks-dir <dizin>]
// Kaynaklar:
//   - <projectDocs>/STATUS.md: team-status satırı, bitmemiş görev satırları, "Şu an kim ne yapıyor",
//     "Yeniden başlatma için" bölümleri; SPRINT_PLAN.md > Ana hedef
//   - AdditionalAgentInformation/agents/<rol>/WORKLOG.md: her rolün son girişi
//   - Kanıt kaydı: rol başına son etkinlik, son 24 saatteki arka plan komutları (açık kalmış olabilir)
//   - Claude Code görev listesi (~/.claude/tasks/<takım>/<id>.json; belgelenmemiş biçim, en iyi çaba):
//     görev kodları STATUS.md ile eşleşen en son liste
//   - git: dal, commit'lenmemiş değişiklikler (sahibi olan role göre)
// Exit: 0

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));
const ledger = require(path.join(PLUGIN_ROOT, "hooks", "lib", "ledger"));

const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const ROOT = path.resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const readText = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (_) { return null; } };
const TASK_CODE = /\b(S\d+-\d+)\b/;

function section(md, title) {
  const m = new RegExp(`^##\\s+${title}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m").exec(md || "");
  const body = m ? m[1].trim() : "";
  return body && !/^\(?\s*(—|-|yok)?\s*\)?$/.test(body) ? body : null;
}

function readStatus(config) {
  const file = path.join(ROOT, config.paths.projectDocs, "STATUS.md");
  const md = readText(file);
  if (md === null) return { file: null };
  const ts = /<!--\s*team-status:([^>]*)-->/.exec(md);
  const kv = ts ? Object.fromEntries([...ts[1].matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]])) : {};
  const lines = md.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^\|.*\bGörev\b.*\bDurum\b.*\|$/.test(l.trim()));
  const open = [];
  if (hi >= 0) {
    const headers = lines[hi].split("|").map((c) => c.trim());
    const col = (n) => headers.indexOf(n);
    for (let i = hi + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
      const c = lines[i].split("|").map((x) => x.trim());
      const status = c[col("Durum")] || "";
      if (/✅/.test(status)) continue;
      open.push({ task: c[col("Görev")], owner: c[col("Sahip")] || null, wave: c[col("Dalga")] || null, waits: c[col("Bekler")] || null, status, unverified: /Kanıtsız/.test(status) });
    }
  }
  return {
    file: path.relative(ROOT, file).split(path.sep).join("/"),
    teamStatus: kv,
    open,
    who: section(md, "Şu an kim ne yapıyor"),
    restart: section(md, "Yeniden başlatma için"),
    blocks: section(md, "Bloklar"),
    next: section(md, "Sonraki adım"),
  };
}

function lastWorklog(role) {
  const md = readText(path.join(ROOT, cfgLib.LAYER_DIR, "agents", role, "WORKLOG.md"));
  if (!md) return null;
  const parts = md.split(/^(?=##\s)/m).filter((p) => /^##\s/.test(p));
  if (!parts.length) return null;
  const last = parts[parts.length - 1].trim();
  return last.length > 1200 ? last.slice(0, 1200) + "\n…" : last;
}

function ledgerActivity() {
  let rows = [];
  try { rows = ledger.all(ROOT); } catch (_) {}
  const byRole = {};
  for (const r of rows) byRole[r.role] = { t: r.t, id: r.id, cmd: String(r.cmd).slice(0, 160), result: r.result, exit: r.exit };
  const dayAgo = Date.now() - 86400000;
  const background = rows.filter((r) => r.result === "background" && Date.parse(r.t) >= dayAgo).map((r) => ({ role: r.role, t: r.t, cmd: String(r.cmd).slice(0, 200) }));
  return { byRole, background };
}

function taskList(statusOpen, statusAll) {
  const dirs = [opt("--tasks-dir"), path.join(os.homedir(), ".claude", "tasks")].filter(Boolean);
  const codes = new Set(statusAll);
  let best = null;
  for (const base of dirs) {
    let teams;
    try { teams = fs.readdirSync(base); } catch (_) { continue; }
    for (const t of teams) {
      const dir = path.join(base, t);
      let files;
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch (_) { continue; }
      const tasks = [];
      let mtime = 0;
      for (const f of files) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
          mtime = Math.max(mtime, fs.statSync(path.join(dir, f)).mtimeMs);
          if (j && typeof j.subject === "string") tasks.push({ id: String(j.id), subject: j.subject, status: j.status || null, owner: j.owner || null, blockedBy: j.blockedBy || [] });
        } catch (_) {}
      }
      const matches = tasks.filter((x) => { const m = TASK_CODE.exec(x.subject); return m && codes.has(m[1]); }).length;
      if (!matches) continue;
      if (!best || matches > best.matches || (matches === best.matches && mtime > best.mtime)) best = { team: t, dir, tasks, matches, mtime };
    }
  }
  if (!best) return null;
  const unfinished = best.tasks.filter((x) => x.status !== "completed" && x.status !== "deleted");
  return { team: best.team, updated: new Date(best.mtime).toISOString(), total: best.tasks.length, unfinished };
}

function gitState(config) {
  const run = (args) => { const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
  const branch = run(["branch", "--show-current"]);
  const porcelain = run(["status", "--porcelain"]);
  if (porcelain === null) return null;
  const devs = cfgLib.devRoles(config);
  const owner = (p) => {
    const lower = p.toLowerCase();
    for (const r of devs) for (const d of config.roles[r].paths || []) if (lower.startsWith(d.toLowerCase())) return r;
    if (lower.startsWith(config.paths.projectDocs.toLowerCase()) || lower.startsWith(config.paths.adr.toLowerCase())) return "lead";
    if (lower.startsWith(config.paths.testDocs.toLowerCase())) return "tester";
    if (lower.startsWith(config.paths.contract.toLowerCase())) return "backend";
    return "diğer";
  };
  const byOwner = {};
  for (const l of porcelain.split("\n").filter(Boolean)) {
    const p = l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop();
    (byOwner[owner(p)] = byOwner[owner(p)] || []).push(l.slice(0, 2).trim() + " " + p);
  }
  return { branch, lastCommit: run(["log", "-1", "--format=%h %s (%cr)"]), changes: byOwner };
}

function collect() {
  const { config, error } = cfgLib.loadConfig(ROOT);
  const status = readStatus(config);
  const plan = readText(path.join(ROOT, config.paths.projectDocs, "SPRINT_PLAN.md"));
  const goal = plan ? ((/Ana hedef[^\n]*\n?([^\n]*)/i.exec(plan) || [])[0] || "").replace(/\s+/g, " ").trim() || null : null;
  const roles = Object.entries(config.roles).filter(([, r]) => r.enabled).map(([r]) => r);
  const worklogs = Object.fromEntries(roles.map((r) => [r, lastWorklog(r)]).filter(([, w]) => w));
  const allCodes = [];
  const md = status.file ? readText(path.join(ROOT, status.file)) : "";
  for (const m of String(md).matchAll(/\b(S\d+-\d+)\b/g)) allCodes.push(m[1]);
  const tasks = taskList(status.open || [], allCodes);
  const owners = new Set((status.open || []).filter((o) => !/Bekliyor|⚪/.test(o.status) || o.unverified).map((o) => (o.owner || "").toLowerCase()).filter(Boolean));
  return {
    project: ROOT,
    layer: fs.existsSync(path.join(ROOT, cfgLib.LAYER_DIR)),
    configError: error,
    goal,
    status,
    worklogs,
    ledger: ledgerActivity(),
    tasks,
    git: gitState(config),
    respawn: [...owners].filter((o) => config.roles[o] && config.roles[o].enabled && o !== "lead"),
  };
}

function render(s) {
  const L = [`# Devam özeti — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "", `Proje: ${s.project}`];
  if (!s.layer) return L.concat("", `${cfgLib.LAYER_DIR}/ yok; devam edilecek bir takım işi bulunamadı. /agent-team:setup-project veya /agent-team:onboard.`).join("\n");
  if (s.configError) L.push(`⚠️ ${s.configError}`);
  if (s.goal) L.push(`Ana hedef: ${s.goal}`);
  const ts = s.status.teamStatus || {};
  L.push("", "## Plan durumu");
  if (!s.status.file) L.push("- STATUS.md yok; plan aşamasına geçilmemiş olabilir.");
  else {
    L.push(`- ${s.status.file}: sprint ${ts.sprint || "?"}, dalga ${ts.wave || "?"}, ${ts.done || "?"}/${ts.total || "?"} tamam, ${ts.blocked || 0} bloklu, ${ts.unverified || 0} kanıtsız`);
    if (s.status.open.length) {
      L.push("", "| Görev | Sahip | Dalga | Bekler | Durum |", "|---|---|---|---|---|");
      for (const o of s.status.open) L.push(`| ${o.task} | ${o.owner || "—"} | ${o.wave || "—"} | ${o.waits || "—"} | ${o.status} |`);
    } else L.push("- Bitmemiş görev yok.");
  }
  for (const [title, key] of [["Şu an kim ne yapıyordu", "who"], ["Yeniden başlatma notu (lead)", "restart"], ["Bloklar", "blocks"], ["Sonraki adım", "next"]]) {
    if (s.status[key]) L.push("", `## ${title}`, s.status[key]);
  }
  L.push("", "## Görev listesi (Claude Code)");
  if (!s.tasks) L.push("- Bu projeyle eşleşen görev listesi bulunamadı (yeni oturumda görevler lead tarafından STATUS.md'den yeniden açılır).");
  else {
    L.push(`- Liste \`${s.tasks.team}\` (son güncelleme ${s.tasks.updated}); ${s.tasks.unfinished.length}/${s.tasks.total} bitmemiş:`);
    for (const t of s.tasks.unfinished) L.push(`  - #${t.id} ${t.subject} — ${t.status || "?"}${t.owner ? `, sahip ${t.owner}` : ""}${t.blockedBy.length ? `, bekliyor: ${t.blockedBy.join(", ")}` : ""}`);
  }
  L.push("", "## Rollerin son durumu");
  const roles = new Set([...Object.keys(s.worklogs), ...Object.keys(s.ledger.byRole)]);
  if (!roles.size) L.push("- Worklog veya kanıt kaydında etkinlik yok.");
  for (const r of roles) {
    const a = s.ledger.byRole[r];
    L.push(`### ${r}`);
    if (a) L.push(`- Son komut: ${a.t} \`${a.cmd}\` (${a.result}, exit ${a.exit === null ? "?" : a.exit}, ${a.id})`);
    if (s.worklogs[r]) L.push("- Son worklog girişi:", "", s.worklogs[r].split("\n").map((x) => "  > " + x).join("\n"));
  }
  if (s.ledger.background.length) {
    L.push("", "## Açık kalmış olabilecek arka plan süreçleri (son 24 saat)", "Kesinti bu süreçleri kapatmamış olabilir. Kullanıcıya göster; `ps`/`ss -ltnp` ile kontrol edip kapatma kararını ona bırak.");
    for (const b of s.ledger.background) L.push(`- ${b.t} ${b.role}: \`${b.cmd}\``);
  }
  if (s.git) {
    L.push("", "## Depo", `- Dal: ${s.git.branch || "(ayrık HEAD)"} · son commit: ${s.git.lastCommit || "yok"}`);
    const ch = Object.entries(s.git.changes);
    if (!ch.length) L.push("- Commit'lenmemiş değişiklik yok.");
    for (const [o, files] of ch) L.push(`- ${o}: ${files.length} dosya (${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""})`);
  }
  L.push("", "## Yeniden başlatılacak roller (öneri)", s.respawn.length ? `- ${s.respawn.join(", ")} (bitmemiş, beklemede olmayan görevi olanlar). lead bunu doğrular; yalnızca gerekenleri [SPAWN-REQUEST] ile ister.` : "- Aktif görevi olan üye yok; lead plan durumuna göre karar verir.");
  return L.join("\n");
}

const s = collect();
process.stdout.write((argv.includes("--json") ? JSON.stringify(s, null, 2) : render(s)) + "\n");
