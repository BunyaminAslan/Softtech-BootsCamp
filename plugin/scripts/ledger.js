#!/usr/bin/env node
// ledger.js — kanıt kaydını okuma ve doğrulama (TEAM_RULES K1).
//
//   node "<plugin>/scripts/ledger.js" show <L-xxxxxxxx>
//   node "<plugin>/scripts/ledger.js" list [--role <rol>] [--agent <agent_id>] [--task <S1-01>] [--since <24h|7d>] [--limit <n>]
//   node "<plugin>/scripts/ledger.js" verify
//   node "<plugin>/scripts/ledger.js" export [--since <7d>] [--out <dosya.md>]
//   node "<plugin>/scripts/ledger.js" prune [--days <30>]
//   node "<plugin>/scripts/ledger.js" path
//
// Ortak seçenekler: --project <dizin> (varsayılan: CLAUDE_PROJECT_DIR veya çalışma dizini),
//                   --data <plugin veri dizini> (varsayılan: CLAUDE_PLUGIN_DATA, yoksa ~/.claude/plugins/data/agent-team*),
//                   --json
// Çıkış kodu: 0 tamam · 1 doğrulama hatası / bulunamadı · 2 kullanım hatası

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOKS = path.join(__dirname, "..", "hooks", "lib");
const ledger = require(path.join(HOOKS, "ledger"));

function usage(msg) {
  if (msg) process.stderr.write(msg + "\n");
  process.stderr.write("Kullanım: ledger.js show <id> | list [--role r --agent a --task S1-01 --since 24h --limit n] | verify | export [--since 7d --out f.md] | prune [--days 30] | path  [--project dir] [--data dir] [--json]\n");
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) usage(`${a} bir değer ister`);
      opts[k] = v;
      i++;
    } else opts._.push(a);
  }
  return opts;
}

function sinceMs(s) {
  if (!s) return null;
  const m = /^(\d+)\s*(m|h|d)$/i.exec(String(s));
  if (!m) usage(`--since biçimi: 30m, 24h, 7d (verilen: ${s})`);
  return Number(m[1]) * { m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
}

// Hook'lar CLAUDE_PLUGIN_DATA ile çalışır; kullanıcı/ajan kabuğunda bu değişken yoktur → veri dizinini bul.
function resolveDataDir(opts, projectDir) {
  if (opts.data) return path.resolve(opts.data);
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  const base = path.join(os.homedir(), ".claude", "plugins", "data");
  const candidates = [];
  try {
    for (const d of fs.readdirSync(base)) if (/^agent-team/.test(d)) candidates.push(path.join(base, d));
  } catch (_) {}
  candidates.push(path.join(os.tmpdir(), "agent-team"));
  const key = ledger.projectKey(projectDir);
  const withProject = candidates.filter((c) => fs.existsSync(path.join(c, "ledger", key)));
  if (withProject.length > 1) {
    // Birden çok kurulum (ör. marketplace + --plugin-dir) bu projeye yazmış: en son yazılanı seç
    withProject.sort((a, b) => fs.statSync(path.join(b, "ledger", key)).mtimeMs - fs.statSync(path.join(a, "ledger", key)).mtimeMs);
  }
  return withProject[0] || candidates[0];
}

const fmtTime = (t) => String(t || "").replace("T", " ").replace(/\.\d+Z$/, "Z");
const oneLine = (s, n = 90) => String(s || "").replace(/\s+/g, " ").slice(0, n);

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  if (!cmd) usage();
  const projectDir = path.resolve(opts.project || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  process.env.CLAUDE_PLUGIN_DATA = resolveDataDir(opts, projectDir);
  const out = (obj, text) => process.stdout.write((opts.json ? JSON.stringify(obj, null, 2) : text) + "\n");

  switch (cmd) {
    case "path":
      return out({ dir: ledger.ledgerDir(projectDir) }, ledger.ledgerDir(projectDir));

    case "show": {
      const id = opts._[1];
      if (!id || !/^L-[0-9a-f]{8}$/.test(id)) usage("show bir kimlik ister: L-xxxxxxxx");
      const f = ledger.find(projectDir, id);
      if (!f) {
        out({ found: false, id }, `${id} bu projenin kaydında yok (${ledger.ledgerDir(projectDir)}).`);
        process.exit(1);
      }
      const r = f.rec;
      const cited = ledger.readCitations(projectDir)[id] || null;
      const { file, ...rec } = r; // eslint-disable-line no-unused-vars
      out({ found: true, chainOk: f.chainOk, cited, record: rec }, [
        `${id}  ${f.chainOk ? "zincir ✓" : "ZİNCİR BOZUK ✗"}`,
        `Zaman:   ${fmtTime(r.t)}`,
        `Rol:     ${r.role} (${r.agent_type || "?"}, agent ${r.agent_id || "-"})`,
        `Komut:   ${r.cmd}`,
        `Dizin:   ${r.cwd || "-"}`,
        `Sonuç:   ${r.result}, exit ${r.exit === null ? "?" : r.exit}, ${r.ms == null ? "?" : (r.ms / 1000).toFixed(1) + " sn"}`,
        `Atıf:    ${cited ? cited.task : "-"}`,
        `Çıktı SHA-256: ${r.out_sha256}`,
        "Çıktının sonu (maskeli):",
        r.out_tail || "(boş)",
      ].join("\n"));
      return;
    }

    case "list": {
      const since = sinceMs(opts.since);
      const limit = opts.limit ? Number(opts.limit) : 50;
      if (!(limit > 0)) usage("--limit pozitif bir sayı olmalı");
      const cites = ledger.readCitations(projectDir);
      let rows = ledger.all(projectDir);
      if (opts.role) rows = rows.filter((r) => r.role === opts.role);
      if (opts.agent) rows = rows.filter((r) => r.agent_id === opts.agent);
      if (opts.task) rows = rows.filter((r) => cites[r.id] && cites[r.id].task === opts.task.toUpperCase());
      if (since) rows = rows.filter((r) => Date.now() - Date.parse(r.t) <= since);
      rows = rows.slice(-limit);
      out(rows.map(({ file, out_tail, ...r }) => ({ ...r, cited: cites[r.id] ? cites[r.id].task : null })), // eslint-disable-line no-unused-vars
        rows.length
          ? rows.map((r) => `${r.id}  ${fmtTime(r.t)}  ${String(r.role).padEnd(7)} ${String(r.result).padEnd(10)} exit ${String(r.exit === null ? "?" : r.exit).padEnd(3)} ${(cites[r.id] ? cites[r.id].task : "").padEnd(7)} ${oneLine(r.cmd)}`).join("\n")
          : "Kayıt yok.");
      return;
    }

    case "verify": {
      const files = ledger.agentFiles(ledger.ledgerDir(projectDir));
      const results = files.map((f) => ({ file: path.basename(f), ...ledger.verifyFile(f) }));
      const problems = results.flatMap((r) => r.problems);
      const count = results.reduce((n, r) => n + r.count, 0);
      out({ ok: problems.length === 0, files: files.length, records: count, problems },
        problems.length ? `✗ Kanıt kaydında ${problems.length} sorun:\n- ${problems.join("\n- ")}` : `✓ ${files.length} dosya, ${count} kayıt; zincir sağlam.`);
      if (problems.length) process.exit(1);
      return;
    }

    case "export": {
      const since = sinceMs(opts.since);
      const cites = ledger.readCitations(projectDir);
      let rows = ledger.all(projectDir).filter((r) => cites[r.id]);
      if (since) rows = rows.filter((r) => Date.now() - Date.parse(r.t) <= since);
      const bad = ledger.agentFiles(ledger.ledgerDir(projectDir)).flatMap((f) => ledger.verifyFile(f).problems);
      const md = [
        "# Kanıt raporu",
        "",
        `Oluşturma: ${new Date().toISOString()} · Zincir: ${bad.length ? `**${bad.length} sorun**` : "sağlam"} · Görevlere atfedilen kanıt: ${rows.length}`,
        "",
        "| Görev | Kanıt | Zaman (UTC) | Rol | Komut | Sonuç |",
        "|---|---|---|---|---|---|",
        ...rows
          .sort((a, b) => cites[a.id].task.localeCompare(cites[b.id].task, undefined, { numeric: true }))
          .map((r) => `| ${cites[r.id].task} | ${r.id} | ${fmtTime(r.t)} | ${r.role} | \`${oneLine(r.cmd, 80).replace(/\|/g, "\\|").replace(/`/g, "'")}\` | ${r.result}, exit ${r.exit === null ? "?" : r.exit} |`),
        "",
      ].join("\n");
      if (opts.out) {
        fs.writeFileSync(path.resolve(opts.out), md);
        out({ written: path.resolve(opts.out), rows: rows.length }, `Yazıldı: ${path.resolve(opts.out)} (${rows.length} satır)`);
      } else process.stdout.write(md);
      return;
    }

    case "prune": {
      const days = opts.days ? Number(opts.days) : ledger.RETENTION_DAYS;
      if (!(days > 0)) usage("--days pozitif bir sayı olmalı");
      const n = ledger.prune(days);
      return out({ removed: n }, `${n} eski kayıt dosyası silindi (>${days} gün).`);
    }

    default:
      usage(`Bilinmeyen komut: ${cmd}`);
  }
}

main();
