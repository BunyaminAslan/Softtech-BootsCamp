# AdditionalAgentInformation

Bu klasör **agent-team** framework'ünün bu projeye özel katmanıdır. Framework (plugin) generic'tir; bu projeye ait her şey burada durur ve proje reposuyla birlikte versiyonlanır.

| Dosya / klasör | Ne içerir | Kim yazar |
|---|---|---|
| `project.md` | Proje bağlamı: amaç, dil, yığın, ortam, komutlar, kısıtlar | Kullanıcı (lead önerir) |
| `rules.md` | Bu projeye özel ek takım kuralları (TEAM_RULES'u genişletir, gevşetemez) | Kullanıcı |
| `team.json` | Makine okunur yapılandırma: etkin roller, profiller, alan sahipliği, yollar, ek korumalı yollar. **Guard bunu uygular.** | Kullanıcı |
| `profiles/<ad>.md` | (İsteğe bağlı) Plugin'deki profillerin yerine/yanına projeye özel yığın profili | Kullanıcı |
| `agents/<rol>/instructions.md` | O role bu projede verilen ek talimatlar | Kullanıcı |
| `agents/<rol>/MEMORY.md` | Rolün kalıcı hafızası (oturum başında okunur, ≤200 satır) | Rol agent'ı |
| `agents/<rol>/WORKLOG.md` | Rolün oturum günlüğü | Rol agent'ı |

Roller: `lead` (tech-lead), `backend`, `mobile`, `web`, `tester`.

Guard kuralı: takım üyeleri bu klasörde **yalnızca kendi** `agents/<rol>/` klasörüne yazabilir (`instructions.md` hariç). Diğer her şey kullanıcıya aittir.

Projeye özel **skill**, **MCP sunucusu** ve **izinler** Claude Code'un standart yerlerine konur; framework onları otomatik kullanır:
- Skill'ler: `.claude/skills/<ad>/SKILL.md`
- MCP sunucuları: `.mcp.json`
- İzinler / ortam: `.claude/settings.json`

Ayrıntılar: plugin'deki `PLUGIN.md`.
