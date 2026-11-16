# Framework skill'leri

Bu klasördeki skill'ler agent-team plugin'inin parçasıdır ve **her projede** kullanılabilir; bu yüzden yalnızca yığından bağımsız (generic) skill'ler buradadır. Yığına özgü skill'ler (ör. Expo, React Native) framework'e değil, kullanan projenin `.claude/skills/` klasörüne kurulur; ilgili profil dosyası (`../profiles/`) hangilerinin önerildiğini, kaynağını ve incelenen commit'i söyler.

Plugin skill'leri `agent-team:<ad>` adıyla görünür (ör. `agent-team:team`).

**Öncelik sırası:** `TEAM_RULES.md` ve agent dosyaları > yığın profili > proje kuralları (`rules.md`) ve tasarım ADR'si (K4) > skill talimatları. Bir skill commit atmayı, worktree açmayı, sunucuyu ön planda çalıştırmayı, hook kurmayı veya korumalı yollara (`.claude/`, `AdditionalAgentInformation/` …) yazmayı söylerse **uygulanmaz**.

## Framework'ün kendi skill'leri

| Skill | Kim kullanır | Ne yapar |
|---|---|---|
| `team` | ana oturum | Ön kontrol, lead'i başlatma, `[SPAWN-REQUEST]` eşlemesi, mesaj yönlendirme |
| `setup-project` | ana oturum (kullanıcı çağırır) | Ürün reposuna `AdditionalAgentInformation/`, doküman şablonları ve isteğe bağlı pre-commit kontrolünü kurar |
| `resume` | ana oturum | Kesintiden sonra devam özeti çıkarır (`scripts/resume-status.js`), kullanıcıya gösterir ve lead'i devam modunda başlatır |
| `onboard` | ana oturum (kullanıcı çağırır) | Var olan repoyu tarar (`scripts/onboard-scan.js`); yığın, profil, komut ve sahiplik taslağını tespit/tahmin işaretleriyle onaya sunar, komutları bir kez doğrular |

## Dış kaynaklı skill'ler: agent eşleşmesi

| Skill | lead | backend | mobile | web | tester | pre-commit-reviewer |
|---|---|---|---|---|---|---|
| verification-before-completion | ✓ | ✓ | ✓ | ✓ | ✓ | |
| test-driven-development | | ✓ | ✓ | ✓ | | |
| systematic-debugging | | ✓ | ✓ | ✓ | ✓ | |
| owasp-security | | ✓ | | ✓ | | ✓ |
| differential-review | | ✓ | | | | ✓ |
| supply-chain-risk-auditor | | ✓ | | | | |
| frontend-design | | | ✓ | ✓ | | |
| ui-ux-pro-max | | | ✓ | ✓ | | |
| impeccable | | | ✓ | ✓ | ✓ (`audit`, `critique`) | |
| animate, review-animations, animation-performance | | | | ✓ | | |
| webapp-testing | | | | | ✓ | |

Tasarım skill'lerinde tek bir yön seçilir (K4 ADR'si). Varsayılan: yön ve token'lar için **frontend-design + ADR**, palet/tipografi araştırması için **ui-ux-pro-max**, kalite kontrolü için **impeccable** (`critique`, `audit`, `polish`). Önerileri çakışırsa ADR kazanır.

## Kaynaklar

| Skill | Kaynak | Commit | Lisans | Yerel değişiklik |
|---|---|---|---|---|
| verification-before-completion, test-driven-development, systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | `22f0b46` | MIT | — |
| differential-review, supply-chain-risk-auditor | [trailofbits/skills](https://github.com/trailofbits/skills) | `149d7b2` | CC BY-SA 4.0 | — |
| owasp-security | [agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) | `1ae29cb` | MIT | — |
| frontend-design, webapp-testing | [anthropics/skills](https://github.com/anthropics/skills) | `1780c5e` | skill içindeki LICENSE.txt | — |
| ui-ux-pro-max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `efd9822` | MIT | `scripts/tests/` çıkarıldı |
| impeccable | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `2b86d9c` (v4.9.1) | Apache 2.0 | Motor başlatıcısı çıkarıldı (aşağıda) |
| animate, review-animations, animation-performance | [emilkowalski/skills](https://github.com/emilkowalski/skills) | `64eb3de` | MIT | — |

Her skill klasöründe kaynağın lisans dosyası bulunur. CC BY-SA 4.0 lisanslı trailofbits skill'leri değiştirilmeden dağıtılır; değiştirilirse aynı lisansla ve atıfla paylaşılmalıdır.

## İnceleme notları

- **impeccable:** `scripts/impeccable` başlatıcısı ilk çalıştırmada GitHub Releases'tan native bir binary indirip çalıştırıyor; binary incelenemediği için başlatıcı (`impeccable`, `impeccable.cmd`, `engine-checksums.txt`) ve yalnızca motorun kullandığı `live-browser*.js`, `modern-screenshot.umd.js` dosyaları **kopyalanmadı**. Skill, SKILL.md'deki "Launcher unavailable" yolunu izleyerek çalışır. `impeccable hooks on` ayrıca `.claude/settings.local.json`'a hook yazar; agent-guard bu komutları takım rolleri için engeller.
- **supply-chain-risk-auditor:** Python script'leri yalnızca herkese açık kayıtlara salt okunur istek atar (npm registry, PyPI, OSV, deps.dev, OpenSSF Scorecard, GitHub API). `gh` kuruluysa `gh auth token` ile GitHub limitini artırır. `python3` gerekir.
- **ui-ux-pro-max:** Script'ler yerel CSV verisinde arama yapar; ağ çağrısı yok (önizleme HTML'i Google Fonts bağlantısı içerir). `python3` gerekir.
- **webapp-testing:** `scripts/with_server.py` sunucuyu başlatıp test sonunda kapatır (K2 ile uyumlu). Python Playwright gerektirir; kurulu değilse Playwright MCP kullanılır.
- **differential-review:** Alt agent çağırma önerisi içerir; takım üyeleri alt agent başlatamaz, tek bağlamda devam edilir.

## Kurulmayanlar ve nedenleri

| Skill | Neden |
|---|---|
| superpowers: brainstorming, writing-plans, executing-plans | tech-lead'in kendi planlama sürecinin (SPRINT_PLAN, görev kartları, dalgalar) yerine geçen bir metodoloji: planlara kod ve her adımda `git commit` yazdırıyor, `docs/superpowers/` açıyor, kullanıcıyla doğrudan diyalog varsayıyor. |
| trailofbits static-analysis (semgrep, codeql) | Araç kurulumu gerektirir; sistem kurulumu agent'lara yasak. Projede kuruluysa projenin `.claude/skills/` klasörüne eklenebilir. |
| taste-skill | 1.800+ dosyalık asset kiti; incelenemedi. Landing sayfaları için proje bazında değerlendirilebilir. |
| expo/skills, react-native-best-practices | Yığına özgü; `profiles/mobile/react-native-expo.md` proje bazında kurulumunu tarif eder. |
| animate-expo (emilkowalski) | expo/skills içindeki `expo-animation` ile aynı içerik. |

## Playwright MCP

Plugin'in `.mcp.json` dosyası `@playwright/mcp@0.0.84` sunucusunu (`--headless --isolated --browser chromium`) tanımlar. `--browser chromium`, Playwright'ın kendi Chromium'unu kullanır (`npx playwright install chromium`, sudo gerekmez); varsayılan Chrome kanalı sistem genelinde Google Chrome ister. Plugin MCP araçları `mcp__plugin_agent-team_playwright__<araç>` adıyla görünür. İlk kullanımda `npx` paketi indirir. lead yalnızca inceleme araçlarını kullanır (yazma/çalıştırma araçları `disallowedTools` ile kapalı); tester ve web'de yalnızca `browser_run_code_unsafe` kapalıdır.

## Yeni skill ekleme veya güncelleme kuralı

1. Yalnızca resmi/asıl depolardan; fork yok.
2. SKILL.md baştan sona okunur; script'ler ağ erişimi, komut çalıştırma, dosya yazma ve hook kurma açısından taranır.
3. TEAM_RULES ile çakışmalar (commit, worktree, ön planda sunucu, korumalı yollar) not edilir.
4. Yığına özgüyse framework'e değil profile önerisi olarak eklenir.
5. Bu dosyadaki tablolara kaynak, commit, lisans ve yerel değişiklik yazılır; `CHANGELOG.md` güncellenir.
