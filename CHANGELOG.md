# Değişiklik günlüğü

Sürümler `plugin/.claude-plugin/plugin.json` içindeki `version` ile eşleşir. Sürüm artırılmadıkça kullanıcılar güncellemeyi almaz.

## 0.12.0 — 2026-11-17

Token tasarrufu. Canlı testte (24 saat, ağırlıklı) maliyetin dağılımı şöyleydi: ana oturum %29, backend %25, lead %23, web %19, tester %4,5. Türe göre: önbelleğe yazma %36, önbellekten okuma %35, çıkış %29. Hepsi birlikte tahmini tasarruf %30–40; ölçüm sonraki canlı koşuda yapılacak.

### Değişiklikler
1. **Kısa mesajlar, ucuz ana oturum** (tahmini −%15–17).
   - Mesaj ve raporlar en fazla ~10 satırdır; ayrıntı dosyaya yazılır, mesajda yolu verilir (TEAM_RULES > İletişim, tech-lead §0).
   - `/agent-team:team`, takım başlamadan ana oturum için Sonnet önerir ve uzun mesajı bağlama kopyalamaz.
   - PLUGIN.md §7.5.0: token tasarrufu.
2. **Göreve göre model** (tahmini −%9–11).
   - Yeni projelerde `models.roles` web ve tester için `sonnet`, `models.tasks.DOC` `sonnet` olur.
   - Yazılmış bir `models.roles` ya da `models.tasks` tablosu artık varsayılanla birleşmez, onun yerine geçer: `"roles": {}` ajan dosyalarındaki modeller demektir. Mevcut projelerin davranışı değişmez.
   - `plan.json > tasks[].model` isteğe bağlıdır. Plan kontrolü değeri doğrular; kritik görev `haiku`'ya verilirse uyarır. Değer kartta ve dilimde görünür.
   - lead, aynı rolün farklı modelli görevleri için `<rol>-<model>` adlı ayrı üye ister. lead Opus'ta kalır.
3. **Daha az başlangıç okuması** (tahmini −%8–10).
   - `plan.js slice --role <rol>`: rolün görev kartları ve bağlı görevlerin tek satırlık özeti.
   - Üyeler planın tamamı yerine dilimi okur. MyBlog'da web için 38 bin karakter yerine 9 bin karakter.
   - lead, planın iki biçiminden yalnızca birini okur.
   - Ajan dosyaları ile TEAM_RULES arasında birebir tekrar ölçüldü ve bulunmadı. Anlamca tekrar eden birkaç kural ajan başına 40–60 token tutuyor; davranışı pekiştirdikleri için korundu.
4. **Sessiz komutlar** (tahmini −%3–5).
   - Profillerdeki build/test/kurulum komutları az çıktı veren biçimde: `dotnet … -nologo -v q`, `vitest --reporter=dot`, `jest --silent`, `npm ci --no-audit --no-fund --loglevel=error`, `gradlew -q`, `xcodebuild -quiet`, `uv sync -q`. Test özeti ve exit kodu korunur.
   - TEAM_RULES: çıktı `| tail`/`| head` ile kesilmez (K1 exit kodunu bozar); dosyalar Read/Grep ile hedefli okunur.
   - Düzeltme: kanıt kaydı `pytest -q` özetini (`12 passed in 0.1s`, `=` işareti yok) ayrıştıramıyordu.
5. **`setup-project --roles`.**
   - Yalnızca seçilen rollerin `agents/<rol>/` klasörleri kurulur; seçilmeyenler `team.json`'a `"enabled": false` yazılır.
   - Sonradan açılan rol için kurulum yeniden çalıştırılınca eksik klasör eklenir. Kuru çalıştırma da yalnızca seçilenleri listeler.
   - setup-project ve onboard skill'leri kullanıcının cevabını bu parametreye çevirir. Onboard'da tarama artık kurulumdan önce yapılır.
   - Canlı testte backend ve web seçilmişken mobile klasörü de kuruluyordu.
6. **README §4.1 "Takım çalışırken neyi nereden izlersiniz"**: mesajlar, görevler (`~/.claude/tasks/`), STATUS panosu, plan dilimi, worklog'lar, kararlar, sözleşme ve test, tasarım incelemeleri, kanıt kaydı, kullanım raporu, retro, ham kayıtlar.

## 0.11.6 — 2026-11-17

### Güvenlik düzeltmesi
- Guard, yorumlayıcı içinden yapılan yazmaları görmüyordu: `python -c "open('web/x','w')"`, `node -e "fs.writeFileSync(...)"` veya heredoc'la beslenen betik başka rolün alanına yazabiliyordu (native Windows'ta sandbox yok). Komutta yorumlayıcı ve yazma çağrısı varsa yazma çağrısının yol argümanları denetlenir; yol değişkenden geliyorsa betikteki tüm yol dizgileri hedef sayılır (fail-closed). TEAM_RULES: dosya Write/Edit ile yazılır.

## 0.11.5 — 2026-11-17

### Düzeltme
- Ön kontrol: Playwright MCP'nin kendi `playwright-core`'unun istediği Chromium revizyonunu (npx önbelleğindeki `browsers.json`) okur ve kurulu olup olmadığına bakar. Kurulu Chromium başka revizyondaysa MCP başlıyor ama tarayıcı açılamıyordu; tasarım kapısı ve E2E sessizce çalışmıyordu. Eksikse WARN ve kurulum komutu verir (indirme kullanıcı onayıyla). `lib/browser.mcpChromium`.

## 0.11.4 — 2026-11-17

### Güvenlik düzeltmesi
- Guard, Bash/PowerShell komutu içindeki dizin değişikliğini (`cd`, `pushd`, `Set-Location`, `sl`, `chdir`) izlemiyordu: `cd web && echo x > a.txt` başka rolün alanına yazabiliyordu. Göreli hedefler artık `cd` zincirine göre çözülür; alt kabuk ayırt edilemediği için başlangıç dizinine göre de denetlenir. Hedefi çözülemeyen `cd` (`cd $D`, `cd -`) sonrasındaki göreli yazmalar fail-closed engellenir.

### Düzeltme
- `TaskCompleted`: `STATUS.md` görev tablosunda satırı olmayan görev kapanınca satır ve sayaçlar kayboluyordu; artık satır eklenir ("hook ekledi"). K1 engel mesajı, kapanışla aynı çağrıda gönderilen açıklamanın kontrole ulaşmadığını açıkça söyler (canlı testte ajan bir tur kaybetti).
- Ön kontrol: Playwright MCP sunucusunu gerçekten başlatır. Bozuk npx önbelleği (ilk indirme MCP zaman aşımında kesilince oluşur; sunucu her açılışta çöker) için klasör yolunu ve onarımı, yavaş ilk başlatma için `MCP_TIMEOUT` önerisini verir.
- Ön kontrol: backend guard probu yasak yol olarak devre dışı rolün (`mobile/`) yolunu seçiyordu; artık etkin bir rolün (web, mobile) yolunu kullanır.

Canlı test kaydı: `tests/live/2026-11-17-myblog.md`.

## 0.11.3 — 2026-11-17

### Düzeltme (kritik)
- Claude Code v2.1.268+ görev araçlarını (TaskCreate/TaskUpdate/TaskList/TaskGet) yalnızca Opus 4.7, Sonnet 4.6, Haiku 4.5 ve daha eski modellerde varsayılan verir; Claude 5 modellerinde `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` gerekir. Framework bunu denetlemiyordu: canlı testte lead ve teammate'lerde görev araçları yoktu, görev açılamadı, `TaskCompleted` kanıt kapısı ve `STATUS.md` hiç çalışmadı.
- Ön kontrol artık değişkeni ortamda ve settings dosyalarında arar; yoksa FAIL verir ve ne ekleneceğini söyler. PLUGIN.md §2 kullanıcı ayarına eklendi; README ve `/agent-team:team` güncellendi.

## 0.11.2 — 2026-11-17

### Güvenlik düzeltmesi (kritik)
- Guard, agent teams teammate'lerini tanımıyordu. Teammate'in hook girdisinde `agent_type` ajan tipi değil teammate **adıdır** (`backend`, `lead`, `tester-test`). Eşleşme yalnızca ajan tipine göre yapıldığından teammate "takım dışı agent" sayılıyor ve yetki kuralları hiç uygulanmıyordu (canlı testte backend, web'in klasörüne yazabildi). Artık ad bir role eşitse veya `<rol>-` ile başlıyorsa o rolün kuralları uygulanır (`team-config.roleFromTeammateName`); özel roller rol anahtarıyla eşleşir.
- Ön kontrol guard probunu hem ajan tipiyle hem teammate adıyla çalıştırır; bu açık artık ön kontrolde FAIL olarak görünür.

## 0.11.1 — 2026-11-17

### Düzeltme
- Ön kontrol: `project.md` şablonunun açıklama satırındaki `` `<doldur>` `` ifadesi boş alan sayılıyordu; tüm alanlar doldurulsa da uyarı kalkmıyordu. Ters tırnak içindeki ifade artık sayılmıyor ve uyarı boş kalan satır numaralarını gösteriyor. İlk canlı kurulum testinde (Windows) bulundu.

## 0.11.0 — 2026-11-16

**Katman sürümü 5.** `setup-project --upgrade` `plan.example.json` (0.10.0'da yalnızca yeni kurulumlara geliyordu) ve retro şablonunu ekler.

### Retrospektif ve öğrenme döngüsü (MustToHave madde 8)
- lead sprint kapanışında (§4.9) `Docs/Project/retros/S<n>.md` yazar: veriler (team-status sayaçları, kanıt kaydı, worklog'lar), iyi gidenler, kök nedenli aksaklıklar, dersler.
- **Projeye ait dersler** `rules.md` / rol `MEMORY.md` önerisi olarak yazılır; lead bu dosyalara yazamadığı için kullanıcı onayıyla ana oturum uygular.
- **Framework'e ait dersler** projeye özgü bilgi içermeyen issue taslağıdır. Yeni `/agent-team:retro` skill'i taslağı gizlilik açısından denetler ve kullanıcı onaylarsa `gh issue create` ile plugin reposuna gönderir. Onaysız hiçbir şey dışarı gitmez.
- `[DONE]` mesajı retro dosyasının yolunu içerir.

## 0.10.0 — 2026-11-16

### Makine okunur plan ve otomatik plan kontrolü (MustToHave madde 6)
- Planın tek kaynağı `Docs/Project/plan.json` (örnek: `plan.example.json`, setup-project kopyalar). `SPRINT_PLAN.md`'nin kapsam matrisi, Mermaid grafiği, dalga tablosu ve görev kartları `scripts/plan.js render` ile işaretler arasına üretilir; işaretler dışındaki serbest metin korunur.
- `scripts/plan.js check` (`hooks/lib/plan.js`): döngüsel bağımlılık, sahipsiz görev, kapalı/bilinmeyen role atanmış görev, bitti kriteri olmayan veya ölçülemeyen görev, bitti kriterinde bitmeyen komut (K5; `timeout`'lu komut serbest), story'siz görev, karşılıksız kapsam maddesi, bağımlılıkla çelişen dalga. Dalgalar hard bağımlılıklardan hesaplanır.
- tech-lead: plan yalnızca `plan.json`'a yazılır; `[PLAN-APPROVAL]` öncesi `check` zorunlu, hata varsa onaya sunulmaz, uyarılar mesaja eklenir.

Testler: 214 → 220.

## 0.9.0 — 2026-11-16

### Profil sözleşmesi ve yeni profiller (MustToHave madde 13)
- **Yeni profiller:** `backend/node` (Node.js + TypeScript, Fastify), `backend/python` (uv, FastAPI, SQLAlchemy), `web/aspnet-mvc` (ASP.NET Core MVC / Razor Pages). `onboard-scan` Node/Python backend'i ve `Views/`/`Pages/` içeren ASP.NET projesini bu profillere eşler.
- **Profil şablonu ve doğrulayıcı:** `templates/profile.md`, `hooks/lib/profile.js`, `scripts/profile-check.js`. Zorunlu bölümler: başlık, Yığın, Konvansiyonlar, Komutlar (tablo), Test, Ağ izinleri, DoD. `web/nextjs`'e eksik `## Test` bölümü eklendi.
- **Geçersiz profil sistemi durdurmaz:** sandbox'a ağ izni eklemez, ön kontrol WARN verir. SessionStart'ta ana oturum kullanıcıya sorar: düzeltilsin mi, yoksa `"profile": null` ile profilsiz mi devam edilsin?
- **Hazır profil yoksa:** `setup-project` / `onboard` onayla şablondan proje profili taslağı üretir (`AdditionalAgentInformation/profiles/`), doğrular, komutları çalıştırarak kontrol eder.
- **Dağıtım kararı:** profiller şimdilik çekirdek plugin'de kalır. Ayrı plugin'ler, çekirdeğin başka bir plugin'in klasörünü bulması için resmi bir yol olmadığından ertelendi; proje profilleri bu ihtiyacı karşılıyor.

Testler: 206 → 214.

## 0.8.1 — 2026-11-16

### Playwright Chromium tespiti
- Yeni `hooks/lib/browser.js` (ön kontrol ve SessionStart ortak kullanır).
- SessionStart: proje katmanı varken Chromium yoksa kullanıcıya tek satırlık uyarı (`systemMessage`); ana oturum kurulumu bir kez önerir, onaysız indirmez.
- `setup-project` ve `onboard`: ön kontrol Chromium yok derse kuruluma onay sorulur.
- Plugin tarayıcıyı kendiliğinden indirmez (kurulum anında kod çalıştırma yok; ~150 MB onaysız indirilmez).

## 0.8.0 — 2026-11-16

**Katman sürümü 4.** `setup-project --upgrade` `design` alanını ve inceleme şablonunu ekler.

### Tasarım kapısı (MustToHave madde 10)
- Yeni kural TEAM_RULES **K8**. lead ekran görevlerine `UI: evet` yazar. Sahibi şunları yapar:
  - `team.json > design.variants`'taki her varyantın ekran görüntüsünü alır (web: Playwright MCP; mobil: Expo web, emülatör veya golden test);
  - `_TEMPLATE.md` ile tasarım ADR'sine göre puanlı bir inceleme yazar (`impeccable critique`);
  - görevi `Tasarım: <dosya>` satırıyla kapatır.
- Yeni `hooks/lib/design.js`, TaskCompleted entegrasyonu. Denetlenenler: inceleme dosyası, ADR referansı, `Puan: N/10` ≥ `minScore`, her varyantın görüntü dosyası. İşaretlenmemiş kontrol maddesi uyarıdır.
- Modlar: `design.gate` `warn` (varsayılan: kapanır, `STATUS.md`'de `⚠️ Tasarım`, team-status'ta `design=N`, ajana/lead'e/kullanıcıya uyarı), `enforce` (engeller), `off`.
- lead incelemeyi açıp kabul eder (hook güzelliği değil adımları denetler). Web ve mobile ajanlarının süreci ve DoD'u güncellendi.
- Ön kontrol kapı ayarını, şablonun varlığını ve **Playwright Chromium**'un kurulu olup olmadığını gösterir.

### Playwright MCP
- `.mcp.json`: `--browser chromium`. Canlı denemede varsayılan Chrome kanalının sistem genelinde `/opt/google/chrome` istediği ve kurulu olmadığında hiçbir tarayıcı aracının çalışmadığı görüldü. Playwright'ın Chromium'u sudo gerektirmeden `npx playwright install chromium` ile kurulur.
- PLUGIN.md: gereksinim satırı ve teammate'ler için `mcp__plugin_agent-team_playwright` izni.

### Eval düzeltmesi
- `evidence-id` vakasının "exit 0" grader'ı test çıktısındaki `exit=0` metnine eşleşip yanlış pozitif veriyordu. Gerçekte `claude plugin eval` sandbox'ında Bash aracı her çağrıda exit 1 dönüyor (salt okunur `$TMPDIR`'a cwd takip dosyası yazılamıyor). Gerçek sandbox'ta bu olmuyor; aynı komutlar exit 0 kaydedildi. Grader'lar hook'un kimlik satırını hedefliyor; sorun `evals/README.md > Bilinen sorunlar`'da.

Testler: 197 → 205.

## 0.7.0 — 2026-11-16

**Katman sürümü 3.** `setup-project --upgrade` `autonomy` ve `models` alanlarını ekler; eklenmese de varsayılanlarla çalışır.

### Özerklik düzeyi (MustToHave madde 7)
- `team.json > autonomy`: `supervised` · `checkpoint` (varsayılan) · `autonomous`. lead'in ne zaman durup soracağı tech-lead.md §0.1'de tablolandı. Kritik karar tanımlandı. Plan onayı ve commit/push/deploy/sistem kurulumu her düzeyde kullanıcıdadır.
- SessionStart ve ön kontrol düzeyi gösterir; `autonomous` ön kontrolde WARN verir. team skill'i, `[STATUS]` mesajlarının hangi düzeyde bilgilendirme olduğunu bilir.

### Görev tipine göre model seçimi (MustToHave madde 11)
- `team.json > models`: `roles.<rol>` teammate'in spawn modelidir. `tasks.<ETİKET>` mekanik işler için ayrı üye açarken kullanılır. Değerler doğrulanır; tanımsız role model verilemez.
- lead `[SPAWN-REQUEST]`'e `model:` satırı yazar; ana oturum Agent aracının `model` parametresiyle başlatır (ajan dosyasındaki modeli ezer).
- Yeni `scripts/usage-report.js`: transcript'lerden model ve rol bazında token raporu (aynı yanıt bir kez sayılır, Claude Code iç mesajları ayıklanır). lead kapanışta raporu ve `models` önerisini ekler.

### Doğrulama
- Yeni L2 vakaları `lead-wave-supervised` ve `lead-model-spawn`. Aynı kurgu ve prompt, yalnızca `autonomy` farklı: `supervised`'da lead onay istedi, `checkpoint`'te W2'yi başlattı ve tester'ı sonnet ile istedi (3/3 oy, ≈ $0.55'er).
- İlk denemede vaka kurgusu kanıtsızdı (kod, sözleşme ve kanıt yoktu). lead K1 gereği işi kabul etmedi; kurgu düzeltildi.
- Testler: 191 → 197.

## 0.6.0 — 2026-11-16

**Katman sürümü 2.** 0.1.0 ile kurulmuş projeler çalışmaya devam eder, ama `setup-project --upgrade` ile yükseltilmeleri önerilir.

### Proje katmanı sürümü ve yükseltme yolu (MustToHave madde 12)
- `team.json > version` artık doğrulanıyor (alan yoksa 1 sayılır):
  - plugin'in desteklediğinden yeni sürüm hata verir ve guard takım rollerini engeller;
  - desteklenmeyecek kadar eski sürüm hata verir;
  - eski ama desteklenen sürüm yalnızca uyarı verir.
- Yeni `hooks/lib/layer.js`: sürüm durumu, göç zinciri (v1 → v2: `evidence`, `sandbox`, STATUS `unverified`), `.githooks` uyumu.
- `setup-project --upgrade` (`--dry-run` ile önizleme): yalnızca eksik alanları ekler, kullanıcı değerlerine dokunmaz. Eski katmanda bayraksız çalıştırılırsa yalnızca uyarır.
- Ön kontrol ve kurulum, katman sürümünü ve plugin şablonundan farklı `.githooks` dosyalarını bildirir.
- Şablon ve varsayılan `team.json`: `version: 2`.
- PLUGIN.md §3.3 (yükseltme ve sürüm tablosu), setup-project skill'i güncellendi. Testler: 184 → 191.

## 0.5.0 — 2026-11-16

### `/agent-team:resume`: kesintiden sonra devam (MustToHave madde 5)
- Yeni `scripts/resume-status.js`, dosya değiştirmez. Devam özetinin kaynakları:
  - `STATUS.md`: team-status, bitmemiş/kanıtsız görevler, "kim ne yapıyor", "yeniden başlatma için", bloklar, sonraki adım;
  - `SPRINT_PLAN.md` > Ana hedef;
  - rollerin son worklog girişi;
  - kanıt kaydındaki son komutlar ve açık kalmış olabilecek arka plan süreçleri;
  - Claude Code görev listesi (`~/.claude/tasks/`, görev kodlarıyla projeye eşlenir; en iyi çaba);
  - sahibine göre gruplanmış commit'lenmemiş değişiklikler;
  - yeniden başlatılması önerilen roller.
- Yeni skill `/agent-team:resume`; lead'e devam modu (tech-lead.md §4.11): yeni plan yok, görev listesi onarımı, yarım işin değerlendirmesi, yalnızca gereken üyelerin başlatılması, arka plan süreçleri için kullanıcıya soru.
- `/agent-team:team` kesinti durumunda resume'a yönlendirir. PLUGIN.md §7.6 ve README güncellendi.
- Yeni L2 vakası `evals/full/lead-resume` (ilk koşu 3/3 oy, ≈ $0.65). Testler: 180 → 184.

## 0.4.0 — 2026-11-16

### `/agent-team:onboard`: var olan repoya takım (MustToHave madde 4)
- Yeni `scripts/onboard-scan.js`, komut çalıştırmaz. Tespit ettikleri:
  - uygulamalar: Node (Next.js, Expo/React Native, Express/Nest/Fastify…, Vite/React/Vue…), .NET (Web SDK, MAUI; test projeleri ayıklanır), Flutter (saf Dart paketleri ayıklanır), yerel Android, iOS, Go, Python (FastAPI/Django/Flask), Rust;
  - lock dosyasından paket yöneticisi ve kurulum komutu;
  - script'lerden build/test/lint komutları; watch/sunucu script'leri için K2/K5 uyarısı;
  - sahiplik yolları: kökteki uygulama için kaynak klasörleri; sözleşme ve ADR yolu; mevcut dokümanlar.

  Her bulgu "tespit" veya "tahmin" olarak işaretlenir.
- `--write`: `team.json`/`project.md` şablondan değiştirilmemişse günceller, değiştirilmişse `.draft` yazar. Klasör adları gerçek harf yazımıyla karşılaştırılır (Windows/macOS'ta `docs/adr` ile `Docs/ADR` karışmaz).
- Yeni skill `/agent-team:onboard`: kurulum → tarama → onay → taslak → komut doğrulama (K1) → sandbox izinleri ve ön kontrol.
- SessionStart, proje katmanı yokken kodu olan repolar için onboard'u önerir.
- PLUGIN.md §4.1, skills/README ve README güncellendi. Testler: 175 → 180.

## 0.3.0 — 2026-11-16

### Yapılandırmadan tanımlanabilir roller (MustToHave madde 9)
- `team.json > roles` artık yerleşik beş rolün yanında özel roller tanımlar: `{ agent, kind, paths, enabled?, profile?, description? }`. `kind`: `developer` (yolların sahibi), `reviewer`, `docs`, `allowlist` (yalnızca verilen yollar).
- Doğrulama: rol adı biçimi ve ayrılmış adlar, zorunlu alanlar, bilinmeyen anahtarlar, yerleşik ajanın veya aynı ajanın tekrar kullanılması, geliştirici rolleri arasında **sahiplik çakışması**, yerleşik rolün `agent`/`kind` değerinin değiştirilmesi.
- Guard: özel roller yapılandırmadan tanınır. `developer` türü yerleşik geliştiricilerle aynı sahiplik kurallarına girer; diğer türler yalnızca kendi yollarına yazar. Tüm genel kurallar geçerlidir. `team.json` bozukken adı dosyada geçen agent fail-closed engellenir; ilgisiz agent'lar etkilenmez.
- SessionStart eşlemesi özel rolleri listeler. SubagentStart, özel role rolünü, yetkilerini ve `TEAM_RULES.md`'nin mutlak yolunu bağlam olarak verir (proje ajanlarında `${CLAUDE_PLUGIN_ROOT}` çözülmediği için).
- Kanıt kaydı özel rollerin komutlarını kaydeder; görev kapısı `[<ROL-ADI>] S<n>-<m>` etiketli `developer` görevlerini doğrular, `[FIX]` özel geliştiricileri de kabul eder.
- Ön kontrol: özel rolün ajan dosyası (yoksa FAIL), `disallowedTools: Agent`, TEAM_RULES ve hafıza klasörü referansı; gerçek hook girdisiyle yasak/serbest guard denemesi.
- Yeni şablon: `templates/agents/custom-role.md`. lead, team skill'i, TEAM_RULES, PLUGIN.md (§5.1) ve README güncellendi.
- Canlı doğrulama (WSL2): proje ajanı olarak tanımlanan `docs` rolü `src/` yazamadı, `docs-site/` yazdı; SubagentStart bağlamı ajana ulaştı.
- Testler: 166 → 175.

## 0.2.0 — 2026-11-16

Kalite vaadini ölçülebilir yapan sürüm: kanıt kaydı, sandbox ikinci savunma katmanı ve ajan davranış testleri.

### Güvenlik düzeltmesi: temp altındaki projeler
- Guard, "OS temp serbest" kuralını proje içi kurallardan önce uyguluyordu. `/tmp` (veya OS temp) altında açılan bir projede takım rollerinin tüm yazma kuralları devre dışı kalıyordu. Eval denemesinde bulundu: backend `mobile/` klasörüne yazabildi. Artık temp serbestliği yalnızca **proje dışındaki** yollar için geçerli; regresyon testi eklendi.

### Kanıt kaydı (MustToHave madde 1, `warn` modu)
- Yeni `hooks/ledger-record.js` (PostToolUse / PostToolUseFailure): takım rollerinin her Bash/PowerShell komutu proje dışındaki hash zincirli kayda yazılır (`${CLAUDE_PLUGIN_DATA}/ledger/<proje>/<agent>.jsonl`). Ajan araç sonucunda `Kanıt: L-xxxxxxxx (exit 0, …)` satırını görür. Çıktının yalnızca maskeli son 2 KB'ı ve SHA-256'sı saklanır; 30 günden eski kayıtlar silinir.
- `task-completed.js`: `Kanıt: L-…` atıflarını doğrular: kayıtta var, zincir sağlam, rol ve agent tutuyor, exit 0, arka plan değil, `maxAgeHours` içinde, başka görevde kullanılmamış. `Sonuç:` sayıları çıktıdaki test özetiyle karşılaştırılır (yalnızca uyarı).
- `team.json > evidence`: `warn` (varsayılan: kapanış engellenmez; ajana, lead'e ve kullanıcıya **KANITSIZ KAPANIŞ** uyarısı; `STATUS.md`'de `⚠️ Kanıtsız`, team-status'ta `unverified=N`), `enforce` (engeller), `strict` (+ yalnızca `project.md > Komutlar` komutları). `maxAgeHours` varsayılanı 24.
- Yeni `scripts/ledger.js`: `show`, `list`, `verify`, `export`, `prune`, `path`.
- Guard: ajanların plugin veri dizinine (kanıt kaydı, agent kaydı) komutla erişimi engellendi.
- TEAM_RULES K1'e `Kanıt:` satırı ve kapanış doğrulaması; K2: kanıt komutları ön planda (gerekirse 10 dk zaman aşımı), arka plan kanıt üretmez, sandbox hatalarında yeniden deneme yerine `[BLOCKED]`. Ajan DoD'ları ve lead'in kanıt kuralı güncellendi.
- Ön kontrol kanıt modunu gösterir; `STATUS.md` şablonuna `unverified=0`, `team.json` şablonuna `evidence` eklendi.
- Testler: 124 → 155.

### Sandbox ikinci savunma katmanı (MustToHave madde 3)
- Yeni `hooks/lib/sandbox.js`: profillerden ağ izinlerini toplar, `.claude/settings.json`'a birleştirir, etkin ayarı (kullanıcı < proje < yerel) ve platform/bağımlılık durumunu hesaplar.
- `setup-project`: macOS, Linux ve WSL2'de sandbox'ı varsayılan olarak açar (`enabled`, `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: true` + ağ izinleri). Var olan anahtarı ezmez, listeleri birleştirir, bozuk dosyaya dokunmaz. `--no-sandbox` atlar; native Windows'ta yalnızca `--sandbox` ile yazar. Eksik `bwrap`/`socat` için dağıtıma uygun kurulum komutunu gösterir. Dry-run artık ön kontrolü çalıştırmıyor (yazılmamış dosyalar için yanıltıcı FAIL veriyordu).
- Her yerleşik profile ve `profiles/tester/README.md`'ye "Ağ izinleri (sandbox)" bölümü; profil yazma kuralına zorunlu bölüm olarak eklendi.
- `team.json > sandbox.allowedDomains` (doğrulanır; şablonda boş).
- Ön kontrol: platform, sandbox etkinliği, bağımlılıklar, `allowUnsandboxedCommands`, boş/eksik ağ izinleri, sandbox dışı komutlar.
- Canlı doğrulama (WSL2): proje ayarıyla `$HOME`'a yazma engellendi; `settings.local.json > sandbox.enabled: false` kişisel olarak kapatıyor.
- Testler: 155 → 164.

### Ajan davranış testleri (MustToHave madde 2)
- Yeni `evals/` (plugin dışında): `smoke/` (L1, 6 vaka, deterministik grader'lar, eşik 1.0, tavan $5) ve `full/` (L2, 3 vaka, `llm` grader'lar, eşik 0.8, tavan $25). Çalıştırıcı: `evals/run.sh smoke|full`.
- Ortak kurulum (`evals/lib/scaffold.sh`) proje katmanını framework'ün kendi `setup-project.js`'iyle kurar.
- Ölçülen: yönlendirme (takım işi / küçük iş), guard (backend → mobile, lead → kaynak kod), proje katmanının okunması, kanıt kimliği, lead planı (ana hedef, kapsam matrisi, tasarım kararı, plan onayı), sözleşme önce, tester'ın kırık testte "go" vermemesi.
- İlk koşu (WSL2, Claude Code 2.1.322): smoke 6/6 (≈ $1.4), full 3/3 tek koşuda (≈ $2.1).
- `.github/workflows/agent-team-evals.yml`: elle tetiklenen eval iş akışı (`ANTHROPIC_API_KEY` secret'ı).
- L0: eval klasörünün bütünlük testi. Testler: 164 → 166.

## 0.1.0 — 2026-11-16

İlk framework sürümü: agent-team, proje içi `.claude/` kopyasından generic bir Claude Code plugin'ine ve marketplace'e dönüştürüldü.

### Mimari
- Repo bir marketplace oldu (`.claude-plugin/marketplace.json`); kurulan plugin `plugin/` klasörü.
- Proje katmanı: ürün reposunda `AdditionalAgentInformation/` (`project.md`, `rules.md`, `team.json`, `agents/<rol>/{instructions,MEMORY,WORKLOG}.md`, isteğe bağlı `profiles/`).
- Yığın profilleri: `backend/dotnet`, `mobile/flutter`, `mobile/react-native-expo`, `mobile/native`, `web/nextjs`. Ajanlardaki yığına özgü içerik profillere taşındı.
- Ajanlar generic hale getirildi: `tools:` allowlist'i, `memory:` ve frontmatter `hooks:` kaldırıldı; `disallowedTools: Agent` eklendi. Dil tercihi `project.md`'den okunuyor.

### Guard ve hook'lar
- Guard plugin `hooks.json` PreToolUse hook'u oldu; rol hook girdisindeki `agent_type`'tan, yoksa SubagentStart kaydından belirleniyor. Türü bilinmeyen agent fail-closed.
- Alan sahipliği, yollar ve ek korumalı yollar `team.json`'dan; bozuk `team.json` takım rollerini engeller.
- Yeni kurallar: `AdditionalAgentInformation/` koruması (rol yalnızca kendi klasörü), `.mcp.json` koruması, alt agent (`Agent`) yasağı, Claude plugin/MCP değişikliği yasağı.
- `guard.sh` yalnızca kabuk yerleşikleriyle çalışıyor (PATH bozuk olsa bile karar verir) ve Windows yollarını destekliyor.
- SessionStart: ana oturuma yönlendirme kuralları, takım eşlemesi, dil ve proje katmanı durumu.
- TaskCompleted: K1 kanıtı olmadan geliştirme görevi kapanmıyor; `STATUS.md` otomatik güncelleniyor.
- TeammateIdle: lead `[QUESTION]`, `[PLAN-APPROVAL]`, `[BLOCKED]` veya `[DONE]` gönderdiğinde bildirim.

### Betikler ve skill'ler
- `scripts/team-preflight.js`: plugin ajanları, proje katmanı, profiller, gerçek hook girdisiyle guard denemeleri, ayarlar.
- `scripts/setup-project.js` ve `/agent-team:setup-project`: proje katmanını, doküman şablonlarını ve isteğe bağlı pre-commit hattını kurar; üzerine yazmaz, framework reposuna kurulmayı reddeder.
- `/agent-team:team`: plugin agent tipleriyle spawn eşlemesi.
- Pre-commit hattı şablon oldu (`templates/githooks/`); `agent-team:precommit-lead` çağırıyor, önbellek betiği projenin `.githooks/` klasöründe.
- Yığına özgü Expo/React Native skill'leri framework'ten çıkarıldı; `profiles/mobile/react-native-expo.md` içinde proje skill'i önerisi olarak duruyorlar.

### Doğrulama
- 124 otomatik test (guard, görev kapısı, kurulum, ön kontrol, plugin bütünlüğü); Windows ve WSL'de geçiyor.
- `claude plugin validate` plugin ve marketplace için geçiyor.
- Canlı: `--plugin-dir` ile plugin yükleme ve SessionStart bağlamı; plugin subagent'ında guard engellemesi (backend → `mobile/` engellendi, `backend/` serbest).

### Bilinen açık doğrulamalar
- Agent team teammate'lerinde guard (`agent_type` / kayıt) etkileşimli bir oturumda doğrulanmalı (PLUGIN.md > Bölüm 8).
- Framework lisansı henüz seçilmedi.
