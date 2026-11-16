#!/usr/bin/env node
// onboard-scan.js — Var olan bir repoyu tarar; yığını, uygun profili, build/test/lint komutlarını,
// klasör sahipliğini ve mevcut dokümanları tespit eder; project.md ve team.json TASLAĞI üretir.
// Her bulgu "tespit" (dosyadan okundu) veya "tahmin" (çıkarım) olarak işaretlenir.
//
// Kullanım (ürün reposunun kökünde veya --project ile):
//   node "<plugin>/scripts/onboard-scan.js" [--project <dizin>] [--json] [--write]
//     (varsayılan)  Markdown rapor (stdout)
//     --json        Makine okunur sonuç
//     --write       Taslakları yazar: AdditionalAgentInformation/team.json ve project.md şablondan hiç
//                   değiştirilmemişse (veya yoksa) doğrudan, değiştirilmişse yanlarına .draft olarak.
//                   Kullanıcı içeriğinin üzerine asla yazmaz. Önce setup-project çalışmış olmalıdır.
// Exit: 0 tamam · 1 hata
// Hiçbir komutu ÇALIŞTIRMAZ; komutların doğrulanması /agent-team:onboard skill'inin işidir.

"use strict";
const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const cfgLib = require(path.join(PLUGIN_ROOT, "hooks", "lib", "team-config"));

const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const ROOT = path.resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || process.cwd());

const SKIP = new Set(["node_modules", ".git", "bin", "obj", "build", "dist", "out", ".next", ".expo", "Pods", ".dart_tool",
  "vendor", "venv", ".venv", "__pycache__", "target", ".gradle", ".idea", ".vscode", "coverage", cfgLib.LAYER_DIR, ".claude"]);
const MAX_DEPTH = 4;

// ---------------------------------------------------------------- dosya tarama
function walk(dir = ROOT, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith(".") && depth < MAX_DEPTH) walk(path.join(dir, e.name), depth + 1, out);
    } else out.push(path.join(dir, e.name));
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const dirOf = (file) => {
  const d = rel(path.dirname(file));
  return d === "" ? "" : d + "/";
};
// Büyük/küçük harf duyarlı varlık kontrolü (Windows/macOS dosya sistemleri "Docs/ADR" ile "docs/adr"yi eşler;
// taslağa gerçek yazım girmeli)
function existsExact(relPath) {
  let dir = ROOT;
  for (const seg of relPath.split("/").filter(Boolean)) {
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { return false; }
    if (!names.includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (_) { return ""; } };

// ---------------------------------------------------------------- dedektörler
// Her dedektör: { role, profile|null, stack, dir, commands: {install, build, test, lint}, evidence, confidence, notes[] }
function fromPackageJson(file) {
  const pkg = readJson(file);
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
  const dir = path.dirname(file);
  const pm = fs.existsSync(path.join(dir, "pnpm-lock.yaml")) ? "pnpm" : fs.existsSync(path.join(dir, "yarn.lock")) ? "yarn"
    : fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock")) ? "bun" : "npm";
  const install = { npm: fs.existsSync(path.join(dir, "package-lock.json")) ? "npm ci" : "npm install", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install" }[pm];
  const scripts = pkg.scripts || {};
  const run = (s) => (pm === "npm" ? (s === "test" ? "npm test" : `npm run ${s}`) : `${pm} ${s === "test" ? "test" : "run " + s}`);
  const pick = (...names) => names.find((n) => scripts[n]);
  const notes = [];
  const commands = { install };
  const b = pick("build"); if (b) commands.build = run(b);
  const t = pick("test", "test:unit", "test:ci"); if (t) commands.test = run(t);
  const l = pick("lint", "typecheck", "check"); if (l) commands.lint = run(l);
  if (t && /--watch\b|\bvitest\b(?!\s+run)|jest\s+--watch/.test(scripts[t]) && !/\bvitest\s+run\b|--watchAll=false|CI=/.test(scripts[t])) {
    notes.push(`'${t}' script'i watch modunda çalışabilir (${scripts[t]}); K2 için tek seferlik komut kullanın (ör. vitest run, jest --ci --watchAll=false)`);
  }
  for (const [n, s] of Object.entries(scripts)) if (/^(dev|start|serve|watch)$/.test(n)) notes.push(`'${n}' (${s}) bir sunucu/watch komutudur; kanıt komutu olarak kullanılmaz (K2/K5)`);

  let role = null, profile = null, stack = "Node.js", confidence = "tahmin";
  if (has("expo")) { role = "mobile"; profile = "react-native-expo"; stack = "React Native + Expo"; confidence = "tespit"; }
  else if (has("react-native")) { role = "mobile"; profile = "react-native-expo"; stack = "React Native (Expo'suz)"; notes.push("Expo'suz React Native: react-native-expo profili kısmen uyar; profili gözden geçirin"); }
  else if (has("next")) { role = "web"; profile = "nextjs"; stack = "Next.js"; confidence = "tespit"; }
  else if (has("@nestjs/core") || has("express") || has("fastify") || has("koa") || has("hono") || has("@hapi/hapi")) {
    role = "backend"; profile = "node"; stack = "Node.js (" + ["@nestjs/core", "express", "fastify", "koa", "hono", "@hapi/hapi"].find(has) + ")"; confidence = "tespit";
  } else if (has("vite") || has("react") || has("vue") || has("@angular/core") || has("svelte") || has("nuxt") || has("@remix-run/react") || has("astro")) {
    role = "web"; stack = ["nuxt", "@angular/core", "@remix-run/react", "astro", "svelte", "vue", "vite", "react"].find(has) || "web"; confidence = "tespit";
    notes.push(`${stack} için hazır profil yok; profile: null`);
  }
  if (!role) return null; // kütüphane, araç veya monorepo kökü
  return { role, profile, stack, dir: dirOf(file), commands, evidence: rel(file), confidence, notes, name: pkg.name || null };
}

function fromDotnet(file) {
  const text = readText(file);
  const isTest = /Microsoft\.NET\.Test\.Sdk|xunit|nunit|MSTest/i.test(text);
  if (isTest) return null; // test projesi: kendi backend'inin parçası
  const web = /Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(text);
  const maui = /<UseMaui>true<\/UseMaui>/i.test(text);
  if (maui) return { role: "mobile", profile: null, stack: ".NET MAUI", dir: dirOf(file), commands: { build: "dotnet build", test: "dotnet test" }, evidence: rel(file), confidence: "tespit", notes: [".NET MAUI için hazır profil yok"] };
  const dir = path.dirname(file);
  if (web && (fs.existsSync(path.join(dir, "Views")) || fs.existsSync(path.join(dir, "Pages")))) {
    return {
      role: "web", profile: "aspnet-mvc", stack: "ASP.NET Core MVC / Razor Pages", dir: dirOf(file),
      commands: { install: "dotnet restore", build: "dotnet build -warnaserror", test: "dotnet test", lint: "dotnet format --verify-no-changes" },
      evidence: rel(file), confidence: "tespit", notes: ["Views/ veya Pages/ klasörü var: sunucu tarafı render eden web uygulaması"],
    };
  }
  return {
    role: "backend", profile: "dotnet", stack: web ? "ASP.NET Core" : ".NET", dir: dirOf(file),
    commands: { install: "dotnet restore", build: "dotnet build -warnaserror", test: "dotnet test", lint: "dotnet format --verify-no-changes" },
    evidence: rel(file), confidence: web ? "tespit" : "tahmin", notes: web ? [] : ["Web SDK değil; backend olduğu tahmin edildi"],
  };
}

function fromPubspec(file) {
  const text = readText(file);
  if (!/^\s*flutter\s*:/m.test(text) && !/sdk:\s*flutter/.test(text)) return null; // saf Dart paketi
  return {
    role: "mobile", profile: "flutter", stack: "Flutter", dir: dirOf(file),
    commands: { install: "flutter pub get", build: "flutter build apk --debug", test: "flutter test", lint: "flutter analyze" },
    evidence: rel(file), confidence: "tespit", notes: [],
  };
}

function fromGradle(file, all) {
  const text = readText(file);
  if (!/com\.android\.application/.test(text)) return null;
  const appDir = path.dirname(file);
  // Flutter/RN'in android/ klasörü değilse yerel Android
  const parent = path.dirname(appDir.endsWith(path.sep + "app") ? path.dirname(appDir) : appDir);
  if (all.some((f) => path.basename(f) === "pubspec.yaml" && path.dirname(f) === parent) || all.some((f) => path.basename(f) === "package.json" && path.dirname(f) === parent)) return null;
  const root = path.basename(appDir) === "app" ? path.dirname(appDir) : appDir;
  return {
    role: "mobile", profile: "native", stack: "Android (Kotlin/Java, Gradle)", dir: dirOf(path.join(root, "x")),
    commands: { build: "./gradlew assembleDebug", test: "./gradlew test", lint: "./gradlew lint" },
    evidence: rel(file), confidence: "tespit", notes: [],
  };
}

function fromGo(file) {
  return { role: "backend", profile: null, stack: "Go", dir: dirOf(file), commands: { install: "go mod download", build: "go build ./...", test: "go test ./...", lint: "go vet ./..." }, evidence: rel(file), confidence: "tahmin", notes: ["Go için hazır profil yok; servis olduğu tahmin edildi"] };
}
function fromPython(file) {
  const text = readText(file);
  const fw = ["fastapi", "django", "flask"].find((f) => new RegExp(`\\b${f}\\b`, "i").test(text));
  if (!fw) return null;
  return {
    role: "backend", profile: "python", stack: `Python (${fw})`, dir: dirOf(file),
    commands: { test: "pytest", lint: /\bruff\b/.test(text) ? "ruff check ." : undefined },
    evidence: rel(file), confidence: "tespit", notes: [],
  };
}
function fromCargo(file) {
  return { role: "backend", profile: null, stack: "Rust", dir: dirOf(file), commands: { build: "cargo build", test: "cargo test", lint: "cargo clippy -- -D warnings" }, evidence: rel(file), confidence: "tahmin", notes: ["Rust için hazır profil yok"] };
}

// ---------------------------------------------------------------- birleştirme
// Kök dizindeki tek uygulama için sahiplik yolu: var olan kaynak klasörleri (kök sahiplenilemez)
const ROOT_SOURCE_DIRS = { web: ["app/", "src/", "pages/", "components/", "lib/", "public/", "styles/"], mobile: ["app/", "src/", "components/", "assets/", "lib/", "android/", "ios/"], backend: ["src/", "app/", "api/", "Controllers/", "Services/"] };

function scan() {
  const files = walk();
  const base = (f) => path.basename(f);
  const found = [];
  for (const f of files) {
    const b = base(f);
    let r = null;
    if (b === "package.json") r = fromPackageJson(f);
    else if (/\.csproj$/.test(b)) r = fromDotnet(f);
    else if (b === "pubspec.yaml") r = fromPubspec(f);
    else if (/^build\.gradle(\.kts)?$/.test(b)) r = fromGradle(f, files);
    else if (b === "go.mod") r = fromGo(f);
    else if (b === "pyproject.toml" || b === "requirements.txt") r = fromPython(f);
    else if (b === "Cargo.toml") r = fromCargo(f);
    if (r) found.push(r);
  }
  // Aynı dizinde birden çok manifest (ör. pyproject + requirements): ilkini tut
  const seen = new Set();
  const apps = found.filter((a) => { const k = a.role + "|" + a.dir; if (seen.has(k)) return false; seen.add(k); return true; });
  const iosOnly = files.some((f) => base(f) === "Package.swift" || /\.xcodeproj$/.test(path.dirname(f)));

  const roles = {};
  for (const a of apps) {
    const r = roles[a.role] || (roles[a.role] = { apps: [], paths: [], profile: null, notes: [] });
    r.apps.push(a);
    if (a.dir) r.paths.push(a.dir);
    else {
      const dirs = (ROOT_SOURCE_DIRS[a.role] || []).filter(existsExact);
      r.paths.push(...dirs);
      r.notes.push(`Uygulama repo kökünde (${a.evidence}); kök sahiplenilemediği için kaynak klasörleri sahiplik yolu yapıldı (tahmin): ${dirs.join(", ") || "yok"}`);
    }
    if (a.profile && !r.profile) r.profile = a.profile;
    else if (a.profile && r.profile !== a.profile) r.notes.push(`Birden çok yığın: ${r.profile} ve ${a.profile} (${a.evidence}); ilk profil seçildi`);
  }
  if (iosOnly && !roles.mobile) roles.mobile = { apps: [{ role: "mobile", profile: "native", stack: "iOS (Swift)", dir: "", commands: {}, evidence: "Package.swift / *.xcodeproj", confidence: "tahmin", notes: [] }], paths: [], profile: "native", notes: ["iOS projesi bulundu; xcodebuild komutlarını project.md'ye elle yazın"] };

  // Dokümanlar
  const existsAny = (...c) => c.find(existsExact);
  const openapi = files.filter((f) => /^(openapi|swagger)[^/]*\.(ya?ml|json)$/i.test(base(f)));
  const docs = {
    readme: existsAny("README.md", "readme.md", "README"),
    docsDir: existsAny("Docs/", "docs/", "doc/"),
    adrDir: existsAny("Docs/ADR/", "docs/adr/", "docs/ADR/", "doc/adr/", "docs/decisions/", "adr/"),
    contracts: openapi.map(rel),
    ci: existsAny(".github/workflows/", ".gitlab-ci.yml", "azure-pipelines.yml", "Jenkinsfile"),
    claudeMd: existsAny("CLAUDE.md", "AGENTS.md"),
  };
  const paths = {};
  if (openapi.length) paths.contract = { value: dirOf(openapi[0]) || "Docs/Contracts/", confidence: dirOf(openapi[0]) ? "tespit" : "tahmin", evidence: rel(openapi[0]) };
  if (docs.adrDir) paths.adr = { value: docs.adrDir, confidence: "tespit", evidence: docs.adrDir };

  // Proje adı: kök package.json (workspace kökü de olabilir) > kök pubspec.yaml > klasör adı
  const rootPkg = readJson(path.join(ROOT, "package.json"));
  const rootPubName = (/^name:\s*(\S+)/m.exec(readText(path.join(ROOT, "pubspec.yaml"))) || [])[1];
  const name = (rootPkg && typeof rootPkg.name === "string" && rootPkg.name) || rootPubName || path.basename(ROOT);
  return { root: ROOT, name, apps, roles, docs, paths, iosOnly };
}

// ---------------------------------------------------------------- taslaklar
function teamDraft(result) {
  const team = JSON.parse(JSON.stringify(cfgLib.DEFAULT_CONFIG));
  for (const role of ["backend", "mobile", "web"]) {
    const r = result.roles[role];
    if (!r) { team.roles[role].enabled = false; continue; }
    team.roles[role].enabled = true;
    team.roles[role].profile = r.profile;
    const extraDocs = (team.roles[role].paths || []).filter((p) => p.startsWith("Docs/"));
    if (r.paths.length) team.roles[role].paths = [...new Set([...r.paths, ...extraDocs])];
  }
  for (const [k, v] of Object.entries(result.paths)) team.paths[k] = v.value;
  return team;
}

function projectDraft(result, template) {
  const r = result.roles;
  const stackLine = (role, label) => {
    const x = r[role];
    if (!x) return `- **${label}:** yok (tespit edilmedi; rol team.json'da kapalı)`;
    return `- **${label}:** ${x.apps.map((a) => `${a.stack} \`${a.dir || "./"}\` (${a.confidence}: ${a.evidence})`).join("; ")}${x.profile ? `   (profil: ${x.profile})` : ""}`;
  };
  const cmd = (role, key) => {
    const x = r[role];
    if (!x) return "—";
    const vals = x.apps.map((a) => a.commands[key] ? (a.dir ? `\`cd ${a.dir.replace(/\/$/, "")} && ${a.commands[key]}\`` : `\`${a.commands[key]}\``) : null).filter(Boolean);
    return vals.length ? vals.join("<br>") + " (tahmin, doğrulanmadı)" : "<doldur>";
  };
  let md = template;
  md = md.replace("- **Proje adı:** <doldur>", `- **Proje adı:** ${result.name}`);
  md = md.replace(/- \*\*Backend:\*\* .*\n/, stackLine("backend", "Backend") + "\n");
  md = md.replace(/- \*\*Mobile:\*\* .*\n/, stackLine("mobile", "Mobile") + "\n");
  md = md.replace(/- \*\*Web:\*\* .*\n/, stackLine("web", "Web") + "\n");
  for (const role of ["backend", "mobile", "web"]) {
    md = md.replace(new RegExp(`\\| ${role} \\| <doldur> \\| <doldur> \\| <doldur> \\| <doldur> \\|`), `| ${role} | ${cmd(role, "install")} | ${cmd(role, "build")} | ${cmd(role, "test")} | ${cmd(role, "lint")} |`);
  }
  const notes = Object.entries(r).flatMap(([role, x]) => [...x.notes, ...x.apps.flatMap((a) => a.notes)].map((n) => `- ${role}: ${n}`));
  md += `\n## Onboard taraması (${new Date().toISOString().slice(0, 10)})\n<!-- /agent-team:onboard üretti. "tespit" = dosyadan okundu, "tahmin" = çıkarım. Komutlar doğrulanınca "(tahmin, doğrulanmadı)" notunu kaldırın. -->\n` +
    (notes.length ? notes.join("\n") + "\n" : "- Not yok\n") +
    `- Mevcut dokümanlar: README ${result.docs.readme || "yok"}, doküman klasörü ${result.docs.docsDir || "yok"}, ADR ${result.docs.adrDir || "yok"}, API sözleşmesi ${result.docs.contracts.join(", ") || "yok"}, CI ${result.docs.ci || "yok"}, ajan talimatı ${result.docs.claudeMd || "yok"}\n`;
  return md;
}

function report(result) {
  const lines = [`# Onboard taraması: ${result.name}`, "", `Kök: ${result.root}`, ""];
  if (!result.apps.length && !result.iosOnly) lines.push("Tanınan bir uygulama manifesti bulunamadı (package.json, *.csproj, pubspec.yaml, build.gradle, go.mod, pyproject.toml, Cargo.toml). Boş repo için `/agent-team:setup-project` yeterlidir.", "");
  lines.push("| Rol | Yığın | Dizin | Profil | Kaynak | Güven |", "|---|---|---|---|---|---|");
  for (const a of result.apps) lines.push(`| ${a.role} | ${a.stack} | \`${a.dir || "./"}\` | ${a.profile || "—"} | ${a.evidence} | ${a.confidence} |`);
  lines.push("", "## Komutlar (tahmin; doğrulanmadı)", "| Rol | Dizin | Kurulum | Build | Test | Lint |", "|---|---|---|---|---|---|");
  for (const a of result.apps) lines.push(`| ${a.role} | \`${a.dir || "./"}\` | ${a.commands.install || "—"} | ${a.commands.build || "—"} | ${a.commands.test || "—"} | ${a.commands.lint || "—"} |`);
  lines.push("", "## Sahiplik (team.json taslağı)");
  for (const role of ["backend", "mobile", "web"]) {
    const r = result.roles[role];
    lines.push(`- **${role}:** ${r ? `${r.paths.map((p) => "`" + p + "`").join(", ") || "(yol yok)"}${r.profile ? `, profil \`${r.profile}\`` : ""}` : "tespit edilmedi → enabled: false"}`);
  }
  for (const [k, v] of Object.entries(result.paths)) lines.push(`- **paths.${k}:** \`${v.value}\` (${v.confidence}: ${v.evidence})`);
  const notes = Object.entries(result.roles).flatMap(([role, x]) => [...x.notes, ...x.apps.flatMap((a) => a.notes)].map((n) => `- ${role}: ${n}`));
  if (notes.length) lines.push("", "## Notlar", ...notes);
  lines.push("", "## Mevcut dokümanlar", `- README: ${result.docs.readme || "yok"} · doküman klasörü: ${result.docs.docsDir || "yok"} · ADR: ${result.docs.adrDir || "yok"} · sözleşme: ${result.docs.contracts.join(", ") || "yok"} · CI: ${result.docs.ci || "yok"} · ajan talimatı: ${result.docs.claudeMd || "yok"}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- yazma (kullanıcı içeriğine dokunmadan)
function writeDrafts(result) {
  const layer = path.join(ROOT, cfgLib.LAYER_DIR);
  if (!fs.existsSync(layer)) throw new Error(`${cfgLib.LAYER_DIR}/ yok; önce setup-project çalıştırın`);
  const tplDir = path.join(PLUGIN_ROOT, "templates", "project", cfgLib.LAYER_DIR);
  const written = [];
  const put = (name, content, templateText) => {
    const file = path.join(layer, name);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const untouched = current === null || normalize(current) === normalize(templateText);
    const target = untouched ? file : file + ".draft";
    fs.writeFileSync(target, content);
    written.push(rel(target) + (untouched ? "" : " (mevcut dosya değiştirilmiş; taslak yanına yazıldı)"));
  };
  const normalize = (s) => s.replace(/\r\n/g, "\n").replace(/- \*\*Proje adı:\*\* .*/, "").trim();
  const tplTeam = fs.readFileSync(path.join(tplDir, "team.json"), "utf8");
  const tplProject = fs.readFileSync(path.join(tplDir, "project.md"), "utf8");
  const currentTeam = readJson(path.join(layer, "team.json"));
  const teamUntouched = !currentTeam || JSON.stringify(currentTeam) === JSON.stringify(JSON.parse(tplTeam));
  const team = JSON.stringify(teamDraft(result), null, 2) + "\n";
  fs.writeFileSync(path.join(layer, teamUntouched ? "team.json" : "team.json.draft"), team);
  written.push(`${cfgLib.LAYER_DIR}/${teamUntouched ? "team.json" : "team.json.draft (mevcut dosya değiştirilmiş; taslak yanına yazıldı)"}`);
  put("project.md", projectDraft(result, tplProject), tplProject);
  return written;
}

function main() {
  if (!fs.existsSync(ROOT)) { console.error(`Dizin yok: ${ROOT}`); process.exit(1); }
  const result = scan();
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ...result, teamDraft: teamDraft(result) }, null, 2) + "\n");
  } else process.stdout.write(report(result) + "\n");
  if (argv.includes("--write")) {
    try {
      const w = writeDrafts(result);
      process.stderr.write("\nYazıldı:\n" + w.map((x) => "  + " + x).join("\n") + "\n");
    } catch (e) {
      process.stderr.write("❌ " + e.message + "\n");
      process.exit(1);
    }
  }
}

if (require.main === module) main();
module.exports = { scan, teamDraft, projectDraft };
