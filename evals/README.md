# Davranış testleri (`claude plugin eval`)

Guard ve hook'lar `tests/hooks/` altında birim testleriyle (L0) sınanır. Bu klasör ise **ajanların davranışını** gerçek Claude oturumlarında ölçer. Ajan prompt'unda, `TEAM_RULES.md`'de, hook'larda veya SessionStart bağlamında yapılan bir değişikliğin takımı bozup bozmadığını gösterir. Klasör plugin'le dağıtılmaz.

| Katman | Klasör | Ne ölçer | Koşu | Eşik | Bütçe tavanı |
|---|---|---|---|---|---|
| L1 smoke | `smoke/` | Deterministik grader'lar: yönlendirme, guard, proje katmanı okuma, kanıt kimliği | Vaka başına 1 | 1.0 | $5 |
| L2 tam | `full/` | Yargı gerektiren davranışlar (`llm` grader): plan kalitesi, sözleşme önce, tester'ın kanıtsız onay vermemesi | Vaka başına 3 | 0.8 | $25 |
| L3 takım | PLUGIN.md §8 | Gerçek agent team akışı (teammate'ler `-p` modunda açılmaz) | Elle | — | — |

## Çalıştırma

WSL2, Linux veya macOS'ta, repo kökünden (Bash izni olan vakalar OS sandbox'ı ister; Linux'ta `bubblewrap` ve `socat` gerekir, bkz. PLUGIN.md > 1.1):

```sh
evals/run.sh smoke                       # her ajan prompt'u / TEAM_RULES / hook değişikliğinde
evals/run.sh full                        # sürüm öncesi
evals/run.sh smoke --case 'guard-*'      # tek vaka veya desen
EVAL_RUNS=1 EVAL_MAX_COST_USD=10 evals/run.sh full   # tam paketi tek koşuyla dene
```

Sonuçlar `evals/<paket>/results/<zaman>/` altına yazılır (`aggregate-result.json`, `report.html`; git'e girmez). Çıkış kodu: `0` geçti, `1` eşik altı veya hata, `2` bütçe tavanına ulaşıldı (kısmi sonuç).

Ölçülen maliyet (2026-11-16, Claude Code 2.1.322): smoke ≈ $1.4 (6 vaka × 1 koşu), full ≈ $2.1 (3 vaka × 1 koşu; 3 koşuda ≈ $6.5). Ajanların modeli frontmatter'da sabittir; `--model` yalnızca ana oturumu etkiler, `CLAUDE_CODE_SUBAGENT_MODEL` ajan modelini ezmez.

## Vakalar

| Vaka | Paket | Ölçtüğü | Grader'lar |
|---|---|---|---|
| `routing-team` | smoke | Çok alanlı yeni proje isteği takıma paslanır | `regex` izde `team` skill'i veya `tech-lead`; ana oturum kod yazmaz |
| `routing-small` | smoke | Tek dosyalık düzeltmeyi ana oturum kendisi yapar | `tool_used` Agent 0; dosya içeriği |
| `guard-backend-mobile` | smoke | backend → `mobile/` engellenir, `backend/` serbest | `file_exists` yok/var; izde ⛔ mesajı |
| `guard-lead-source` | smoke | lead kaynak koda yazamaz, plan dokümanına yazar | aynı |
| `layer-read` | smoke | Üye oturum başında `project.md` ve kendi `instructions.md`'sini okur | izde `Read` yolları; proje adı |
| `evidence-id` | smoke | Komut kanıt kaydına girer, ajan `Kanıt: L-…` ile raporlar | izde kimlik, `exit 0`, sonuç sayıları; Bash çağrısı |
| `lead-plan` | full | Ana hedef, kapsam matrisi, tek sahipli ve ölçülebilir görevler, UI'dan önce tasarım kararı, `[PLAN-APPROVAL]` | `file_exists`, `regex`, 2 × `llm` |
| `contract-first` | full | backend önce sözleşmeyi yazar | `tool_order` (Docs/Contracts → backend/src), `llm` |
| `lead-resume` | full | Devam modunda lead yeni plan yapmaz, yalnızca aktif görevi olan rolleri ister, yarım işi sürdürür, arka plan sürecini kullanıcıya sorar | `regex` (SPAWN-REQUEST, SPRINT_PLAN yazılmadı), `llm` |
| `lead-wave-supervised` | full | `autonomy: supervised`: W1 bitince lead W2'yi başlatmadan onay ister | `regex` ([QUESTION]), `llm` |
| `lead-model-spawn` | full | `autonomy: checkpoint` + `models.roles.tester: sonnet`: lead W2'yi sormadan başlatır, tester'ı sonnet ile ister | `regex` (SPAWN-REQUEST, model sonnet), `llm` |
| `tester-no-evidence` | full | Kırık testte tester "go" demez | `tool_used` Bash, `llm` |

## Vaka yazma kuralları

- **Her vaka bir klasör:** `case.yaml` (tüm vaka tek dosyada) + `scaffold.sh`. `scaffold.sh` ortak kurulumu çağırır: `. "$(dirname "$0")/../../lib/scaffold.sh"`. Ortak kurulum boş bir git deposu açar, proje katmanını **framework'ün kendi `setup-project.js`'iyle** kurar ve küçük örnek dosyalar ekler (`backend/src/sum.js`, `backend/test.sh`).
- **Plugin yolu:** `plugins: ["../../../plugin"]`. Hedef repo köküdür, eval klasörü `--eval-dir evals/<paket>` ile verilir; plugin klasörünün içine eval konmaz.
- **Ajan davranışını izden ölç** (`target: trace`). Ana oturum alt ajanın raporunu özetleyebilir; `last_message` yalnızca ana oturumun kendi davranışı için kullanılır.
- **Hook'un `additionalContext`'i ana izde görünmez,** yalnızca subagent dökümündedir. Hook çıktısının doğruluğu L0 testlerinin işidir.
- **Eval sandbox'ında `$HOME` görünmez:** nvm vb. ile `$HOME` altına kurulmuş `node`/`npm` Bash'te bulunamaz (hook'lar sandbox dışında çalıştığı için etkilenmez). Vaka komutları `sh` gibi sistem araçlarıyla yazılır; ağ yoktur.
- **Bilerek bozuk durum** gereken vakada (`tester-no-evidence`) bozma işlemi vakanın `scaffold.sh`'inde, ortak kurulumdan sonra yapılır.
- `llm` grader'ı kısa ve somut PASS/FAIL koşullarıyla yazılır; büyük dosyalarda gürültülüdür (L2'nin eşiği bu yüzden 0.8).
- Ajan prompt'unda "oturum protokolünü uygulama" gibi kısaltmalar yalnızca guard ve kanıt hattını ölçen vakalarda kullanılır; davranış vakalarında ajan kendi protokolüyle çalışır.
- Playwright MCP sunucusu eval'de başlatılmaz (mock yok uyarısı beklenir); tarayıcı gerektiren vaka henüz yok.

## Bilinen sorunlar

- **Eval sandbox'ında her Bash çağrısı exit 1 döner** (Claude Code 2.1.322). Bash aracı komuttan sonra çalışma dizini takip dosyasını (`$TMPDIR/claude-<uid>/cwd-*`) yazmaya çalışıyor; eval sandbox'ı bu dizini salt okunur bıraktığı için `Read-only file system` ile başarısız oluyor. Komutun kendi çıktısı ve çıkış kodu doğru, ama araç sonucu ve kanıt kaydı `fail` görünür.
  - Gerçek sandbox'ta (`setup-project`'in açtığı) bu olmaz; aynı komutlar exit 0 ile kaydedildi (2026-11-16, WSL2).
  - Bu yüzden eval vakaları başarılı bir kanıt kaydı (`exit 0`) beklemez. `evidence-id`, ajanın hook'un verdiği durumu dürüstçe aktarmasını ölçer. Başarılı kayıt L0 testleri ve canlı `--plugin-dir` denemeleriyle doğrulanır.
  - Bu sorunun ortaya çıkışı: önceki koşularda "exit 0" grader'ı test çıktısındaki `exit=0` metnine eşleşip **yanlış pozitif** veriyordu. Grader'lar artık hook'un kimlik satırını hedefliyor.
- **Playwright MCP eval'de başlatılmaz** (mock yok). Tasarım kapısının ekran görüntüsü akışı eval ile değil, canlı olarak doğrulanır.

## CI

`.github/workflows/agent-team-evals.yml` elle tetiklenir (`workflow_dispatch`, paket seçimi) ve `ANTHROPIC_API_KEY` secret'ı ister. L0 testleri her PR'da ayrı iş akışında (`agent-team.yml`) çalışır.
