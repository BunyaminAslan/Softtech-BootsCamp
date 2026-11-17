// plan.js — sprint planının makine okunur tek kaynağı (Docs/Project/plan.json): doğrulama ve Markdown üretimi.
// lead plan.json'u yazar; SPRINT_PLAN.md'nin üretilen bölümü buradan gelir; [PLAN-APPROVAL] öncesi check zorunludur.
"use strict";

const ROLE_TAGS = { CONTRACT: "backend", BACKEND: "backend", MOBILE: "mobile", WEB: "web", "TEST-PLAN": "tester", TEST: "tester", ARCH: "lead" };
const ESTIMATES = ["S", "M", "L"];
const MODEL_RE = /^(opus|sonnet|haiku|inherit|claude-[a-z0-9.-]+)$/;
// K5: bitmeyen (sunucu/watch/etkileşimli) komutlar bitti kriteri olamaz
const NON_TERMINATING = [
  /\bnext\s+dev\b/, /\bexpo\s+start\b/, /\bnpm\s+(run\s+)?(dev|start|serve|watch)\b/, /\b(yarn|pnpm)\s+(run\s+)?(dev|start|serve|watch)\b/,
  /--watch\b/, /\bdotnet\s+(watch|run)\b/, /\bflutter\s+run\b/, /\bvite(\s+dev)?\s*$/, /\buvicorn\b.*--reload/,
  /\b(react-native|npx\s+react-native)\s+start\b/, /\bng\s+serve\b/, /\bvitest\b(?!\s+run)(?![\w-])/,
];
// Ölçülemeyen ifade: tek başına bunlar varsa kriter belirsizdir
const VAGUE = /^(çalışır|çalışıyor|tamam|bitti|yapıldı|güzel|iyi|düzgün|ok|hazır)\.?$/i;

function nonTerminating(text) {
  const cmds = [...String(text).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return cmds.filter((c) => NON_TERMINATING.some((re) => re.test(c)) && !/\btimeout\s+\d+/.test(c));
}

/**
 * @param {object} plan plan.json içeriği
 * @param {{roles?: object}} [config] team-config (etkin roller)
 * @returns {{errors: string[], warnings: string[], waves: Object<string, number>}}
 */
function checkPlan(plan, config) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { errors: ["plan bir JSON nesnesi değil"], warnings, waves: {} };
  if (!String(plan.goal || "").trim()) E("goal (ana hedef) boş");
  const scope = Array.isArray(plan.scope) ? plan.scope : (E("scope bir dizi değil"), []);
  const stories = Array.isArray(plan.stories) ? plan.stories : [];
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : (E("tasks bir dizi değil"), []);
  if (!tasks.length) E("görev yok");

  const scopeIds = new Set(), storyIds = new Set(), ids = new Map();
  for (const s of scope) { if (!s || !s.id) { E("kimliksiz kapsam maddesi"); continue; } if (scopeIds.has(s.id)) E(`kapsam ${s.id} tekrar ediyor`); scopeIds.add(s.id); }
  for (const s of stories) {
    if (!s || !s.id) { E("kimliksiz story"); continue; }
    if (storyIds.has(s.id)) E(`story ${s.id} tekrar ediyor`);
    storyIds.add(s.id);
    const sc = Array.isArray(s.scope) ? s.scope : [];
    if (!sc.length) E(`story ${s.id}: kapsam maddesine bağlı değil (ana hedefe izlenemiyor)`);
    for (const g of sc) if (!scopeIds.has(g)) E(`story ${s.id}: bilinmeyen kapsam ${g}`);
  }

  const roles = (config && config.roles) || null;
  for (const t of tasks) {
    if (!t || !t.id) { E("kimliksiz görev"); continue; }
    if (ids.has(t.id)) E(`görev ${t.id} tekrar ediyor`);
    ids.set(t.id, t);
  }
  for (const t of ids.values()) {
    const id = t.id;
    if (!String(t.title || "").trim()) E(`${id}: başlık yok`);
    if (!t.owner) E(`${id}: sahipsiz görev`);
    else if (roles) {
      if (!roles[t.owner] && t.owner !== "lead") E(`${id}: bilinmeyen rol '${t.owner}'`);
      else if (roles[t.owner] && !roles[t.owner].enabled) E(`${id}: kapalı role atanmış (${t.owner}, team.json enabled: false)`);
    }
    if (t.tag && ROLE_TAGS[t.tag] && t.owner && roles && !(roles[t.owner] && roles[t.owner].custom) && ROLE_TAGS[t.tag] !== t.owner) W(`${id}: [${t.tag}] etiketi genelde ${ROLE_TAGS[t.tag]} rolünündür, sahip ${t.owner}`);
    if (!t.story) E(`${id}: story yok (ana hedefe izlenemiyor)`);
    else if (!storyIds.has(t.story)) E(`${id}: bilinmeyen story ${t.story}`);
    const done = Array.isArray(t.done) ? t.done.filter((d) => String(d).trim()) : [];
    if (!done.length) E(`${id}: bitti kriteri yok`);
    for (const d of done) {
      if (VAGUE.test(String(d).trim())) E(`${id}: ölçülemeyen bitti kriteri: "${d}"`);
      for (const c of nonTerminating(d)) E(`${id}: bitti kriterinde bitmeyen komut (K5): \`${c}\``);
    }
    if (t.estimate && !ESTIMATES.includes(t.estimate)) E(`${id}: tahmin S/M/L olmalı (${t.estimate})`);
    // Görev başına model (token): mekanik iş küçük modele; kritik iş küçük modele verilmez
    if (t.model !== undefined && !MODEL_RE.test(String(t.model))) E(`${id}: model opus, sonnet, haiku, inherit veya claude-… olmalı (${t.model})`);
    if (t.critical && /haiku/.test(String(t.model || ""))) W(`${id}: kritik görev haiku'ya verilmiş; mimari/güvenlik işi küçük modele verilmez`);
    if (t.estimate === "L") W(`${id}: L tahminli görev; bölünebilir mi?`);
    for (const k of ["dependsOn", "softDependsOn"]) {
      for (const d of t[k] || []) {
        if (!ids.has(d)) E(`${id}: ${k} içinde bilinmeyen görev ${d}`);
        if (d === id) E(`${id}: kendine bağımlı`);
      }
    }
  }

  // Döngü (hard bağımlılıklar)
  const state = new Map(), cycles = [];
  const visit = (id, stack) => {
    state.set(id, 1); stack.push(id);
    for (const d of (ids.get(id).dependsOn || [])) {
      if (!ids.has(d) || d === id) continue;
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].join(" → "));
      else if (!state.get(d)) visit(d, stack);
    }
    stack.pop(); state.set(id, 2);
  };
  for (const id of ids.keys()) if (!state.get(id)) visit(id, []);
  for (const c of cycles) E(`döngüsel bağımlılık: ${c}`);

  // Dalgalar: hesaplanan en erken dalga; yazılan dalga bundan küçükse hata
  const waves = {};
  if (!cycles.length) {
    const calc = (id) => {
      if (waves[id]) return waves[id];
      const deps = (ids.get(id).dependsOn || []).filter((d) => ids.has(d) && d !== id);
      return (waves[id] = deps.length ? 1 + Math.max(...deps.map(calc)) : 1);
    };
    for (const id of ids.keys()) calc(id);
    for (const t of ids.values()) {
      if (t.wave == null) continue;
      if (!Number.isInteger(t.wave) || t.wave < 1) E(`${t.id}: wave pozitif tamsayı olmalı`);
      else if (t.wave < waves[t.id]) E(`${t.id}: W${t.wave} yazılmış ama hard bağımlılıkları en erken W${waves[t.id]}'de bitiyor`);
      else waves[t.id] = t.wave;
    }
  }

  // Kapsam matrisi: karşılıksız madde
  const coveredStories = new Set([...ids.values()].map((t) => t.story));
  for (const g of scopeIds) {
    const st = stories.filter((s) => (s.scope || []).includes(g));
    if (!st.length) E(`kapsam ${g}: hiçbir story'ye bağlı değil`);
    else if (!st.some((s) => coveredStories.has(s.id))) E(`kapsam ${g}: hiçbir göreve karşılık gelmiyor`);
  }
  for (const s of stories) if (!coveredStories.has(s.id)) W(`story ${s.id}: görevi yok`);
  return { errors, warnings, waves };
}

const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** SPRINT_PLAN.md'nin üretilen bölümü (işaretler arasına yazılır). */
function renderPlan(plan, waves = checkPlan(plan).waves) {
  const tasks = plan.tasks || [], stories = plan.stories || [], scope = plan.scope || [];
  const opens = opensOf(tasks);
  const L = [];
  L.push(`## Ana hedef`, "", String(plan.goal || ""), "");
  L.push(`## Kapsam matrisi (ana hedef maddeleri → story → görev)`, "", "| Madde | Story | Görevler |", "|---|---|---|");
  for (const g of scope) {
    const st = stories.filter((s) => (s.scope || []).includes(g.id));
    const tk = tasks.filter((t) => st.some((s) => s.id === t.story)).map((t) => t.id);
    L.push(`| ${g.id} ${esc(g.text)} | ${st.map((s) => s.id).join(", ") || "—"} | ${tk.join(", ") || "⚠️ yok"} |`);
  }
  L.push("", "## Bağımlılık grafiği", "", "```mermaid", "flowchart LR");
  const node = (id) => id.replace(/[^\w]/g, "_");
  for (const t of tasks) L.push(`  ${node(t.id)}["${t.id} [${t.tag || t.owner}] ${String(t.title || "").replace(/"/g, "'")}"]`);
  for (const t of tasks) {
    for (const d of t.dependsOn || []) L.push(`  ${node(d)} --> ${node(t.id)}`);
    for (const d of t.softDependsOn || []) L.push(`  ${node(d)} -.-> ${node(t.id)}`);
  }
  L.push("```", "");
  const owners = [...new Set(tasks.map((t) => t.owner).filter(Boolean))];
  const maxW = Math.max(0, ...Object.values(waves));
  L.push("## Dalgalar", "", `| Dalga | ${owners.join(" | ")} |`, `|---|${owners.map(() => "---").join("|")}|`);
  for (let w = 1; w <= maxW; w++) {
    const cells = owners.map((o) => tasks.filter((t) => t.owner === o && waves[t.id] === w).map((t) => `${t.id} [${t.tag || o}] ${esc(t.title)}${t.critical ? " ⚠️" : ""}`).join(", ") || "—");
    L.push(`| W${w} | ${cells.join(" | ")} |`);
  }
  L.push("", "## Görev kartları", "");
  for (const t of tasks) L.push(...renderCard(t, stories, opens, waves));
  return L.join("\n");
}

function opensOf(tasks) {
  const opens = {};
  for (const t of tasks) for (const d of [...(t.dependsOn || []), ...(t.softDependsOn || [])]) (opens[d] = opens[d] || []).push(t.id);
  return opens;
}

function renderCard(t, stories, opens, waves) {
  const L = [];
  const st = stories.find((s) => s.id === t.story);
  L.push(`### [${t.tag || String(t.owner || "").toUpperCase()}] ${t.id} ${t.title}${t.critical ? " ⚠️ kritik" : ""}`, "");
  L.push(`- Sahip: ${t.owner || "—"}`);
  L.push(`- Story: ${t.story || "—"}${st ? " " + st.title : ""}`);
  if (t.purpose) L.push(`- Amaç: ${t.purpose}`);
  if (t.input) L.push(`- Girdi: ${t.input}`);
  if (t.output) L.push(`- Çıktı: ${t.output}`);
  L.push(`- Bekler (hard): ${(t.dependsOn || []).join(", ") || "—"}`);
  L.push(`- Bekler (soft): ${(t.softDependsOn || []).join(", ") || "—"}`);
  L.push(`- Açar: ${(opens[t.id] || []).join(", ") || "—"}`);
  L.push(`- Bitti kriteri:`);
  for (const d of t.done || []) L.push(`  - ${d}`);
  if (t.estimate) L.push(`- Tahmin: ${t.estimate}`);
  if (t.model) L.push(`- Model: ${t.model}`);
  L.push(`- Dalga: W${waves[t.id] || t.wave || "?"}`);
  if (t.ui) L.push(`- UI: evet`);
  L.push("");
  return L;
}

/**
 * Bir rolün plan dilimi (token): üye planın tamamı yerine bunu okur. Ana hedef, rolün görev kartları
 * ve bu görevlerin bağlı olduğu / açtığı başka rollerin görevlerinin tek satırlık özeti.
 */
function slicePlan(plan, role, waves = checkPlan(plan).waves) {
  const tasks = plan.tasks || [], stories = plan.stories || [];
  const opens = opensOf(tasks);
  const mine = tasks.filter((t) => t.owner === role);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const related = new Set();
  for (const t of mine) {
    for (const d of [...(t.dependsOn || []), ...(t.softDependsOn || [])]) related.add(d);
    for (const o of opens[t.id] || []) related.add(o);
  }
  const L = [`# Plan dilimi: ${role} (sprint ${plan.sprint != null ? plan.sprint : "?"})`, "",
    "Üretildi: plan.js slice. Planın tamamı: SPRINT_PLAN.md (yalnızca gerekirse okuyun).", "",
    "## Ana hedef", "", String(plan.goal || ""), ""];
  L.push(`## Görevlerin (${mine.length})`, "");
  if (!mine.length) L.push("Bu sprintte bu role atanmış görev yok.", "");
  for (const t of [...mine].sort((a, b) => (waves[a.id] || 0) - (waves[b.id] || 0))) L.push(...renderCard(t, stories, opens, waves));
  const rel = [...related].map((id) => byId.get(id)).filter((t) => t && t.owner !== role);
  L.push("## Bağlı başka görevler", "");
  if (!rel.length) L.push("—");
  for (const t of rel) L.push(`- ${t.id} [${t.tag || t.owner}] ${esc(t.title)} · sahip ${t.owner} · W${waves[t.id] || t.wave || "?"}${t.output ? " · çıktı: " + esc(t.output) : ""}`);
  L.push("");
  return L.join("\n");
}

const BEGIN = "<!-- plan.json:begin (üretilir; elle düzenlemeyin: plan.json'u değiştirip plan.js render çalıştırın) -->";
const END = "<!-- plan.json:end -->";
/** Var olan SPRINT_PLAN.md metnine üretilen bölümü yerleştirir; işaretler dışındaki serbest metin korunur. */
function mergeIntoMarkdown(existing, rendered, sprint) {
  const block = `${BEGIN}\n${rendered}\n${END}`;
  const s = String(existing || "");
  const i = s.indexOf("<!-- plan.json:begin"), j = s.indexOf(END);
  if (i >= 0 && j > i) return s.slice(0, i) + block + s.slice(j + END.length);
  if (!s.trim()) return `# Sprint ${sprint || ""} planı\n\n${block}\n`;
  return `${s.replace(/\s*$/, "")}\n\n${block}\n`;
}

module.exports = { checkPlan, renderPlan, slicePlan, mergeIntoMarkdown, nonTerminating, BEGIN, END };
