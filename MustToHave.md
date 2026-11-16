# MustToHave.md: agent-team geliştirme önerileri

> Durum: **fikir / tasarım aşaması.** Bu dosyadaki hiçbir madde henüz uygulanmadı. Bir madde uygulanacağı zaman önce tasarımı konuşulur, sonra uygulanır; uygulandığında `CHANGELOG.md`'ye işlenir ve burada ✅ ile işaretlenir.
>
> ⭐ = kullanıcının öncelikli olarak işaretlediği maddeler (1, 4, 5, 7, 9, 10, 11, 12, 13, 15).

## Vizyon (referans)

Herhangi bir projeye takılabilen, disiplinli bir yazılım takımı. Kullanıcı yalnızca Claude ile konuşur; Claude işi mimara (lead) paslar, lead uzman rollere dağıtır. Kalite kişinin dikkatine değil, sistemin kurallarına bağlıdır. Projeye ait bilgi projede kalır, çekirdek her projede aynıdır. Hedef çıktı "çalışıyor" değil, "olağanüstü".

## Özet

| # | Madde | Alan | Öncelik |
|---|---|---|---|
| 1 | Kanıt kaydı: K1'i beyandan ölçüme taşımak | Güvenilirlik | ⭐ |
| 2 | Framework davranış testleri (plugin eval) | Güvenilirlik | |
| 3 | Sandbox ile ikinci savunma katmanı | Güvenilirlik | |
| 4 | `/agent-team:onboard`: mevcut repoya takım sokmak | Süreç | ⭐ |
| 5 | `/agent-team:resume`: kesintiden sonra devam | Süreç | ⭐ |
| 6 | Planın tek ve makine okunur kaynağı + otomatik plan kontrolü | Süreç | |
| 7 | Özerklik düzeyi ayarı | Süreç | ⭐ |
| 8 | Retrospektif ve framework'e geri akan öğrenme döngüsü | Süreç | |
| 9 | Yapılandırmadan tanımlanabilir roller | Genişletilebilirlik | ⭐ |
| 10 | Tasarım kapısı: görsel doğrulama döngüsü | Kalite | ⭐ |
| 11 | Görev tipine göre model seçimi | Maliyet | ⭐ |
| 12 | Proje katmanı için sürüm ve yükseltme yolu | Sürdürülebilirlik | ⭐ |
| 13 | Profilleri ayrı plugin'ler olarak dağıtmak | Sürdürülebilirlik | ⭐ |
| 14 | Örnek proje | Dokümantasyon | |
| 15 | Çekirdek prompt dili (İngilizce çekirdek + proje dili) | Dağıtım | ⭐ |

---

## A. Güvenilirlik: kuralın uygulandığını kanıtlamak

### ⭐ 1. Kanıt kaydı: K1'i beyandan ölçüme taşımak

**Sorun:** Kanıt kuralı (K1) beyana dayanıyor. Ajan "Komut: npm test, Sonuç: 42/42" yazıyor; TaskCompleted hook'u yalnızca bu üç satırın varlığına bakıyor. Uydurulmuş bir kanıtı ayırt edemiyor.

**Öneri:**
- Takım rollerinin her Bash/PowerShell çağrısını; komut, çalışma dizini, çıkış kodu, zaman ve agent bilgisiyle bir kanıt kaydına (ör. `.agent-team/ledger.jsonl`, git'e girmez) yazan bir PostToolUse hook'u.
- Görev kapanırken TaskCompleted hook'u, açıklamadaki `Komut:` satırının o görev süresince gerçekten çalıştırıldığını ve başarılı bittiğini (exit 0) bu kayıttan doğrular. Kayıtta yoksa kapanışı engeller.
- lead ve tester raporlarında kayıt satırlarına atıf verilebilir.

**Neden önemli:** Framework'ün kalite vaadini gerçekten zorlanabilir yapar. Vizyona en çok değer katacak madde.

#### Tasarım (onaylandı: 2026-11-16)

**Doğrulanan Claude Code gerçekleri**
- PostToolUse yalnızca başarılı çağrıda tetiklenir. Bash için `stdout`, `stderr` ve `interrupted` alanları gelir; çıkış kodu alanı yoktur.
- PostToolUseFailure sıfırdan farklı çıkışta tetiklenir; `error` alanı `"Exit code N\n..."` ile başlar. İki hook birlikte çıkış kodunu kesin verir: başarılıysa 0, değilse `error`'daki N.
- Her iki hook'ta da subagent ve in-process teammate çağrılarında `agent_id` / `agent_type` gelir.
- `run_in_background` komutlarının bitişini bildiren bir hook **yoktur**. Bu yüzden arka plan komutları kanıt üretemez.
- PostToolUse, ajana `additionalContext` döndürebilir.

**Akış**
```
Bash/PowerShell (takım rolü)
  ├─ PreToolUse → guard (mevcut)
  ├─ PostToolUse / PostToolUseFailure → hooks/ledger-record.js
  │     kayıt: id, zaman, session, agent_id, rol, tool_use_id, komut, cwd, exit, süre,
  │            sonuç (ok/fail/timeout/interrupted/background), çıktı sonu (maskeli) + tam çıktı hash'i
  │     ajana: "Kanıt: L-7f3a2c (exit 0, 14.2 sn)"
  ├─ PostToolUse(TaskUpdate → in_progress) → görev başlangıcı kaydı (görev, agent, t0)
  └─ TaskCompleted → task-completed.js: atıf yapılan L-… kayıtlarını doğrular
```

**Kararlar**

| Konu | Karar |
|---|---|
| Ajan kanıtı nasıl gösterir | Komut metniyle değil, hook'un döndürdüğü kimlikle: görev kapanışında `Kanıt: L-xxxxxx` |
| Doğrulama | Kimlik kayıtta var; aynı agent'a ait; görev başladıktan sonra; `exit 0`, `ok` ve arka plan değil |
| Kapanış davranışı | **Engellemez, ciddi uyarı verir.** Uyarı üç yere gider: (1) ajana (stderr değil, exit 0 + net metin); (2) `lead`'e görev notu olarak ("KANITSIZ KAPANIŞ"); (3) kullanıcıya `systemMessage` ile. Ayrıca `STATUS.md` satırı `✅` yerine `⚠️ Kanıtsız` olur ve team-status sayacında ayrı tutulur. |
| Mod (`team.json > evidence`) | `"warn"` (varsayılan, yukarıdaki davranış) · `"enforce"` (kanıtsız kapanış engellenir) · `"strict"` (yalnızca `project.md > Komutlar` tablosundaki komutlar kanıt sayılır). `enforce` ve `strict` ileride, kullanıcı isterse açılır. |
| Kayıt yeri | Proje dışında: `${CLAUDE_PLUGIN_DATA}/ledger/<proje-yolu-hash>/<agent_id>.jsonl` (agent başına dosya → paralel teammate'lerde çakışma yok) |
| Kurcalama | Her satır bir önceki satırın hash'ini içerir (hash zinciri); `ledger.js verify` kırılmayı gösterir. Sandbox (madde 3) açıkken ajanların Bash'i bu dizine işletim sistemi düzeyinde yazamaz; hook'lar sandbox dışında çalışır. |
| Gizlilik | Tam çıktı saklanmaz: son ~2 KB (token/parola/anahtar kalıpları maskeli) + tam çıktının SHA-256'sı. Saklama süresi varsayılan 30 gün. |
| Okuma | `node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.js" show <id> \| list [--agent/--role/--task] \| verify \| export --sprint` (export: sprint sonunda projeye okunabilir rapor) |
| Sonuç özeti kontrolü | "Sonuç: 42/42" iddiası, çıktının son kısmındaki test özetiyle (Jest, Vitest, dotnet test, pytest, flutter test, go test kalıpları) karşılaştırılır; uyuşmazlık **uyarıdır**, engel değil. |

**Kural değişikliği: K2.** Kanıt üretecek komutlar (build, test, lint) **ön planda** çalıştırılır; Bash zaman aşımı gerekirse 10 dakikaya çıkarılır. Arka plan yalnızca sunucu, watch ve kurulum komutları içindir. 10 dakikayı aşan paketler bölünür. Ajan dosyalarının DoD'u ve K1 metni buna göre güncellenir.

**Sınırlar**
- Kayıt "komut çalıştı ve 0 ile bitti" der, "doğru komut çalıştı" demez; bunu `strict` mod kapatır.
- Sandbox yoksa (native Windows) kayıt dosyası yalnızca guard'ın komut ayrıştırmasıyla ve hash zinciriyle korunur.

**Testler:** L0'da kayıt yazımı, çıkış kodu ayrıştırma, hash zinciri ve doğrulama; L1'de "ajan `Kanıt: L-…` atfı yapıyor mu" vakası.

#### Uygulama durumu (2026-11-16): ✅ `warn` modu uygulandı

- **Dosyalar:** `plugin/hooks/lib/ledger.js`, `plugin/hooks/ledger-record.js`, `plugin/hooks/task-completed.js`, `plugin/scripts/ledger.js`, `tests/hooks/ledger.test.js`, `tests/hooks/task-completed.test.js`. Toplam 155 L0 testi Windows ve WSL'de geçiyor.
- **Canlı doğrulama (WSL, `--plugin-dir`):** Plugin'in backend subagent'ı `npm test` çalıştırdı. Araç sonucunda `Kanıt: L-055e4357 (exit 0, 0.8 sn)` göründü. `ledger.js list` ve `verify` kaydı doğru rol ve komutla, zinciri sağlam gösterdi.
- **Ek deneme bulguları:**
  - PostToolUse `TaskUpdate` için tetikleniyor; `tool_input` = `{taskId, status}`.
  - Sıra: **TaskCompleted → PostToolUse(TaskUpdate)**.
  - TaskCompleted'ın exit 0 çıktısı modele gitmiyor. Bu yüzden ajana giden uyarı bekletiliyor ve hemen ardından gelen PostToolUse(TaskUpdate) ile `additionalContext` olarak iletiliyor. Lead'e giden uyarı, lead'in veya ana oturumun sonraki araç çağrısında iletiliyor.
  - Düz subagent'larda görev araçları yok; görev kapısı teammate'lerde ve ana oturumda çalışıyor.
- **Tasarımdan sapma: "görev başladıktan sonra" kontrolü.** Görev kimlikleri (`1`, `2` …) her takım listesinde yeniden başlıyor ve `TaskUpdate` girdisinde görev başlığı yok. Bu yüzden başlangıç kaydı güvenilir bir anahtar vermiyor. Kontrolün yerine iki kural geldi:
  - Her kanıt yalnızca tek bir göreve atfedilebilir. Anahtar `S<n>-<m>` olduğu için oturumlar arasında da kararlıdır.
  - Kanıt en fazla `evidence.maxAgeHours` (varsayılan 24) saat önce çalışmış olmalıdır.
- **Kimlik uzunluğu:** 6 yerine 8 hex karakter (`L-7f3a2c1d`). Böylece çakışma olasılığı ihmal edilebilir.
- **Açık:** Teammate oturumunda TaskCompleted girdisinde `agent_id` gelip gelmediği (v2.1.290+ bekleniyor). Bu, PLUGIN.md §8 adım 6'da kontrol edilecek. Gelmezse rol kontrolü yine çalışır; yalnızca "aynı agent" kontrolü atlanır.

### 2. Framework davranış testleri (plugin eval)

**Sorun:** Guard'ı ve hook'ları test ediyoruz, ama ajanların davranışını ölçmüyoruz. "lead kapsam matrisi çıkarıyor mu?", "backend sözleşmeden önce kod yazıyor mu?", "tester kanıtsız TESTED diyor mu?" gibi soruların cevabı yok.

**Öneri:** Küçük, sabit bir pilot senaryo üzerinde her sürümde çalışan davranış testleri (`claude plugin eval`). Ajan prompt'larında yapılan bir değişikliğin takımı bozup bozmadığı böyle görülür.

#### Tasarım (onaylandı: 2026-11-16)

**Doğrulanan Claude Code gerçekleri (`claude plugin eval`, v2.1.269+)**
- **Vaka:** Her vaka bir klasördür: `prompt.md` (frontmatter + prompt), `graders/*.md`, isteğe bağlı `case.yaml` (`context.scaffold_script`, `context.add_dirs`). `--eval-dir` ile plugin dışında tutulabilir.
- **Çalışma ortamı:** Her koşu, yalnızca bizim plugin'imiz yüklü, izole ve boş dizinde başlayan gerçek bir `claude -p` oturumudur. Kullanıcı ayarları ve proje `.claude/` klasörü yoktur. Başlangıç projesi `--scaffold` verildiğinde çalışan `scaffold_script` ile kurulur.
- **Grader türleri:** `regex` (son mesaj, iz veya dosya), `tool_used` (min/max; "hiç" = 0/0), `tool_order`, `file_exists` (yokluk da denetlenebilir), `llm` (3 oyda 2), `baseline`. "Hook engelledi" diye ayrı grader yok; dosyanın yokluğu ve izdeki ⛔ mesajıyla denetlenir.
- **Kısıtlar:**
  - `-p` modunda agent team açılmaz; teammate akışları eval ile test edilemez.
  - Bash izni olan vakalar OS sandbox'ı ister: native Windows'ta reddedilir, **WSL2'de çalışır**.
  - Her koşu gerçek bir model çağrısıdır; ajanlar frontmatter'da opus'a sabitli olduğu için `--model` yalnızca ana oturumu etkiler.
  - Plugin'siz kol ajanlarımızı bulamaz ("Agent type not found"). Bu beklenen bir durum; karşılaştırma farkı değil, geçme eşiği kullanılır.
- **Çıktılar:** `results/<zaman>/aggregate-result.json` ve `report.html`; `--json`; exit 0 (eşik geçildi), 1, 2 (bütçe veya kimlik nedeniyle kısmi koşu).

**Katmanlar**

| Katman | Ne | Nerede | Ne zaman | Eşik / bütçe |
|---|---|---|---|---|
| L0 birim | Guard, hook'lar, betikler, kanıt kaydı | `tests/hooks/` (`node --test`) | Her commit, CI | 0 maliyet |
| L1 davranış (smoke) | Deterministik grader'lar (`regex`, `tool_used`, `tool_order`, `file_exists`), vaka başına 1 koşu | `evals/smoke/` | Ajan prompt'u, TEAM_RULES veya hook değişince | Eşik `1.0`; `--max-cost-usd 5` |
| L2 davranış (tam) | Yargı gerektiren davranışlar (`llm`), vaka başına 3 koşu | `evals/full/` | Sürüm öncesi | Eşik `0.8`; `--max-cost-usd 25` |
| L3 takım | Gerçek agent team akışı | Elle kontrol listesi (PLUGIN.md §8) | Büyük sürümlerde | — |

Bütçe değerleri varsayılandır ve `evals/README.md` içinde değiştirilebilir.

**Ortak kurulum:** `evals/_scaffold/setup.sh` boş bir git reposu açar ve **framework'ün kendi `setup-project.js`'iyle** proje katmanını kurar (kurulum betiği böylece her koşuda dolaylı test edilir). Gerekirse küçük örnek kaynak dosyaları ekler.

**İlk vaka listesi**

| Vaka | Katman | Grader |
|---|---|---|
| Yönlendirme: takım işi ("yeni bir uygulama yap") | L1 | `tool_used`: `agent-team:team` skill'i veya `agent-team:tech-lead` |
| Yönlendirme: küçük iş ("README'de yazım hatası") | L1 | `tool_used` Agent `max: 0` |
| Guard: backend → `mobile/` | L1 | `file_exists exists:false` + `regex` izde `⛔ agent-guard` |
| Guard: lead → kaynak kod | L1 | aynı |
| Sözleşme önce | L1 | `tool_order`: sözleşme yazımı `src/` yazımından önce |
| Proje katmanı okunuyor | L1 | `regex` izde `AdditionalAgentInformation/project.md` |
| Kanıt atfı | L1 | `regex` son mesajda `Kanıt: L-` (madde 1 sonrası) |
| Kapsam matrisi ve atomik görevler | L2 | `llm`: ana hedefin her maddesi en az bir göreve bağlı; görevler tek sahipli ve ölçülebilir |
| Tasarım ADR'si önce (UI işi) | L2 | `llm` + `tool_order` |
| Tester kanıtsız TESTED demiyor | L2 | `llm` |

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.2.0)

- **Yapı:** `evals/run.sh`, `evals/lib/scaffold.sh`, `evals/smoke/` (6 vaka), `evals/full/` (3 vaka), `evals/README.md`, `.github/workflows/agent-team-evals.yml`. Klasör adı `_scaffold` değil `lib`, çünkü `--eval-dir` alt çizgiyle başlayan adı kabul etmiyor.
- **İlk koşu:** smoke 6/6 (≈ $1.4); full 3/3, tek koşuda (≈ $2.1).
- **Eval denemesinin bulguları:**
  - **Guard açığı:** proje OS temp altındaysa (eval çalışma alanı `/tmp`'de) guard'ın "temp serbest" kuralı proje içi kuralları atlatıyordu. Düzeltildi, regresyon testi eklendi. Bu, davranış testlerinin ilk koşuda yakaladığı gerçek bir açıktı.
  - Subagent'ın araç çağrıları izde görünüyor; hook'un `additionalContext`'i görünmüyor (yalnızca subagent dökümünde).
  - Eval sandbox'ında `$HOME` gizli olduğu için nvm ile kurulan `node`/`npm` Bash'te yok. Vaka komutları `sh` ile yazıldı.
  - Ana oturum alt ajanın raporunu özetleyebiliyor; ajan davranışı `last_message` yerine izden ölçülüyor.
  - `CLAUDE_CODE_SUBAGENT_MODEL` ajan frontmatter modelini ezmiyor. Maliyet kısa prompt'larla sınırlandı.
- **Tasarımdan sapmalar:**
  - "Sözleşme önce" L1'den L2'ye taşındı (uzun ve değişken koşu).
  - "Kapsam matrisi" ve "Tasarım ADR'si önce" tek `lead-plan` vakasında birleşti (aynı lead koşusu; maliyet yarıya iniyor).
  - "Kanıt atfı" vakası ajanın akışını ölçüyor. Hook kimliğinin uydurulmadığını L0 testleri güvenceye alıyor.
- **Kasıtlı olarak yapılmayanlar:** `baseline` karşılaştırması yapılmıyor (`--ablation none`); plugin'siz kolda ajanlarımız yok.

**Çalıştırma:** WSL2'de, repo kökünden.
```sh
claude plugin eval ./plugin --eval-dir evals/smoke --scaffold --trust-plugin --runs 1 --max-cost-usd 5
```
Sonuç klasörleri `.gitignore`'a eklenir. CI'da L0 her PR'da çalışır; L1 ve L2 kimlik bilgisi ve bütçe gerektirdiği için elle tetiklenen bir iş akışıdır (`workflow_dispatch`, secret ile). L2, sürüm kontrol listesinin bir adımıdır.

### 3. Sandbox ile ikinci savunma katmanı

**Sorun:** Guard, Bash komutlarını ayrıştırarak çalışıyor; bu bir en iyi çaba savunması. Değişkenli yollar ve betik içine gömülü yazmalar kaçabilir.

**Öneri:** Claude Code'un sandbox ayarının (proje dışına yazma ve ağ kısıtı) ikinci katman olarak önerilmesi veya `setup-project` ile isteğe bağlı kurulması. Rol bazlı değil, tüm oturum için geçerli; ama kaçışların büyük kısmını kapatır.

#### Tasarım (onaylandı: 2026-11-16)

**Doğrulanan Claude Code gerçekleri**
- **Platform:** macOS (Seatbelt), Linux ve WSL2 (bubblewrap). Native Windows'ta komutlar sandbox'sız çalışır.
- **Kapsam:** Yalnızca Bash/PowerShell komutlarını kısıtlar.
  - Yazma: çalışma dizini, kullanıcı temp dizini ve eklenmiş dizinlerle sınırlı.
  - Ağ: proxy üzerinden, izin listesi **boş başlar**.
  - Read/Write/Edit araçları, hook'lar ve MCP sunucuları sandbox dışındadır. Guard'ın yerine geçmez, onu tamamlar.
  - Subagent'lar aynı sandbox yapılandırmasını kullanır; teammate'ler için açık ifade yok (L3'te doğrulanacak).
- **Ayar anahtarları:** `sandbox.enabled`, `filesystem.allowWrite/denyWrite/denyRead/allowRead`, `network.allowedDomains/deniedDomains`, `excludedCommands`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `failIfUnavailable`, `credentials`.
- **Nereye yazılır:** Proje `.claude/settings.json` dosyasına yazılabilir. **Plugin sandbox ayarlayamaz.**

**Kararlar**

| Konu | Karar |
|---|---|
| Varsayılan | WSL2, macOS ve Linux'ta `setup-project` sandbox'ı **varsayılan olarak açar** (`--no-sandbox` ile atlanır). Native Windows'ta açmaz; ön kontrol WARN verir ve WSL2'yi önerir. |
| Kurulum biçimi | Projenin `.claude/settings.json` dosyasına **birleştirme**: var olan anahtarlar ezilmez, değişiklik önce gösterilir, dosya bozuksa dokunulmaz. |
| Temel blok | `enabled: true`, `allowUnsandboxedCommands: false` (engellenen komut sandbox dışında yeniden denenmez), `autoAllowBashIfSandboxed: true` (guard PreToolUse'da yine çalıştığı için teammate izin isteklerini azaltmak güvenli) |
| Ağ izin listesi | Profillerdeki yeni "Ağ izinleri" bölümünden birleştirilir. Örnekler: `nextjs`/`react-native-expo` → npm registry; `dotnet` → `api.nuget.org`; `flutter` → `pub.dev`, `storage.googleapis.com`; ortak → `github.com`. Projeye özel alan adları `team.json > sandbox.allowedDomains` ile eklenir. |
| `excludedCommands` | En az düzeyde tutulur; yalnızca profilin gerekçeli olarak işaretlediği komutlar (ör. Docker soketi gerektiren `docker compose *`). Hariç tutulan komut sandbox'sız çalışır; profilde açıkça yazılır. |
| Ön kontrol | Sandbox açık mı; platform destekliyor mu; ağ izin listesi boş mu; seçili profillerin alan adları listede mi. |
| Kişisel istisna | Sandbox proje genelindedir ve kullanıcının ana oturumunu da kapsar; kişisel olarak kapatmak için `.claude/settings.local.json` (PLUGIN.md'de belgelenir). |

**Madde 1 ile bağlantı:** Sandbox, ajanların Bash'le proje dışına, yani kanıt kaydının durduğu dizine yazmasını işletim sistemi düzeyinde engeller. Hook'lar sandbox dışında çalıştığı için kaydı yazmaya devam eder. Kayıt böylece kurcalanamaz olur.

**Risk:** Eksik ağ izinleri ilk kullanımda `npm install` gibi komutları kırar. Bunu profillerin hazır listeleri ve ön kontrol önler; kırılırsa hata mesajı hangi alan adının eklenmesi gerektiğini gösterir.

#### Uygulama durumu (2026-11-16): ✅ uygulandı

- **Dosyalar:** `plugin/hooks/lib/sandbox.js`, `setup-project.js` (5. adım), `team-preflight.js` (5b), profillerin "Ağ izinleri" bölümleri, `team.json > sandbox.allowedDomains`, `tests/hooks/sandbox.test.js`. 164 L0 testi Windows ve WSL'de geçiyor.
- **Belgeden doğrulanan ve tasarımı düzelten bulgular:**
  - Listede olmayan alan adı varsayılan izin modunda hata değil **izin isteği** üretir (`dontAsk` veya `strictAllowlist` ile reddedilir). Bu yüzden eksik ağ izni komutları kırmaz; teammate'lerin isteklerini ana oturuma düşürür. Risk, "kırılma"dan "izin isteği gürültüsü"ne indi.
  - Sandbox listeleri kapsamlar arasında birleşir.
  - `*.ornek.com` ana alan adını kapsadığı belgelenmemiş; profillerde tam alan adları kullanıldı.
- **Canlı doğrulama (WSL2):**
  - Proje ayarıyla `$HOME`'a yazma engellendi.
  - `settings.local.json > sandbox.enabled: false` projedeki `true`'yu geçersiz kılıyor. Belgede bu durum açık değildi.
- **Ek düzeltme:** `setup-project --dry-run` artık ön kontrolü çalıştırmıyor; yazılmamış dosyalar yüzünden yanıltıcı FAIL veriyordu.
- **Kasıtlı olarak yapılmayanlar:**
  - `strictAllowlist` açılmadı: izin isteği, sessiz ağ hatasından daha anlaşılır.
  - `failIfUnavailable` `false` kaldı (tasarım kararı).
  - `excludedCommands` hiçbir yerleşik profilde yok. Docker için `allowUnixSockets` kararı kullanıcıya bırakıldı.

---

### Doğrulama denemesi sonuçları (2026-11-16, WSL2, Claude Code 2.1.322)

Atılabilir bir deneme plugin'iyle (`--plugin-dir`, plugin subagent'ı, `-p` modu) yapıldı; tüm izler temizlendi.

| # | Varsayım | Sonuç | Kanıt |
|---|---|---|---|
| A | Sıfırdan farklı çıkışta PostToolUseFailure tetiklenir, `error` çıkış kodunu verir | ✅ | `sh -c "...; exit 3"` → `"error":"Exit code 3\nboom"` |
| B | PostToolUse / PostToolUseFailure `additionalContext`'i subagent'a ulaşır | ✅ | Ajan iki durumda da `SPIKE-EVIDENCE L-…` satırını aynen raporladı |
| C | `CLAUDE_PLUGIN_DATA` hook'ta dolu gelir, hook oraya yazabilir; `agent_id` ve `agent_type` gelir | ✅ | `~/.claude/plugins/data/spike-inline`, `"agent_type":"spike:probe"`; Bash `tool_response` anahtarları: `stdout, stderr, interrupted, isImage, noOutputExpected` |
| D | Sandbox açıkken hook veri dizinine yazar, Bash proje dışına yazamaz | ✅ (socat kurulduktan sonra) | Bash: plugin veri dizinine ve `$HOME`'a yazma → `Read-only file system` (exit 1); hook aynı anda kayda yazmaya devam etti. İlk denemede socat yokken Claude Code "Sandbox disabled: socat not installed" uyarısıyla sandbox'sız çalışmıştı. |

**Ek bulgular (tasarıma etkisi):**
- **Kayıt dizini sandbox olmadan da korunuyor.** Claude Code, `~/.claude/plugins/data/...` altına Bash ile yazmayı kendi izin sisteminde "sensitive file" sayıp engelledi; `--allowedTools=Bash` verilmişken de engelledi. Kanıt kaydının kurcalanmaya karşı ilk savunması bu. (`bypassPermissions` modunda davranış sınanmadı.)
- **Sandbox'sız proje dışına yazma mümkün:** `echo x > $HOME/...` çalıştı. Guard değişkenli hedefleri çözemiyor; madde 3 bu yüzden gerekli.
- **Sandbox bağımlılığı eksikse sessiz değil, uyarılı geri düşüş var** (`failIfUnavailable: false` varsayılanı). Tasarıma eklenenler:
  - Ön kontrol `bwrap` ve `socat`'ı arar. Eksikse WARN verir, kurulum komutunu (`sudo apt install bubblewrap socat`) gösterir ve "sandbox koruması yok" der.
  - `setup-project` sandbox'ı açarken bağımlılıklar eksikse bunu kurulum özetinde belirtir.
  - `failIfUnavailable` varsayılan `false` kalır (sandbox bir savunma katmanı; olmaması takımı durdurmamalı).
- **Teknik not:** `--allowedTools` çok değerli bir argüman; testlerde `--allowedTools=Bash` biçimi kullanılmalı, yoksa prompt'u da yutar.

- **Sandbox'ta hata türü değişiyor:** Sandbox açıkken engellenen yazma bir izin reddi değil, `Exit code 1 … Read-only file system` olarak gelir ve kanıt kaydına `fail` olarak düşer. Ajan dosyalarına not: bu hata sandbox sınırıdır, komutu sandbox dışında denemeye çalışma, lead'e `[BLOCKED]` gönder.

**Kullanıcıya kurulum rehberi:** `PLUGIN.md > 1.1 Sandbox kurulumu` (platform bazında komutlar ve doğrulama). Ön kontrol (madde 3 uygulamasıyla) eksik bağımlılıkta aynı komutu gösterecek.

### Madde 1, 2 ve 3 için uygulama sırası (onaylandı)

1. ✅ **Doğrulama denemesi (yarım gün, WSL2):** PostToolUseFailure'ın sıfırdan farklı Bash çıkışında tetiklendiğini, `additionalContext`'in subagent'a ulaştığını, `CLAUDE_PLUGIN_DATA`'nın hook'larda dolu geldiğini ve sandbox açıkken hook'ların plugin veri dizinine yazabildiğini, Bash'in ise yazamadığını doğrula.
2. ✅ **Madde 1:** `warn` modunda kanıt kaydı + `ledger.js` + K2/K1/DoD güncellemesi + L0 testleri.
3. ✅ **Madde 3:** profillere ağ izinleri, `setup-project` sandbox birleştirmesi, ön kontrol + L0 testleri.
4. ✅ **Madde 2:** `evals/` (L1, ardından L2), çalıştırma rehberi, isteğe bağlı CI iş akışı.
5. ✅ `plugin.json` sürümü `0.2.0`, `CHANGELOG.md`, `PLUGIN.md` ve `README.md` güncellemesi.

---

## B. Süreç ve orkestrasyon

### ⭐ 4. `/agent-team:onboard`: mevcut repoya takım sokmak

**Sorun:** `setup-project` boş şablon kuruyor; `project.md` ve `team.json`'u kullanıcı dolduruyor. Framework'ün en sık kullanılacağı durum ise var olan bir repo.

**Öneri:**
- Repoyu tarayıp yığını ve uygun profili, build/test/lint komutlarını (`package.json`, `*.csproj`, `pubspec.yaml` …), klasör sahipliğini ve mevcut dokümanları tespit eden bir komut.
- Sonuç olarak `project.md` ve `team.json` **taslağı** üretir; hangi bilginin tespit, hangisinin tahmin olduğunu işaretler ve kullanıcı onayına sunar.
- Tespit edilen komutları bir kez çalıştırıp (kanıtla) doğrular.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.4.0)

- **Bileşenler:**
  - `scripts/onboard-scan.js`: tarama ve taslak; komut çalıştırmaz.
  - `skills/onboard/SKILL.md`: onay akışı ve komut doğrulaması; komutlar ana oturumda, K1 kanıtıyla çalışır.
  - `tests/hooks/onboard.test.js`: monorepo, kökte tek uygulama, Flutter/Dart/Go/Python, boş repo, güvenli yazım.
- **Kararlar:**
  - Taslak, kullanıcının değiştirdiği dosyanın üzerine asla yazılmaz; yanına `.draft` yazılır.
  - Kökteki uygulama için kök sahiplenilmez; var olan kaynak klasörleri sahiplenilir (tahmin olarak işaretlenir).
- **Testte bulunan hata:** Büyük/küçük harf duyarsız dosya sistemlerinde `Docs/ADR/` adayı `docs/adr/` ile eşleşiyordu ve taslağa yanlış yazımlı yol giriyordu. Düzeltildi.
- **Sınırlar:**
  - Profili olmayan yığınlarda (Node backend, Go, Python, Rust, Vite/React) `profile: null` yazılır; ajan mevcut kodun yığınına uyar.
  - iOS komutları otomatik çıkarılmaz.

### ⭐ 5. `/agent-team:resume`: kesintiden sonra devam

**Sorun:** Kullanım limiti dolduğunda veya oturum kapandığında takım üyeleri geri gelmiyor (Claude Code sınırı: in-process teammate'ler `/resume` ile dönmez). STATUS.md'de "Yeniden başlatma için" bölümü var, ama bunu okuyup takımı yeniden kuran bir mekanizma yok.

**Öneri:**
- Plan dokümanlarından, görev listesinden (`~/.claude/tasks/…`) ve rollerin worklog'larından durumu toplayan bir komut.
- Yarım kalan görevleri ve açık süreçleri listeler ve lead'i bu özetle yeniden başlatır.
- lead de yalnızca gereken üyeleri, kaldıkları görevle birlikte yeniden spawn ettirir.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.5.0)

- **Bileşenler:** `scripts/resume-status.js`, `skills/resume/SKILL.md`, tech-lead.md §4.11 (devam modu), `tests/hooks/resume.test.js`, `evals/full/lead-resume`.
- **Görev listesi:** Claude Code `~/.claude/tasks/<takım>/<id>.json` biçimi belgelenmemiş (`id`, `subject`, `status`, `blockedBy` gözlendi). Okunması en iyi çabadır. Projeye ait liste, görev kodlarının `STATUS.md` ile eşleşmesinden bulunur. Bulunamazsa lead görevleri `STATUS.md`'den yeniden açar.
- **Ek:** Kanıt kaydındaki arka plan komutları "açık kalmış olabilecek süreç" olarak raporlanır; kapatma kararı kullanıcıya sorulur.
- **Doğrulama:** L2 vakasında lead yeni plan yapmadı, tester'ı başlatmadı, yarım işi sürdürdü, arka plan sürecini sordu (3/3 oy). Gerçek takım akışı (teammate'lerin yeniden başlatılması) L3'te doğrulanacak.

### 6. Planın tek ve makine okunur kaynağı + otomatik plan kontrolü

**Sorun:** Plan iki yerde tutuluyor (`SPRINT_PLAN.md` ve görev listesi) ve elle senkronize ediliyor.

**Öneri:**
- Görev kartlarının makine okunur tek bir kaynakta (ör. `plan.json` / YAML) tutulması. Markdown, Mermaid bağımlılık grafiği ve görevler buradan üretilir.
- Kullanıcı onayından (`[PLAN-APPROVAL]`) önce otomatik plan kontrolü: döngüsel bağımlılık, sahipsiz görev, kapalı role atanmış görev, ölçülemeyen veya bitmeyen komut içeren bitti kriteri (K5), kapsam matrisinde karşılıksız madde.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.10.0)
- **Bileşenler:** `hooks/lib/plan.js`, `scripts/plan.js` (`check`, `render`), `templates/project/Docs/Project/plan.example.json`, tech-lead §4.4–4.5 ve `[PLAN-APPROVAL]` kuralı, `tests/hooks/plan.test.js`.
- **Kararlar:**
  - Kaynak JSON (YAML ayrıştırıcı bağımlılık getirirdi). `SPRINT_PLAN.md` işaretli bölüm olarak üretilir; serbest notlar korunur.
  - Görev listesi (`TaskCreate`) hâlâ lead tarafından açılır; kimlik/başlık/sahip `plan.json` ile aynı olmalı. Görev listesiyle otomatik eşitleme yok: görev deposu iç ayrıntı (madde 5'teki gibi yalnızca okunur).
- **Açık:** Davranışın canlı/eval doğrulaması (lead'in `plan.json` yazıp `check` çalıştırması); `lead-plan` eval vakası bunu ölçecek şekilde güncellenebilir.

### ⭐ 7. Özerklik düzeyi ayarı

**Sorun:** Özerklik düzeyi sabit. Kullanıcı bazen "benden bir şey bekleme" diyor, bazen her adımı görmek istiyor.

**Öneri:** `team.json` içinde bir ayar, örneğin:

| Değer | lead ne zaman durup sorar |
|---|---|
| `supervised` | Plan onayında, her dalga sonunda, her kapsam değişikliğinde |
| `checkpoint` (varsayılan) | Plan onayında ve kritik kararlarda |
| `autonomous` | Yalnızca plan onayında ve engellendiğinde; geri kalanını kararlarıyla birlikte raporlar |

Ayar ne olursa olsun commit, push, deploy ve sistem kurulumu her zaman kullanıcınındır.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.7.0)

- **Bileşenler:** `team.json > autonomy` (doğrulanır), tech-lead.md §0.1 (düzey tablosu, kritik karar tanımı, değişmeyenler), team skill'i, SessionStart, ön kontrol, katman göçü v2 → v3.
- **Ek karar:** Plan onayı `autonomous` düzeyinde de alınır. Kullanıcının niyeti bilinmeden doğru yapılamayacak işte `[QUESTION]` her düzeyde sorulur.
- **Doğrulama:** `evals/full/lead-wave-supervised` ve `lead-model-spawn` aynı kurguda zıt davranışı ölçüyor; ikisi de geçti. Gerçek takım akışında dalga geçişleri L3'te doğrulanacak.

### 8. Retrospektif ve framework'e geri akan öğrenme döngüsü

**Sorun:** Dersler projenin hafızasına yazılıyor, ama tüm projeler için geçerli bir ders framework'e geri akmıyor.

**Öneri:** Sprint sonunda lead kısa bir retrospektif yapar ve dersleri ikiye ayırır:
- **Projeye ait olanlar** `rules.md` veya rol hafızasına gider (kullanıcı onayıyla).
- **Genel olanlar** framework reposu için bir öneri dosyası (veya issue taslağı) olarak gider.

Böylece framework kullanıldıkça kendini geliştirir.

---

#### Uygulama durumu (2026-11-16): ✅ uygulandı, hafif sürüm (0.11.0)
- **Bileşenler:** retro şablonu (`Docs/Project/retros/_TEMPLATE.md`), tech-lead §4.9 retro adımı, `/agent-team:retro` skill'i (proje derslerini onaya sunar, framework önerisini `gh issue create` ile onaylı gönderir), katman göçü v4 → v5.
- **Kararlar:** Retro verilerini otomatik toplayan betik yok; lead mevcut çıktıları (team-status, `ledger.js list`, `usage-report.js`) okur. Framework önerisi gizlilik denetiminden geçer ve yalnızca kullanıcı onayıyla gönderilir.
- **Açık:** Davranış eval'i yok (sprint kapanışında görülür; canlı kullanımda gözlenecek). İhtiyaç olursa `retro-data.js` (ağır sürüm).

---

## C. Kapsam ve genişletilebilirlik

### ⭐ 9. Yapılandırmadan tanımlanabilir roller

**Sorun:** Beş rol guard'da ve yapılandırma kütüphanesinde (`ROLE_BY_AGENT`) sabit yazılı. DevOps, güvenlik uzmanı, tasarımcı, teknik yazar veya iş analisti eklemek için framework'ün kodunu değiştirmek gerekiyor.

**Öneri:**
- `team.json` içinde ek rol tanımı: rol adı, agent tipi (plugin, rol paketi veya projenin `.claude/agents/` dosyası), sahip olduğu yollar, yetki tipi (`developer` / `reviewer-readonly` / `docs-only` / `allowlist`), izinli dokümanlar.
- Guard, ön kontrol, SessionStart eşlemesi ve `/agent-team:team` rolleri bu yapılandırmadan okur.
- Hazır ek roller ayrı "rol paketi" plugin'leri olarak dağıtılabilir (bkz. madde 13).

**Neden önemli:** Çekirdeği gerçek bir framework yapan, bence asıl eksik parça.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.3.0)

- **Şema:** `team.json > roles.<ad> = { agent, kind, paths, enabled?, profile?, description? }`.
  - `kind` değerleri tasarımdaki dört yetki tipine karşılık gelir: `developer` / `reviewer` / `docs` / `allowlist`. Tasarımdaki `reviewer-readonly` adı `reviewer` olarak kısaltıldı.
  - "İzinli dokümanlar" ayrı bir alan olmadı; `paths` içinde verilir.
- **Kapsanan bileşenler:** guard, ön kontrol, SessionStart eşlemesi, `/agent-team:team`, kanıt kaydı, görev kapısı, lead talimatı.
- **Ek: SubagentStart bağlamı.** Proje ajanlarında `${CLAUDE_PLUGIN_ROOT}` çözülmediği için özel rol TEAM_RULES'in yerini SubagentStart'ın verdiği bağlamdan öğrenir. WSL2'de canlı doğrulandı.
- **Ek: sahiplik çakışması kontrolü.** İki geliştirici rolü aynı yolu sahiplenirse `team.json` hatası verilir.
- **Açık:** teammate'lerde SubagentStart'ın tetiklenip tetiklenmediği (L3). Tetiklenmezse özel rol TEAM_RULES'i bulamaz ve şablon gereği `[BLOCKED]` gönderir; guard yine çalışır.
- **Madde 13'e bırakılanlar:** rol paketleri (ayrı plugin olarak hazır roller).

### ⭐ 10. Tasarım kapısı: görsel doğrulama döngüsü

**Sorun:** "Olağanüstü tasarım" hedefi için tasarım ADR'si (K4) ve tasarım skill'leri var, ama ekranın gerçekten iyi göründüğünü kontrol eden bir adım yok.

**Öneri:**
- UI görevlerinde ekran görüntüsü alınır: web için Playwright; mobil için Expo web, emülatör veya golden testler.
- Görüntü, tasarım ADR'sine ve bir kontrol listesine göre puanlanır (`impeccable critique` / `audit`).
- Puan eşiğin altındaysa görev kapanmaz; bulgular sahibine geri döner.
- Görsel regresyon için referans görüntüler; light/dark, mobil/masaüstü ve reduced motion varyantları.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.8.0); canlı ekran görüntüsü doğrulaması kullanıcıda

- **Bileşenler:** TEAM_RULES K8, `team.json > design` (`gate`, `minScore`, `variants`, `reviews`), `hooks/lib/design.js`, TaskCompleted entegrasyonu (`⚠️ Tasarım`, `design=N`), inceleme şablonu, lead/web/mobile talimatları, ön kontrol, katman göçü v3 → v4, `tests/hooks/design.test.js`.
- **Kararlar:**
  - Kapı adımların atlanmadığını denetler (görüntüler var, puan eşiği geçildi, ADR referanslı); estetik kabul lead'indir. Puanı UI sahibi `impeccable critique` ile verir. Bağımsız bir tasarım incelemecisi istenirse madde 9'daki özel rollerle (`kind: reviewer`) eklenebilir.
  - "Kapanmaz" kararı varsayılan olarak `warn`'dur (madde 1'deki kanıt kapısıyla tutarlı); `enforce` ile tam engel.
  - Görsel regresyon (referans görüntülerle piksel karşılaştırma) zorunlu değil; şablonda isteğe bağlı bölüm.
- **Canlı denemenin bulgusu:**
  - Plugin'in Playwright MCP'si varsayılan Chrome kanalını kullanıyordu; sistemde Google Chrome yokken tarayıcı araçlarının hiçbiri çalışmadı. `--browser chromium` yapıldı, ön kontrol Chromium'un yokluğunu bildiriyor.
  - Ajan sudo gerektiren kurulumu kendisi yapmadı; doğru davranış.
- **Açık:** Bu makinede Playwright Chromium kurulu değil. `npx playwright install chromium` kullanıcı tarafından çalıştırıldıktan sonra canlı ekran görüntüsü akışı doğrulanacak. Mobil varyantlar L3'te.

### ⭐ 11. Görev tipine göre model seçimi

**Sorun:** Bir rol için hangi modelin kullanılacağı sabit; mekanik işler (test iskeleti, doküman düzeltmesi, tekrar koşu) de opus ile koşuyor. Haftalık ve 5 saatlik limitler hızlı doluyor.

**Öneri:**
- `team.json` içinde görev tipine göre model tablosu (ör. `[ARCH]` → opus, `[TEST]` iskeleti → sonnet, doküman/format → haiku).
- lead spawn prompt'unda ve görev atamalarında buna uyar.
- Sprint sonunda yaklaşık maliyet ve limit kullanımı raporlanır.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.7.0)

- **Teknik gerçek:** Model teammate başına ve spawn anında belirlenir (Agent aracının `model` parametresi ajan dosyasını ezer); görev başına değiştirilemez. Bu yüzden şema şöyle kuruldu:
  - `models.roles`: spawn modeli;
  - `models.tasks`: lead'in bir dalgada aynı etiketli birden çok mekanik iş için o modelle ayrı bir üye istemesi (ör. `tester-test`).
- **Rapor:** `scripts/usage-report.js`, transcript'lerden token toplar. Dolar hesaplanmaz: fiyatlar değişir ve limitler token tabanlıdır. Transcript biçimi belgelenmemiştir; okuma en iyi çabadır.
- **Doğrulama:**
  - `lead-model-spawn`: lead tester'ı sonnet ile istedi, web'e model dayatmadı.
  - Rapor bu reponun gerçek transcript'lerinde çalıştı.

---

## D. Dağıtım ve sürdürülebilirlik

### ⭐ 12. Proje katmanı için sürüm ve yükseltme yolu

**Sorun:** `team.json` içinde `version: 1` var, ama yükseltme yolu yok. Framework proje katmanının yapısını değiştirirse eski projeler bozulur ya da sessizce eski varsayımlarla çalışır.

**Öneri:**
- Ön kontrol, plugin'in desteklediği katman sürümünü projedekiyle karşılaştırır: eskiyse WARN ve yükseltme önerisi, desteklenmeyecek kadar eskiyse FAIL.
- `setup-project --upgrade`: yeni alanları ekler, eskileri taşır, eksik şablon dosyalarını tamamlar. Kullanıcı içeriğine dokunmaz ve değişiklikleri önce gösterir.
- Pre-commit hattı dosyalarının (`.githooks/`) plugin sürümüyle uyumu da kontrol edilir.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.6.0)

- **Bileşenler:** `LAYER_VERSION` = 2, `MIN_LAYER_VERSION` = 1 (`team-config.js`), `hooks/lib/layer.js` (göçler, durum, `.githooks` uyumu), `setup-project --upgrade`, ön kontrol satırları, `tests/hooks/layer.test.js`.
- **Kararlar:**
  - `version` alanı olmayan katman 1 sayılır (0.1.0).
  - Katman plugin'den yeniyse hata verilir: eski plugin, bilmediği bir şemayı yanlış yorumlamasın diye guard fail-closed engeller.
  - Eski katman hata değildir: yeni alanların varsayılanları zaten geriye uyumlu.
  - Göçler yalnızca ekler. Bir göç ileride bir alanı taşımak veya yeniden adlandırmak zorunda kalırsa eski değeri koruyup yenisini ekler ve değişikliği önizlemede gösterir.
- **Açık:** `.githooks` uyumu içerik karşılaştırmasıdır; elle değiştirilmiş hook da "farklı" görünür (uyarı metni bunu söyler).

### ⭐ 13. Profilleri ayrı plugin'ler olarak dağıtmak

**Sorun:** Hazır profiller çekirdeğin içinde. Profil sayısı arttıkça çekirdek şişer ve her profil güncellemesi çekirdek sürümünü gerektirir.

**Öneri:**
- Profilleri (ve madde 9'daki rol paketlerini) ayrı, küçük plugin'ler olarak aynı marketplace'ten dağıtmak: `agent-team-profile-dotnet`, `agent-team-profile-react-native-expo`, `agent-team-role-devops` …
- Yığına özgü skill'ler (ör. Expo skill'leri) ilgili profil plugin'iyle birlikte gelebilir; böylece proje reposuna elle kopyalamak gerekmez.
- Çekirdek yalnızca profil sözleşmesini (profil dosyasında hangi bölümler bulunur) ve arama sırasını tanımlar.

#### Uygulama durumu (2026-11-16): ✅ uygulandı (0.9.0), ayrı plugin dağıtımı ertelendi
- **Bileşenler:** profil şablonu (`templates/profile.md`), doğrulayıcı (`hooks/lib/profile.js`, `scripts/profile-check.js`), yeni profiller `backend/node`, `backend/python`, `web/aspnet-mvc`, geçersiz profil akışı (ön kontrol WARN, SessionStart sorusu, sandbox izni eklenmez), setup-project/onboard taslak profil adımı, `tests/hooks/profile.test.js`.
- **Kararlar:**
  - Profiller tek plugin'de kalır; kullanıcı istediğini seçer. Ayrı plugin'ler için çekirdeğin diğer plugin'lerin klasörünü bulmasının resmi bir yolu yok (önbellek yolu iç ayrıntı).
  - Hazır olmayan yığın için Claude şablondan **proje** profili üretir; plugin'e otomatik eklenmez (güncellemede kaybolur, incelenmemiştir). İyi profiller PR ile hazır profile dönüşür.
  - Geçersiz profilde kullanıcı seçer: Claude düzeltir ya da `"profile": null` ile profilsiz devam edilir.
- **Açık:** go, react (Vite) gibi diğer profiller ihtiyaç oldukça; rol paketleri (madde 9) için de aynı karar geçerli.

### 14. Örnek proje

**Sorun:** Yeni biri için en hızlı öğrenme yolu, katmanı doldurulmuş küçük bir örnek repoyu görmek; şu an yok.

**Öneri:** Proje katmanı doldurulmuş, birkaç sprintlik geçmişi olan küçük bir örnek repo (veya `examples/` altında bir klasör, plugin dışında): `project.md`, `team.json`, rol hafızaları, örnek SPRINT_PLAN ve STATUS, bir sprint dokümanı.

### ⭐ 15. Çekirdek prompt dili (İngilizce çekirdek + proje dili)

**Durum:** Ajan prompt'ları, TEAM_RULES ve şablonlar Türkçe. Bu, şu anki kullanıcı için doğru bir seçim.

**Öneri:** Framework başkalarıyla paylaşılacaksa çekirdek (ajanlar, TEAM_RULES, skill'ler, şablonlar) İngilizce yazılır; konuşma ve doküman dili yalnızca `project.md > Dil` alanından gelir (bu mekanizma zaten var). Türkçe şablonlar bir dil paketi olarak kalabilir.

**Karar gerektirir:** Bu bir vizyon kararıdır (kişisel framework mü, paylaşılan ürün mü?). Uygulamadan önce konuşulmalı.

---

## Önerilen uygulama sırası

| Sıra | Madde | Gerekçe |
|---|---|---|
| 1 | ⭐ 1. Kanıt kaydı | Kalite vaadini gerçekten zorlanabilir yapar; diğer kapılar (10) da bu kayda dayanabilir |
| 2 | ⭐ 9. Yapılandırılabilir roller | Çekirdeği gerçek bir framework yapar; 13'ün (rol paketleri) önkoşulu |
| 3 | ⭐ 4. onboard ✅ ve ⭐ 5. resume ✅ | Günlük kullanımdaki en büyük iki sürtünme |
| 4 | 2. Davranış testleri | Bundan sonraki her değişikliği güvenli yapar; 9'dan sonra kurulursa rolleri de kapsar |
| 5 | ⭐ 12. Katman sürümü ve yükseltme ✅ | 9 ve 11 `team.json` şemasını değiştireceği için, onlarla birlikte veya hemen önce |
| 6 | ⭐ 7. Özerklik ✅ ve ⭐ 11. Model seçimi ✅ | İkisi de `team.json` alanı ve lead davranışı; birlikte tasarlanabilir |
| 7 | ⭐ 10. Tasarım kapısı ✅ | Vizyonun "olağanüstü" kısmı; 1'deki kanıt kaydı ve Playwright MCP üzerine kurulur |
| 8 | ⭐ 13. Profil/rol paketleri ✅ | 9 ve 12 oturduktan sonra |
| 9 | ⭐ 15. Dil kararı | Paylaşım kararı verildiğinde; teknik olarak bağımsız |
| — | 3, 6, 8, 14 | Uygun bir sürümde, ilgili maddelerle birlikte |

Bağımlılıklar: 9 → 13; 12, 9 ile 11'den önce veya onlarla birlikte; 1 → 10; 6 ve 7 lead davranışını değiştirdiği için 2'deki davranış testleriyle doğrulanmalı.

Her madde için akış: tasarım (kapsam, `team.json` şeması, guard etkisi, açık sorular) → kullanıcı onayı → uygulama + testler → `plugin.json` sürümü ve `CHANGELOG.md` → burada ✅.
