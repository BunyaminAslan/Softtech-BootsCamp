# CLAUDE.md: agent-team framework geliştirme

Kullanıcıyla Türkçe konuş.

Bu repo **agent-team framework'ünün kendisidir** (bir Claude Code plugin'i + marketplace). Burada bir ürün geliştirilmez; ürünler kendi repolarında geliştirilir ve plugin'i oradan kullanır.

## Değişmez kurallar

1. **Framework generic kalır.** `plugin/` altına belirli bir projeye, yığına, kişiye veya makineye ait bilgi yazılmaz. Yığına özgü bilgi `plugin/profiles/<rol>/<ad>.md` profillerine, projeye özgü her şey ürün reposunun `AdditionalAgentInformation/` klasörüne aittir. `tests/hooks/framework.test.js` bunu kısmen denetler.
2. **Plugin kendi kendine yeter.** Kurulumda yalnızca `plugin/` kopyalanır; `plugin/` içinden `../` ile dışarı başvurulmaz. Yollar `${CLAUDE_PLUGIN_ROOT}` ile verilir.
3. **Hiçbir agent varsayılan ana agent yapılmaz.** Hiçbir settings dosyasına `"agent"` anahtarı eklenmez; kullanıcı önce ana oturumla konuşur.
4. **Guard kuralları ile agent dosyalarındaki "Yetkiler" bölümleri birlikte değişir.** Guard (`plugin/hooks/agent-guard.js`) değişirse testleri (`tests/hooks/agent-guard.test.js`) güncellenir.
5. **Dış skill'ler incelenmeden eklenmez.** Kural: `plugin/skills/README.md` > "Yeni skill ekleme veya güncelleme kuralı".
6. Her davranış değişikliğinde `plugin/.claude-plugin/plugin.json` sürümü artırılır ve `CHANGELOG.md` güncellenir (sürüm artmazsa kullanıcılar güncellemeyi almaz).

## Klasörler

| Yol | İçerik |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace kataloğu (plugin kaynağı: `./plugin`) |
| `plugin/` | Kurulan plugin: `agents/`, `skills/`, `hooks/`, `scripts/`, `profiles/`, `templates/`, `TEAM_RULES.md`, `.mcp.json` |
| `tests/hooks/` | Framework testleri (plugin ile dağıtılmaz) |
| `.githooks/pre-commit` | Bu reponun kendi commit kontrolü: testler + `claude plugin validate` |
| `.github/workflows/agent-team.yml` | CI: aynı testler |
| `README.md`, `PLUGIN.md`, `CHANGELOG.md` | Dokümantasyon |

## Geliştirme döngüsü

```sh
node --test tests/hooks/*.test.js        # tüm testler
claude plugin validate ./plugin          # plugin manifest/bileşenler
claude plugin validate .                 # marketplace
claude --plugin-dir ./plugin             # plugin'i kurmadan bir ürün reposunda dene (o reponun kökünde çalıştır)
evals/run.sh smoke                       # ajan davranış testleri (WSL2/Linux/macOS, ücretli; evals/README.md)
```

Ajan prompt'u, `TEAM_RULES.md`, hook veya SessionStart bağlamı değiştiyse `evals/run.sh smoke`; sürüm öncesi `evals/run.sh full`.

Plugin'i bu repoda (framework reposunda) `setup-project` ile kurmaya çalışma; betik bunu reddeder.
