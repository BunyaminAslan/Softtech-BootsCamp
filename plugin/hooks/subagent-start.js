#!/usr/bin/env node
// subagent-start.js — SubagentStart hook'u.
// 1) agent_id → agent_type eşlemesini kaydeder. PreToolUse girdisinde agent_type gelmediği
//    durumlarda (ör. bazı teammate çağrıları) guard rolü bu kayıttan bulur.
// 2) Özel roller (team.json > roles, MustToHave madde 9): ajana rolünü, yetkilerini ve framework
//    kurallarının mutlak yolunu additionalContext olarak verir. Projenin .claude/agents/ dosyalarında
//    ${CLAUDE_PLUGIN_ROOT} çözülmediği için özel rol TEAM_RULES.md'yi bu bağlamdan bulur.
// Hiçbir zaman engellemez; hata olursa sessizce çıkar.

"use strict";
const path = require("path");
const cfgLib = require("./lib/team-config");

const TEAM_RULES = path.resolve(__dirname, "..", "TEAM_RULES.md");
const KIND_TEXT = {
  developer: "geliştirici: aşağıdaki yolların sahibisin; başka geliştiricilerin yollarına, sözleşmeye (backend'in), plan ve test dokümanlarına yazamazsın",
  reviewer: "inceleyici: kod yazmazsın; yalnızca aşağıdaki yollara (rapor) ve kendi katman klasörüne yazarsın",
  docs: "dokümantasyon: yalnızca aşağıdaki doküman yollarına ve kendi katman klasörüne yazarsın",
  allowlist: "izin listeli: yalnızca aşağıdaki yollara ve kendi katman klasörüne yazarsın",
};

function customRoleContext(projectDir, agentType) {
  const { config, error } = cfgLib.loadConfig(projectDir);
  if (error) return null; // guard zaten engelleyecek; bağlam üretme
  const role = cfgLib.roleFor(agentType, config);
  const rc = role && config.roles[role];
  if (!rc || !rc.custom) return null;
  const layer = cfgLib.LAYER_DIR;
  const tag = role.toUpperCase();
  return [
    `# agent-team: sen \`${role}\` rolüsün (özel rol, ${rc.kind})`,
    rc.description ? `Görev tanımı: ${rc.description}` : null,
    `- Yetki: ${KIND_TEXT[rc.kind]}. Yollar: ${rc.paths.length ? rc.paths.map((p) => "`" + p + "`").join(", ") : "(yok)"}. Guard bunu uygular.`,
    `- Framework kuralları (her zaman geçerli, önce oku): \`${TEAM_RULES}\``,
    `- Proje katmanı: \`${layer}/project.md\`, \`${layer}/rules.md\`, \`${layer}/team.json\`, \`${layer}/agents/${role}/instructions.md\`. Hafıza ve worklog: \`${layer}/agents/${role}/MEMORY.md\`, \`WORKLOG.md\` (yalnızca bu klasöre yazabilirsin, instructions.md hariç).`,
    rc.kind === "developer"
      ? `- Görev etiketin: \`[${tag}] S<n>-<m>\`. Kapanışta K1 satırları ve \`Kanıt: L-…\` gerekir (TEAM_RULES K1).`
      : "- Kanıt kuralı (K1) bir kontrolün geçtiğini söylediğin her raporda geçerlidir.",
    "- Alt agent başlatamazsın; commit, push ve deploy kullanıcınındır. Engellenirsen işi başka yoldan yapmaya çalışma, lead'e `[BLOCKED]` gönder.",
  ].filter(Boolean).join("\n");
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw);
      registerAgent(input);
      const ctx = input.agent_type && customRoleContext(cfgLib.projectRoot(input), input.agent_type);
      if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: ctx } }));
    } catch (_) {}
  });
}
function registerAgent(input) {
  try {
    cfgLib.registerAgent(input.agent_id, input.agent_type);
  } catch (_) {}
}

module.exports = { customRoleContext };
