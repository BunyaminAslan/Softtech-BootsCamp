#!/usr/bin/env node
// agent-guard.js — agent-team takım rolleri için PreToolUse yetki kontrolü.
//
// Plugin hooks/hooks.json içinden guard.sh üzerinden çağrılır (Bash|PowerShell|Write|Edit|
// MultiEdit|NotebookEdit|Agent). Plugin ajanlarında frontmatter `hooks:` desteklenmediği için
// guard tüm oturumda çalışır ve çağıranı hook girdisinden belirler:
//   - ana oturum (agent_id/agent_type yok)      → kısıtlama yok
//   - takım dışı agent (Explore, precommit …)   → kısıtlama yok
//   - takım rolü (lead/backend/mobile/web/tester) → bu dosyadaki kurallar
//   - agent_id var ama türü bilinmiyor          → fail-closed: engellenir
//
// Alan sahipliği ve yollar projenin AdditionalAgentInformation/team.json dosyasından gelir
// (yoksa varsayılanlar). Kurallar agent .md dosyalarındaki "Yetkiler" bölümlerinin teknik
// karşılığıdır; ikisi birlikte güncellenir. Testler: node --test tests/hooks/*.test.js
//
// Engelleme: exit 2 + stderr (mesaj agent'a geri bildirim olarak gider).
// Fail-closed: girdi okunamazsa, team.json bozuksa veya beklenmeyen hata olursa takım rolü engellenir.

"use strict";
const path = require("path");
const os = require("os");
const cfgLib = require("./lib/team-config");

let ROLE = "?";
function block(reason) {
  process.stderr.write("⛔ agent-guard (" + ROLE + "): " + reason + "\n");
  process.exit(2);
}

// ---------------------------------------------------------------- Bash kuralları (tüm takım rolleri)
// git'ten sonra gelen genel seçenekler (-C dir, -c k=v, --git-dir=x, --no-pager …) atlanır
const GIT = String.raw`\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w-]+(?:=\S+)?))*\s+`;
const git = (rest, flags = "i") => new RegExp(GIT + rest, flags);

const BASH_RULES = [
  [git(String.raw`(commit|push|reset|rebase|merge|cherry-pick|revert|clean|tag|filter-branch|filter-repo|update-ref|replace|am|apply)\b`),
    "Depo geçmişini/durumunu değiştiren git komutları yasak; commit/branch kararları kullanıcıya ait."],
  [git(String.raw`(checkout|switch|restore)\b`), "Branch değiştirme ve dosya geri alma (checkout/switch/restore) kullanıcıya ait."],
  [git(String.raw`stash\b`), "git stash çalışma ağacını değiştirir; kullanıcıya bırak."],
  [git(String.raw`branch\s+(-\w*[dDmMcC]\b|--(delete|move|copy)\b)`), "Branch silme/yeniden adlandırma yasak."],
  [git(String.raw`config\b(?!\s+(--get\b|--get-all\b|-l\b|--list\b|user\.name\s*$|user\.email\s*$))`), "git config değiştirmek yasak (yalnızca okuma serbest)."],
  [/--no-verify\b/i, "Hook'ları atlamak (--no-verify) yasak."],
  [/\brm\s+(-\w+\s+)*-\w*r\w*\s+(.*\s)?["']?(\/|~|\.\.|\*|\.git|\.claude|\.githooks|AdditionalAgentInformation|Docs)(\/|\s|["']|$)/i,
    "Kök, üst dizin, joker veya korumalı klasörlerde özyinelemeli silme yasak."],
  [/\b(Remove-Item|ri|rd|rmdir|del|erase)\b.*\s-r(e(c(u(r(s(e)?)?)?)?)?)?\b/i,
    "Özyinelemeli silme (Remove-Item -Recurse) yasak; build çıktıları için framework'ün clean komutunu kullan."],
  [/(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression|node|python3?)\b/i,
    "İnternetten indirilen script'i doğrudan çalıştırmak yasak."],
  [/\b(npm|pnpm|yarn|bun)\s+publish\b|\bdotnet\s+nuget\s+push\b|\b(flutter|dart)\s+pub\s+publish\b|\bpod\s+trunk\s+push\b|\btwine\s+upload\b|\bcargo\s+publish\b/i,
    "Paket yayınlamak yasak."],
  [/\bdocker\s+(push|login)\b|\bkubectl\s+(apply|delete|edit|patch|scale|rollout|create)\b|\bhelm\s+(install|upgrade|uninstall)\b|\bterraform\s+(apply|destroy|import)\b/i,
    "Uzak ortamlara (registry, cluster, cloud) değişiklik göndermek yasak."],
  [/\baz\s+\S+\s+(create|delete|update)\b|\baws\s+\S+\s+(create|delete|put|update|terminate)|\bgcloud\s+.*\b(create|delete|deploy)\b|\b(vercel|netlify)\s+(deploy|--prod)\b/i,
    "Cloud kaynaklarını değiştirmek veya deploy etmek yasak."],
  [/\bfastlane\b|\beas\s+(submit|build|update)\b|\baltool\b/i,
    "Store'a yükleme / uzak build tetikleme yasak; kullanıcı onayıyla kendisi yapar."],
  [/\bdotnet\s+ef\s+database\s+drop\b|\bDROP\s+(DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b|\bprisma\s+migrate\s+reset\b/i,
    "Veritabanı silme/boşaltma yasak; gerekiyorsa kullanıcıdan iste."],
  [/\b(shutdown|Stop-Computer|Restart-Computer|diskpart|Set-ExecutionPolicy|setx)\b|\breg\s+(add|delete)\b|\bwsl(\.exe)?\s+--(shutdown|unregister|set-default)\b/i,
    "Sistem ayarlarını değiştiren komutlar yasak."],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(.*\s)?(-g|--global)\b|\bdotnet\s+tool\s+install\s+(-g|--global)\b|\b(winget|choco|scoop)\s+install\b|\b(apt|apt-get|dnf|yum|brew|snap)\s+install\b|\bsudo\b/i,
    "Global araç / sistem paketi kurulumu ve sudo yasak; gereken aracı lead üzerinden kullanıcıya önerin."],
  [/\bclaude\s+(plugin|mcp)\s+(install|add|remove|uninstall|enable|disable|update)\b|\bclaude\s+config\s+set\b/i,
    "Claude Code plugin/MCP/ayar değişikliği kullanıcıya ait."],
  [/impeccable[\\/]scripts[\\/]impeccable|\bimpeccable(\.cmd)?\s+(hooks|context|live|build-phase)\b|github\.com\/pbakaus\/impeccable\/releases/i,
    "impeccable motoru (indirilen, incelenmemiş native binary) ve hook kurulumu kullanılmaz; SKILL.md'deki 'Launcher unavailable' yolunu izle."],
  [/\.claude[\\/]+plugins[\\/]+data\b|CLAUDE_PLUGIN_DATA|[\\/]agent-team[\\/]+(ledger|agent-registry)\b/i,
    "Plugin veri dizinine (kanıt kaydı, agent kaydı) komutla erişmek yasak. Kaydı okumak için: node \"<plugin>/scripts/ledger.js\" show|list|verify."],
  [/\b(cat|type|Get-Content|gc|more|less|head|tail|bat|strings)\s+[^|;&]*(\.env(?![.\w]*(example|sample|template))\b|\.pem\b|\.pfx\b|\.p12\b|\.jks\b|\.keystore\b|id_rsa|id_ed25519)/i,
    "Gizli bilgi içeren dosyaları ekrana dökmek yasak."],
];

const ROLE_BASH_RULES = {
  tester: [
    [/\b(zap-baseline|zap-full-scan|zap\.sh|nikto|sqlmap|nmap)\b/i,
      "Güvenlik tarama araçları yalnızca kullanıcı onayıyla ve yalnızca local/test ortamına karşı çalıştırılır; önce izin iste."],
    [/\bk6\s+run\b.*https?:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2|host\.docker\.internal)/i,
      "Yük testi yalnızca local ortama karşı serbest; uzak hedef için kullanıcı onayı gerekir."],
  ],
};

// ---------------------------------------------------------------- Dosya kuralları
const toPosix = (p) => p.split(path.win32.sep).join("/");
const LAYER = cfgLib.LAYER_DIR.toLowerCase() + "/";

// Proje yapısından bağımsız korumalı yollar (küçük harfli göreli yol üzerinde)
const PROTECTED = [
  [/(^|\/)\.git\//, ".git klasörü"],
  [/(^|\/)\.claude\//, ".claude yapılandırması (ayar, skill, agent override'ları kullanıcıya ait)"],
  [/(^|\/)\.mcp\.json$/, "MCP yapılandırması (kullanıcıya ait)"],
  [/^\.githooks\//, "git hook'ları"],
  [/^\.github\//, "CI yapılandırması (.github/ kullanıcıya ait)"],
  [/^\.precommit-cache\//, "pre-commit önbelleği"],
  [/^docs\/sprint_\d+\.md$/, "Sprint dokümanları (sprint-documenter'a ait)"],
  [/(^|\/)\.env(\.[\w-]+)?$/, ".env dosyaları (yalnızca .env.example / .env.sample / .env.template yazılabilir)"],
  [/\.(pem|key|pfx|p12|jks|keystore|mobileprovision|p8)$/, "sertifika/anahtar dosyaları"],
  [/(^|\/)(google-services\.json|googleservice-info\.plist)$/, "Firebase gizli yapılandırma dosyaları"],
  [/(^|[/])key[.]properties$/, "Android imzalama yapılandırması (key.properties)"],
  [/(^|\/)appsettings\.production\.json$/, "production yapılandırması"],
];

// Tester: yalnızca gerçek test dosyaları/klasörleri (latest.js, contest.cs eşleşmez)
const TESTER_ALLOWED_LOWER = [
  /(^|\/)(tests?|specs?|__tests__|__mocks__|[.]maestro|e2e|integration_test|androidtest|fixtures|test-?data|test-utils|load-?tests?|perf-?tests?|qa|playwright)(\/|$)/,
  /(^|\/)[^/]*\.(unit|integration|e2e|api|functional|acceptance|contract)?tests?(\/|$)/,
  /[._-](test|tests|spec|e2e)\.\w+$/,
  /(^|[._/-])tests?\.(cs|kt|java|swift|dart|ts|tsx|js|jsx|mjs|py|go|rs)$/,
  /(^|\/)(playwright|vitest|jest)\.config\.\w+$/,
];
const TESTER_ALLOWED_CASE = [/[A-Za-z0-9]Tests?\.(cs|kt|java|swift)$/]; // UserServiceTests.cs

const under = (lowerRel, dir) => lowerRel === dir.toLowerCase().replace(/\/$/, "") || lowerRel.startsWith(dir.toLowerCase());

// Windows'ta Git Bash / WSL yollarını (/c/..., /mnt/c/...) sürücü yoluna çevir
function normalizeInputPath(p) {
  if (process.platform === "win32") {
    const m = /^\/(?:mnt\/)?([a-zA-Z])(\/.*)?$/.exec(p);
    if (m) return m[1].toUpperCase() + ":" + (m[2] || "/");
  }
  return p;
}

function isTempPath(abs) {
  const roots = [os.tmpdir(), "/tmp", "/var/tmp"].map((r) => path.resolve(r).toLowerCase());
  const a = abs.toLowerCase();
  return roots.some((r) => a === r || a.startsWith(r + path.sep) || a.startsWith(r + "/"));
}

function checkWrite(filePath, ctx, baseDir) {
  const { projectDir, config } = ctx;
  const abs = path.resolve(baseDir || projectDir, normalizeInputPath(filePath));
  const rel = toPosix(path.relative(projectDir, abs));
  const outside = rel.startsWith("../") || rel === ".." || path.isAbsolute(rel);
  // Proje dışındaki geçici dosyalar serbest. Proje temp altında olsa bile (ör. /tmp/x) proje içi kurallar uygulanır.
  if (outside && isTempPath(abs)) return;
  if (outside) block("Proje klasörü dışına yazmak yasak: " + abs);
  const lower = rel.toLowerCase();

  // Proje katmanı: rol yalnızca kendi klasörüne yazar; instructions.md ve diğer her şey kullanıcıya ait
  if (lower.startsWith(LAYER) || lower === LAYER.slice(0, -1)) {
    const own = LAYER + "agents/" + ROLE + "/";
    if (lower.startsWith(own) && lower !== own + "instructions.md") return;
    block(`${cfgLib.LAYER_DIR}/ kullanıcıya ait; yalnızca kendi klasörüne (${cfgLib.LAYER_DIR}/agents/${ROLE}/, instructions.md hariç) yazabilirsin. Değişiklik önerini lead'e ilet: ${rel}`);
  }

  const isEnvTemplate = /(^|\/)\.env\.(example|sample|template)$/.test(lower);
  for (const [re, what] of PROTECTED) {
    if (re.test(lower) && !isEnvTemplate) block("Korumalı dosyaya yazmak yasak (" + what + "): " + rel);
  }
  for (const p of config.protected) {
    if (under(lower, p)) block("Projede korumalı ilan edilmiş yol (team.json > protected): " + rel);
  }

  const P = config.paths;
  const devs = cfgLib.devRoles(config);
  const rc = config.roles[ROLE] || {};
  if (devs.includes(ROLE)) {
    for (const other of devs) {
      if (other === ROLE) continue;
      for (const p of config.roles[other].paths || []) {
        if (under(lower, p)) block(`Bu yol ${other} rolüne (${cfgLib.agentBaseName(cfgLib.agentForRole(other, config))}) ait. Değişiklik gerekiyorsa ${other}'a mesaj at: ${rel}`);
      }
    }
    if (ROLE !== "backend" && under(lower, P.contract)) {
      block("API sözleşmesinin sahibi backend; değişiklik önerini backend'e [CONTRACT-REQUEST] ile ilet: " + rel);
    }
    if (under(lower, P.testDocs)) block("Test dokümanları tester'a ait; ihtiyacını tester'a ilet: " + rel);
    if (under(lower, P.projectDocs)) block("Proje plan dokümanları lead'e ait; durum bilgini lead'e mesajla ilet: " + rel);
  }
  if (ROLE === "lead") {
    if (!(under(lower, P.projectDocs) || under(lower, P.adr))) {
      block(`tech-lead yalnızca ${P.projectDocs}, ${P.adr} ve ${cfgLib.LAYER_DIR}/agents/lead/ altına yazar. Kod, test veya sözleşme değişikliği için ilgili teammate'e görev ver: ${rel}`);
    }
  }
  if (ROLE === "tester") {
    const extra = config.roles.tester.paths || [];
    const ok = TESTER_ALLOWED_LOWER.some((re) => re.test(lower)) || TESTER_ALLOWED_CASE.some((re) => re.test(rel)) ||
      under(lower, P.testDocs) || extra.some((p) => under(lower, p));
    if (!ok) block("Tester yalnızca test kodu ve " + P.testDocs + " altına yazabilir. Üretim kodundaki hatayı bug raporu olarak ilgili geliştiriciye ilet: " + rel);
  }
  // Özel roller: reviewer / docs / allowlist yalnızca kendi yollarına yazar (katman klasörü yukarıda)
  if (rc.custom && rc.kind !== "developer") {
    if (!(rc.paths || []).some((p) => under(lower, p))) {
      const where = rc.paths && rc.paths.length ? rc.paths.join(", ") : "hiçbir proje yolu";
      block(`${ROLE} rolü (${rc.kind}) yalnızca ${where} ve ${cfgLib.LAYER_DIR}/agents/${ROLE}/ altına yazabilir. Değişiklik gerekiyorsa sahibine veya lead'e ilet: ${rel}`);
    }
  }
}

// ---------------------------------------------------------------- Bash ile dosya yazma
// Basit kabuk ayrıştırıcı: tırnakları korur, ; && || | ile segmentlere böler.
function splitSegments(cmd) {
  const segs = [];
  let cur = "", q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === ";" || c === "\n" || c === "|" || (c === "&" && cmd[i + 1] === "&")) {
      segs.push(cur); cur = "";
      if ((c === "&" || c === "|") && cmd[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function tokenize(seg) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function expandVars(p, projectDir) {
  return p
    .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, projectDir)
    .replace(/^(~|\$\{?HOME\}?)(?=\/|$)/, os.homedir());
}

// Komuttaki yazma hedeflerini çıkar
function bashWriteTargets(cmd) {
  return collectWriteTargets(cmd).map((x) => x.t);
}

const CD_CMDS = ["cd", "pushd", "chdir", "set-location", "sl", "push-location"];

// Hedefler + o andaki dizin değişiklikleri: `cd web && echo > x` → x, ["web"] altında çözülür.
// cds === null: dizin çözülemedi (cd $VAR, cd -); göreli hedefler fail-closed engellenir.
function collectWriteTargets(cmd) {
  const out = [];
  let cds = [];
  for (const rawSeg0 of splitSegments(cmd)) {
    const rawSeg = rawSeg0.replace(/^[({\s]+/, "");
    const targets = [];
    {
      const ct = tokenize(rawSeg);
      if (ct.length && CD_CMDS.includes(ct[0].toLowerCase())) {
        const dargs = ct.slice(1).filter((a) => !/^-(path|literalpath)$/i.test(a));
        const d = dargs[0];
        if (d === undefined) cds = cds && [os.homedir()];
        else if (d === "-" || /[$`]/.test(expandVars(d, "")) || /^%/.test(d)) cds = null;
        else if (cds) cds = cds.concat([d]);
        continue;
      }
    }
    // Yönlendirme hedefi olmayan tırnaklı metinleri maskele ("a > b" gibi metinler hedef sayılmasın)
    const seg = rawSeg.replace(/(>\s*)?("[^"]*"|'[^']*')/g, (m, op) => (op ? m : '""'));
    const redir = /(?:^|[^\d&<>=])(?:\d?>>?|&>>?)\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g;
    let m;
    while ((m = redir.exec(seg))) {
      const t = m[1].replace(/^["']|["']$/g, "");
      if (!t.startsWith("&") && t !== "/dev/null" && !/^\$null$/i.test(t)) targets.push(t);
    }

    const toks = tokenize(rawSeg.replace(/(?:\d?>>?|&>>?)\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g, " "));
    while (toks.length && (/^\w+=/.test(toks[0]) || ["env", "command", "nohup", "xargs", "time"].includes(toks[0]))) toks.shift();
    if (toks[0] === "timeout") { toks.shift(); while (toks.length && /^(-|\d)/.test(toks[0])) toks.shift(); }
    if (!toks.length) continue;
    const name = toks[0].toLowerCase();
    const args = toks.slice(1);
    const positional = args.filter((a) => !a.startsWith("-"));
    const psParam = (names) => {
      for (let i = 0; i < args.length - 1; i++) if (names.includes(args[i].toLowerCase())) return args[i + 1];
      return null;
    };

    switch (name) {
      case "tee": targets.push(...positional); break;
      case "touch": case "truncate": case "mkdir": case "rm": case "rmdir": case "unlink": case "shred":
        targets.push(...positional); break;
      case "cp": case "mv": case "install": case "ln": case "rsync":
        if (positional.length >= 2) targets.push(positional[positional.length - 1]);
        if (name === "mv" && positional.length >= 2) targets.push(...positional.slice(0, -1)); // kaynak da silinir
        break;
      case "sed": case "perl":
        if (args.some((a) => /^-[a-z]*i/i.test(a) || a.startsWith("--in-place"))) targets.push(...positional.slice(1));
        break;
      case "dd": { const of = args.find((a) => a.startsWith("of=")); if (of) targets.push(of.slice(3)); break; }
      case "set-content": case "add-content": case "out-file": case "new-item": case "clear-content": case "remove-item": case "ni": case "sc": case "ac": {
        const p = psParam(["-path", "-filepath", "-literalpath"]) || positional[0];
        if (p) targets.push(p);
        break;
      }
      case "copy-item": case "move-item": case "cpi": case "mi": case "copy": case "move": {
        const d = psParam(["-destination"]) || positional[positional.length - 1];
        if (d) targets.push(d);
        break;
      }
      default: break;
    }
    for (const t of targets) out.push({ t, cds });
  }
  return out;
}

function checkBashWrites(cmd, ctx, cwd) {
  for (const { t: raw, cds } of collectWriteTargets(cmd)) {
    const t = expandVars(raw, ctx.projectDir);
    if (/[$`]/.test(t)) continue; // çözülemeyen değişken / komut ikamesi
    const abs = path.isAbsolute(normalizeInputPath(t)) || /^[a-zA-Z]:/.test(t);
    if (cds === null && !abs) block("Komuttaki dizin değişikliği (cd) çözülemediği için göreli yazma hedefi doğrulanamıyor; mutlak yol kullan veya cd'yi kaldır: " + raw);
    const base = (cds || []).reduce((b, d) => path.resolve(b, normalizeInputPath(expandVars(d, ctx.projectDir))), cwd || ctx.projectDir);
    // Alt kabukta ((cd x); ...) cd sonraki adımlara geçmez; ayırt edilemediği için iki taban da denetlenir
    if (cds && cds.length) checkWrite(t.replace(/[*?]/g, "1"), ctx, cwd);
    checkWrite(t.replace(/[*?]/g, "1"), ctx, base); // joker: temsili bir dosya adıyla kontrol et
  }
}

// ---------------------------------------------------------------- Ana akış
function main(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (_) {
    // Çağıranı bilemiyoruz; ham girdide agent izi varsa fail-closed
    if (/"agent_(id|type)"/.test(raw)) block("Araç çağrısı okunamadı (geçersiz JSON); güvenlik için engellendi.");
    return;
  }

  const first = cfgLib.identifyCaller(input);
  if (first.kind === "main") return;
  if (first.kind === "unknown-agent") {
    ROLE = "bilinmeyen";
    block("Çağıran agent'ın türü belirlenemedi (agent_id var, agent_type yok); güvenlik için engellendi. Bu bir altyapı sorunudur, kullanıcıya bildir.");
  }

  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const projectDir = cfgLib.projectRoot(input);
  const cwd = input.cwd || projectDir;

  const { config, error, file } = cfgLib.loadConfig(projectDir);
  if (error && !first.role) {
    // team.json bozuk: özel roller tanınamaz. Agent adı dosyada geçiyorsa özel rol say, fail-closed engelle.
    let raw = "";
    try { raw = require("fs").readFileSync(file, "utf8"); } catch (_) {}
    if (!raw.includes(cfgLib.agentBaseName(first.agentType))) return; // takım dışı agent
    ROLE = cfgLib.agentBaseName(first.agentType);
    block(error + " — düzeltilene kadar takım rollerinin yazma/komut çağrıları engellenir.");
  }
  const role = first.role || cfgLib.roleFor(first.agentType, config);
  if (!role) return; // takım dışı agent (Explore, precommit ajanları …)
  ROLE = role;

  if (tool === "Agent") {
    block("Takım üyeleri alt agent başlatamaz (yetki sınırlarını aşar). İşi kendin yap veya lead'e ilet; yeni üye gerekiyorsa lead [SPAWN-REQUEST] gönderir.");
  }
  if (error) block(error + " — düzeltilene kadar takım rollerinin yazma/komut çağrıları engellenir.");
  const ctx = { projectDir, config };

  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(ti.command || "");
    for (const [re, why] of [...BASH_RULES, ...(ROLE_BASH_RULES[ROLE] || [])]) {
      if (re.test(cmd)) block(why + "  Komut: " + cmd.slice(0, 200));
    }
    checkBashWrites(cmd, ctx, cwd);
    return;
  }
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const fp = ti.file_path || ti.notebook_path;
    if (fp) checkWrite(String(fp), ctx);
  }
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      main(raw);
    } catch (e) {
      // Kendi exit'lerimiz process.exit ile çıkar; buraya yalnızca beklenmeyen hatalar düşer
      if (/"agent_(id|type)"/.test(raw)) block("Guard beklenmeyen bir hata verdi, güvenlik için engellendi: " + (e && e.message));
    }
  });
}

module.exports = { bashWriteTargets, splitSegments };
