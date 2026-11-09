#!/usr/bin/env node
// agent-guard.js — Geliştirme agent'ları için PreToolUse yetki kontrolü.
// Kullanım (agent frontmatter'ında): node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-guard.js" <rol>
//   rol: backend | mobile | tester
//
// Claude Code araç çağrısını stdin'den JSON olarak gönderir. Yasaklı bir işlemse
// exit 2 + stderr mesajı ile çağrı engellenir; mesaj agent'a geri bildirim olarak gider.
// Bu dosya agent .md dosyalarındaki "Yetkiler" bölümünün teknik karşılığıdır;
// ikisi birlikte güncellenmelidir.

const path = require("path");
const os = require("os");

const ROLE = process.argv[2] || "unknown";
const AGENT_NAMES = {
  backend: "senior-backend-developer",
  mobile: "senior-mobile-developer",
  tester: "senior-tester",
};

function block(reason) {
  process.stderr.write("⛔ agent-guard (" + ROLE + "): " + reason + "\n");
  process.exit(2);
}

// ---------------------------------------------------------------- Bash kuralları
const BASH_RULES = [
  [/\bgit\s+(commit|push|reset|rebase|merge|cherry-pick|revert|clean|tag|filter-branch|filter-repo|update-ref|replace|am|apply)\b/i,
    "Depo geçmişini/durumunu değiştiren git komutları yasak; commit/branch kararları kullanıcıya ait."],
  [/\bgit\s+(checkout|switch|restore)\b/i, "Branch değiştirme ve dosya geri alma (checkout/switch/restore) kullanıcıya ait."],
  [/\bgit\s+stash\b/i, "git stash çalışma ağacını değiştirir; kullanıcıya bırak."],
  [/\bgit\s+branch\s+-[dDmMcC]\b/i, "Branch silme/yeniden adlandırma yasak."],
  [/\bgit\s+config\b(?!\s+(--get|-l|--list|user\.name\s*$|user\.email\s*$))/i, "git config değiştirmek yasak (yalnızca okuma serbest)."],
  [/--no-verify\b/i, "Hook'ları atlamak (--no-verify) yasak."],
  [/\brm\s+(-\w+\s+)*-\w*r\w*\s+(.*\s)?(\/|~|\.\.|\*|\.git|\.claude|\.githooks|Docs)(\/|\s|$)/i,
    "Kök, üst dizin, joker veya korumalı klasörlerde özyinelemeli silme yasak."],
  [/\bRemove-Item\b.*-Recurse/i, "Özyinelemeli silme (Remove-Item -Recurse) yasak; build çıktıları için dotnet clean / flutter clean kullan."],
  [/(curl|wget|iwr|Invoke-WebRequest)[^|]*\|\s*(sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b/i,
    "İnternetten indirilen script'i doğrudan çalıştırmak yasak."],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bdotnet\s+nuget\s+push\b|\b(flutter|dart)\s+pub\s+publish\b|\bpod\s+trunk\s+push\b/i,
    "Paket yayınlamak yasak."],
  [/\bdocker\s+(push|login)\b|\bkubectl\s+(apply|delete|edit|patch|scale|rollout)\b|\bhelm\s+(install|upgrade|uninstall)\b|\bterraform\s+(apply|destroy|import)\b/i,
    "Uzak ortamlara (registry, cluster, cloud) değişiklik göndermek yasak."],
  [/\baz\s+\S+\s+(create|delete|update)\b|\baws\s+\S+\s+(create|delete|put|update|terminate)/i,
    "Cloud kaynaklarını değiştirmek yasak."],
  [/\bfastlane\b|\beas\s+(submit|build)\b|\baltool\b/i,
    "Store'a yükleme / uzak build tetikleme yasak; kullanıcı onayıyla kendisi yapar."],
  [/\bdotnet\s+ef\s+database\s+drop\b|\bDROP\s+(DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b/i,
    "Veritabanı silme/boşaltma yasak; gerekiyorsa kullanıcıdan iste."],
  [/\b(shutdown|Stop-Computer|Restart-Computer|diskpart|Set-ExecutionPolicy|setx)\b|\breg\s+(add|delete)\b/i,
    "Sistem ayarlarını değiştiren komutlar yasak."],
  [/\b(npm|pnpm|yarn)\s+(i|install|add)\s+(-g|--global)\b|\bdotnet\s+tool\s+install\s+(-g|--global)\b|\b(winget|choco)\s+install\b/i,
    "Global araç kurulumu yasak; gereken aracı kullanıcıya önerin."],
  [/\b(cat|type|Get-Content|more|less|head|tail)\s+[^|;&]*(\.env(?![.\w]*(example|sample|template))\b|\.pem\b|\.pfx\b|\.p12\b|\.jks\b|\.keystore\b|id_rsa)/i,
    "Gizli bilgi içeren dosyaları ekrana dökmek yasak."],
];

// Rol bazlı ek Bash kısıtları
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

const PROTECTED = [
  [/^\.git\//, ".git klasörü"],
  [/^\.claude\//, ".claude yapılandırması (agent/hook/ayar dosyaları kullanıcıya ait)"],
  [/^\.githooks\//, "git hook'ları"],
  [/^\.precommit-cache\//, "pre-commit önbelleği"],
  [/^docs\/sprint_\d+\.md$/, "Sprint dokümanları (sprint-documenter'a ait)"],
  [/(^|\/)\.env(\.[\w-]+)?$/, ".env dosyaları (yalnızca .env.example / .env.sample / .env.template yazılabilir)"],
  [/\.(pem|key|pfx|p12|jks|keystore|mobileprovision|p8)$/, "sertifika/anahtar dosyaları"],
  [/(^|\/)(google-services\.json|googleservice-info\.plist)$/, "Firebase gizli yapılandırma dosyaları"],
  [/(^|[/])key[.]properties$/, "Android imzalama yapılandırması (key.properties)"],
  [/(^|\/)appsettings\.production\.json$/, "production yapılandırması"],
];

const TESTER_ALLOWED = [
  /(^|\/)(tests?|specs?|__tests__|[.]maestro|e2e|integration_test|androidtest|fixtures|test-?data|load-?tests?|perf-?tests?|qa)(\/|$)/,
  /(^|\/)[^/]*\.(unit|integration|e2e|api|functional|acceptance|contract)?tests?(\/|$)/,
  /[._-](test|tests|spec|e2e)\.\w+$/,
  /tests?\.(cs|kt|java|swift|dart|ts|js|py)$/,
  /^docs\/(test|agents\/senior-tester)\//,
];

function checkWrite(filePath, projectDir) {
  const abs = path.resolve(projectDir, filePath);
  const tmp = path.resolve(os.tmpdir());
  if (abs.toLowerCase().startsWith(tmp.toLowerCase() + path.sep)) return; // geçici dosyalar serbest

  const rel = toPosix(path.relative(projectDir, abs));
  if (rel.startsWith("../") || path.isAbsolute(rel)) block("Proje klasörü dışına yazmak yasak: " + abs);
  const lower = rel.toLowerCase();

  // Kendi kalıcı hafızası serbest
  const own = AGENT_NAMES[ROLE];
  if (own && lower.startsWith(".claude/agent-memory/" + own + "/")) return;

  const isEnvTemplate = /(^|\/)\.env\.(example|sample|template)$/.test(lower);
  for (const [re, what] of PROTECTED) {
    if (re.test(lower) && !isEnvTemplate) block("Korumalı dosyaya yazmak yasak (" + what + "): " + rel);
  }

  if (ROLE === "backend" && /^(src\/)?mobile\//.test(lower)) {
    block("Mobile kodu senior-mobile-developer'a ait. Değişiklik gerekiyorsa mobile'a mesaj at: " + rel);
  }
  if (ROLE === "mobile" && /^(src\/)?backend\//.test(lower)) {
    block("Backend kodu senior-backend-developer'a ait. İhtiyacını backend'e mesajla ilet: " + rel);
  }
  if (ROLE === "mobile" && /^docs\/contracts\//.test(lower)) {
    block("API sözleşmesinin sahibi backend; değişiklik önerini backend'e mesajla ilet: " + rel);
  }
  if (ROLE === "tester" && !TESTER_ALLOWED.some((re) => re.test(lower))) {
    block("Tester yalnızca test kodu ve Docs/Test/ altına yazabilir. Üretim kodundaki hatayı bug raporu olarak ilgili geliştiriciye ilet: " + rel);
  }
}

// ---------------------------------------------------------------- Ana akış
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (_) {
    return; // okunamayan girdi: engelleme
  }
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(ti.command || "");
    for (const [re, why] of [...BASH_RULES, ...(ROLE_BASH_RULES[ROLE] || [])]) {
      if (re.test(cmd)) block(why + "  Komut: " + cmd.slice(0, 200));
    }
    return;
  }
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const fp = ti.file_path || ti.notebook_path;
    if (fp) checkWrite(String(fp), projectDir);
  }
});
