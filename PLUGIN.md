# PLUGIN.md: agent-team'i bir projeye bağlama

Bu rehber, agent-team çekirdeğini (plugin) bir ürün reposuna **kopyalamadan** bağlamayı, proje katmanını kurmayı ve hook/guard'ın doğru çalışması için yapılması gerekenleri anlatır. Framework'ün nasıl çalıştığı: [README.md](README.md).

---

## 1. Gereksinimler

| Gereksinim | Neden | Not |
|---|---|---|
| Claude Code **2.1.281+** (test edildi: 2.1.319 Windows, 2.1.322 WSL) | Plugin hook'ları, `agent_type` hook alanı, TaskCompleted/TeammateIdle, `claude plugin validate` | `claude --version` |
| **Node.js 20+** (22+ önerilir) | Guard, hook'lar, ön kontrol ve kurulum betikleri | `node` hook kabuğunun PATH'inde olmalı. WSL'de Windows Node'u değil Linux Node'u kullanılır |
| **sh** | Hook komutları `sh` ile çalışır | Windows'ta **Git Bash** gerekir; yoksa Claude Code hook'ları PowerShell'le çalıştırır ve guard çalışamaz |
| **git** | Kurulum, pre-commit hattı | |
| python3 (isteğe bağlı) | `supply-chain-risk-auditor`, `ui-ux-pro-max` skill'leri | |
| **Playwright Chromium** (önerilir) | Plugin'in Playwright MCP sunucusu (`--browser chromium`): tasarım kapısı ekran görüntüleri (K8), tester E2E, lead URL incelemesi | `npx playwright install chromium` (sudo gerekmez, kullanıcı önbelleğine iner). Linux/WSL'de sistem kütüphaneleri eksikse `sudo npx playwright install-deps chromium`. Ön kontrol yokluğunu WARN olarak gösterir. |
| tmux (isteğe bağlı) | `teammateMode: "tmux"` ile teammate'leri ayrı panelde görmek | Yoksa teammate'ler in-process çalışır |

Önerilen ortam: macOS, Linux veya WSL. WSL'de projeyi Linux dosya sisteminde açın (`~/repos/...`); `/mnt/c` üzerinde npm ve test komutları çok yavaşlar (ön kontrol uyarır).

### 1.1 Sandbox kurulumu (önerilir)

Sandbox, takımın Bash komutlarını işletim sistemi düzeyinde sınırlar: proje klasörü ve temp dışına yazma engellenir, ağ erişimi yalnızca izin verilen alan adlarına açılır. Guard'ın yerine geçmez, onu tamamlar. Guard dosya araçlarını ve komut niyetini denetler; sandbox ise guard'ın çözemediği durumları kapatır (ör. `echo x > $HOME/...` gibi değişkenli yollar). Kanıt kaydını ajanların kurcalayamamasını da güvenceye alır.

| Platform | Gerekenler | Kurulum |
|---|---|---|
| macOS | Yerleşik (Seatbelt) | Ek kurulum yok |
| Ubuntu / Debian / **WSL2 (Ubuntu)** | `bubblewrap`, `socat` | `sudo apt install -y bubblewrap socat` |
| Fedora / RHEL | `bubblewrap`, `socat` | `sudo dnf install -y bubblewrap socat` |
| Arch | `bubblewrap`, `socat` | `sudo pacman -S bubblewrap socat` |
| Windows (native) | **Desteklenmiyor** | Komutlar sandbox'sız çalışır. Projeyi WSL2 içinde açın ve yukarıdaki Ubuntu adımını uygulayın. |

**Kurulumu doğrulama:**
```sh
command -v bwrap socat        # Linux / WSL2: iki yol da görünmeli
```
Claude Code içinde `/sandbox` komutu sandbox'ın durumunu gösterir. Bağımlılık eksikken sandbox açılmaya çalışılırsa Claude Code oturum başında şu uyarıyı verir ve komutları **sandbox'sız** çalıştırır:
```
⚠ Sandbox disabled: sandbox is enabled but dependencies are missing: socat not installed
```
Bu uyarıyı görürseniz eksik paketi kurup oturumu yeniden başlatın.

**Projede açma:** Sandbox ayarı proje dosyası `.claude/settings.json` içindedir. Plugin bu ayarı kendisi yapamaz. **`setup-project` macOS, Linux ve WSL2'de sandbox'ı varsayılan olarak açar:** aşağıdaki bloğu ve seçili profillerin "Ağ izinleri" listesini dosyaya **birleştirir**. Var olan anahtarlar ezilmez (farklı değerler özette `=` ile gösterilir), listelere yalnızca eksik alan adları eklenir, dosya bozuksa dokunulmaz. `--no-sandbox` bu adımı atlar. Native Windows'ta açmaz; `--sandbox` verilirse ayarı yine de yazar (repo WSL2'de de açılıyorsa yararlıdır). Profil veya `team.json > sandbox.allowedDomains` değiştikten sonra `setup-project`'i yeniden çalıştırmak eksik alan adlarını ekler. Elle yazmak isterseniz asgari ayar:
```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "autoAllowBashIfSandboxed": true,
    "network": { "allowedDomains": ["github.com", "registry.npmjs.org", "*.npmjs.org"] }
  }
}
```
- `allowUnsandboxedCommands: false`: engellenen bir komut sandbox dışında yeniden denenmez.
- `autoAllowBashIfSandboxed: true`: sandbox içindeki komutlar izin sormadan çalışır. Teammate izin istekleri ciddi ölçüde azalır; guard her çağrıda yine çalışır.
- `network.allowedDomains`: liste **boş başlar**. Listede olmayan bir alan adına bağlanan komut varsayılan izin modunda **izin ister** (teammate'lerde bu istek ana oturuma düşer); `dontAsk` modunda veya `strictAllowlist: true` ile reddedilir. Yığına göre gereken alan adları profillerin "Ağ izinleri" bölümündedir; projeye özel olanlar (iç registry, özel NuGet beslemesi, test ortamı) `team.json > sandbox.allowedDomains`'e yazılır. `*.ornek.com` alt alan adlarını kapsar; ana alan adı için ayrıca `ornek.com` yazın. Listeler kullanıcı, proje ve yerel ayarlar arasında birleşir.
- Sandbox açıkken engellenen yazma işlemi `Read-only file system` hatası olarak görünür. Bu bir sandbox sınırıdır; gerçekten gerekiyorsa ilgili yolu `sandbox.filesystem.allowWrite` ile siz açarsınız.
- Sandbox proje genelindedir ve sizin ana oturumunuzu da kapsar. Kişisel olarak kapatmak için `.claude/settings.local.json` içinde `"sandbox": { "enabled": false }` (WSL2'de doğrulandı: yerel `false`, projedeki `true`'yu geçersiz kılar). Ön kontrol bu durumu WARN olarak gösterir.
- **Ön kontrol** (`team-preflight.js`) şunları denetler: platform destekliyor mu; sandbox etkin mi; Linux/WSL2'de `bwrap` ve `socat` var mı (yoksa dağıtıma uygun kurulum komutunu gösterir); `allowUnsandboxedCommands` kapalı mı; ağ izin listesi boş mu; profillerin ve `team.json`'un gerektirdiği alan adları listede mi; sandbox dışında çalışan komut var mı.
- **Docker:** Docker soketi sandbox içinde erişilemez. Testler Docker gerektiriyorsa (Testcontainers, `docker compose`) komutu `excludedCommands` ile sandbox dışına almak yerine soketi `sandbox.network.allowUnixSockets` ile açmayı değerlendirin; karar sizindir.

## 2. Bir kez yapılacak kullanıcı ayarı

Plugin `env` veya `teammateMode` ayarlayamaz; bunlar **kullanıcı ayarına** yazılır. `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"
  },
  "teammateMode": "tmux"
}
```

- `CLAUDE_CODE_ENABLE_TODO_TOOLS` **zorunludur.** Claude Code v2.1.268 ve sonrasında görev araçları (TaskCreate/TaskUpdate/TaskList/TaskGet) yalnızca Opus 4.7, Sonnet 4.6, Haiku 4.5 ve daha eski modellerde varsayılan açıktır; diğer modellerde (Claude 5 ailesi, gateway arkasındaki model adları) bu değişken olmadan gelmez. Görev araçları yoksa ortak görev listesi, `TaskCompleted` kapısı (K1 kanıt kontrolü) ve `STATUS.md` çalışmaz. In-process teammate'ler ayarı ana oturumdan devralır. Ön kontrol yoksa FAIL verir.
- `teammateMode` isteğe bağlıdır (`"auto"`, `"tmux"`, `"iterm2"`); yazılmazsa teammate'ler in-process çalışır.
- Hiçbir settings dosyasına **`"agent"` anahtarı eklemeyin.** Kullanıcı her zaman önce ana oturumla konuşur; takıma ana oturum paslar. Ön kontrol bu anahtarı görürse FAIL verir.

## 3. Plugin'i kurma

### 3.1 Marketplace'i ekle ve kur

Repo GitHub'a push edildikten sonra:

```text
/plugin marketplace add BunyaminAslan/Softtech-BootsCamp
/plugin install agent-team@agent-team-marketplace
```

Kabukta aynısı:
```sh
claude plugin marketplace add BunyaminAslan/Softtech-BootsCamp
claude plugin install agent-team@agent-team-marketplace            # varsayılan: user scope
```

| Scope | Nereye yazar | Ne zaman |
|---|---|---|
| `user` (varsayılan) | `~/.claude/settings.json` | Plugin tüm projelerinizde etkin olsun |
| `project` | Ürün reposunun `.claude/settings.json` dosyası (commit edilir) | Plugin yalnızca bu projede etkin olsun; ekip arkadaşları da aynı plugin'i kullansın |
| `local` | `.claude/settings.local.json` | Yalnızca sizin makinenizde, bu projede |

Yalnızca belirli projelerde kullanmak için önerilen yol: plugin'i bir kez kurup projede etkinleştirmek.
```sh
cd <ürün-repo>
claude plugin marketplace add BunyaminAslan/Softtech-BootsCamp --scope project
claude plugin install agent-team@agent-team-marketplace --scope project
```
Bu, projenin `.claude/settings.json` dosyasına şuna benzer bir giriş yazar (ekip için commit edilir; her ekip arkadaşı kendi klonunda kurulum komutunu bir kez çalıştırır):
```json
{
  "enabledPlugins": { "agent-team@agent-team-marketplace": true },
  "extraKnownMarketplaces": {
    "agent-team-marketplace": { "source": { "source": "github", "repo": "BunyaminAslan/Softtech-BootsCamp" } }
  }
}
```
Bir projede kapatmak için `.claude/settings.local.json` içinde `"agent-team@agent-team-marketplace": false`.

**Özel (private) repo:** Claude Code kimlik bilgisi sormaz. SSH anahtarı veya `gh auth login` + `gh auth setup-git` ile kayıtlı HTTPS kimlik bilgisi gerekir; yalnızca `GITHUB_TOKEN` ortam değişkeni yetmez.

### 3.2 Kurmadan denemek (framework geliştirme)

```sh
cd <ürün-repo>
claude --plugin-dir /yol/agent-team/plugin
```
Plugin yalnızca o oturum için ve yerinde (kopyalanmadan) yüklenir; ID'si `agent-team@inline` olur. Aynı adlı kurulu plugin'in yerine geçer.

### 3.3 Güncelleme

```sh
claude plugin marketplace update agent-team-marketplace
claude plugin update agent-team@agent-team-marketplace
```
`plugin.json` içindeki sürüm artırılmadıkça kullanıcılar güncellemeyi almaz. Yeni sürüm bir sonraki oturumda veya `/reload-plugins` ile yüklenir. Pre-commit hattı kuruluysa güncellemeden sonra `--update-githooks` adımını uygulayın (Bölüm 7.4); ön kontrol hook dosyaları plugin şablonundan farklıysa uyarır.

**Proje katmanını yükseltme.** Katmanın şema sürümü `team.json > version`'dadır (alan yoksa 1 sayılır). Plugin yeni bir katman sürümü getirdiğinde (CHANGELOG bunu belirtir):

| Durum | Davranış |
|---|---|
| Katman eski ama destekleniyor | Takım çalışır; yeni alanlar varsayılanlarla davranır. Ön kontrol ve `setup-project` WARN verir. |
| Katman plugin'den yeni (başka makinede daha yeni plugin'le kurulmuş) | `team.json` hatası: guard takım rollerini engeller (fail-closed). Plugin'i güncelleyin. |
| Katman desteklenmeyecek kadar eski | Aynı şekilde hata; `--upgrade` gerekir. |

```sh
node <plugin-kökü>/scripts/setup-project.js --upgrade --dry-run   # ne değişecek
node <plugin-kökü>/scripts/setup-project.js --upgrade             # uygula
```
Yükseltme yalnızca eksik alanları ekler ve sürümü günceller. Sizin yazdığınız değerlere (roller, yollar, profiller, özel ayarlar) dokunmaz; eksik şablon dosyalarını da tamamlar. `team.json` yeniden yazıldığı için biçimlendirme (boşluk, satır düzeni) değişebilir; değişikliği commit etmeden önce inceleyin.

| Katman sürümü | Plugin | Değişiklik |
|---|---|---|
| 1 | 0.1.0 | İlk katman |
| 2 | 0.2.0 | `team.json`: `evidence`, `sandbox`, `version: 2`; `STATUS.md` team-status satırına `unverified` |
| 3 | 0.7.0 | `team.json`: `autonomy`, `models`, `version: 3` |
| 4 | 0.8.0 | `team.json`: `design`, `version: 4`; `Docs/Design/reviews/_TEMPLATE.md` |
| 5 | 0.11.0 | `version: 5`; `Docs/Project/plan.example.json`, `Docs/Project/retros/_TEMPLATE.md` |

## 4. Projeyi bağlama: proje katmanı

Ürün reposunun kökünde Claude'u açın ve:

```text
/agent-team:setup-project      # boş veya yeni repo
/agent-team:onboard            # kodu olan, var olan repo (Bölüm 4.1)
```

Skill önce ne yazılacağını gösterir (`--dry-run`), onayınızdan sonra kurar. **Var olan hiçbir dosyanın üzerine yazmaz.** Betik doğrudan da çalıştırılabilir:
```sh
node <plugin-kökü>/scripts/setup-project.js [--githooks] [--name <ad>] [--init-git] [--dry-run]
```

### 4.1 Var olan repo: `/agent-team:onboard`

Onboard, `setup-project`'in üstüne çalışır ve boş şablonu repodan çıkardığı bilgilerle doldurur.

1. Proje katmanı yoksa `setup-project` ile kurar.
2. `scripts/onboard-scan.js` ile repoyu tarar:
   - manifestler: `package.json`, `*.csproj`, `pubspec.yaml`, `build.gradle`, `go.mod`, `pyproject.toml`/`requirements.txt`, `Cargo.toml`, `Package.swift`;
   - lock dosyasından paket yöneticisi;
   - script'lerden build/test/lint komutları;
   - uygulama klasörlerinden sahiplik yolları;
   - `openapi*` dosyasından sözleşme yolu; ADR, README, CI ve `CLAUDE.md`/`AGENTS.md`.

   Her bulgu **tespit** (dosyadan okundu) veya **tahmin** (çıkarım) diye işaretlenir. Watch/sunucu script'leri ve profili olmayan yığınlar not olarak raporlanır.
3. Raporu size gösterir ve düzeltmelerinizi sorar.
4. Taslağı yazar. `team.json` ve `project.md` şablondan hiç değiştirilmemişse doğrudan güncellenir; değiştirilmişse yanlarına `.draft` yazılır, sizin içeriğinize dokunulmaz.
5. Komutları bir kez ön planda çalıştırıp K1 kanıtıyla doğrular. Kurulum komutu için önce izin ister.
6. `setup-project`'i yeniden çalıştırır: seçilen profillerin sandbox ağ izinleri eklenir, ön kontrol çalışır.

Betik tek başına da kullanılabilir (komut çalıştırmaz):
```sh
node <plugin-kökü>/scripts/onboard-scan.js [--json] [--write] [--project <dizin>]
```

Oluşturulanlar:

```
<ürün-repo>/
├── AdditionalAgentInformation/
│   ├── README.md              # bu klasörün rehberi
│   ├── project.md             # bağlam: ad, DİL, amaç, yığın, KOMUTLAR, ortam, kısıtlar
│   ├── rules.md               # projeye özel ek takım kuralları
│   ├── team.json              # roller, profiller, alan sahipliği, yollar, korumalı yollar (guard uygular)
│   ├── profiles/README.md     # isteğe bağlı projeye özel yığın profilleri
│   └── agents/<rol>/          # lead, backend, mobile, web, tester
│       ├── instructions.md    #   role projeye özel talimat (kullanıcı yazar)
│       ├── MEMORY.md          #   rolün kalıcı hafızası (rol yazar)
│       └── WORKLOG.md         #   rolün oturum günlüğü (rol yazar)
├── Docs/Project/{VISION,STATUS,ARCHITECTURE}.md   # lead'in plan dokümanları (şablon)
├── Docs/ADR/0000-template.md
├── .githooks/{pre-commit,review-cache.js}         # yalnızca --githooks ile
├── .gitignore    (+ .precommit-cache/, .claude/settings.local.json)
└── .gitattributes (+ .githooks/* text eol=lf)
```

Kurulumdan sonra:

1. **`project.md`'yi doldurun.** En kritik alanlar: **Dil** (takımın sizinle konuşacağı dil), **Yığın**, **Komutlar** (takımın kanıt olarak çalıştıracağı *biten* build/test/lint komutları) ve **Ortam**. Ön kontrol `<doldur>` kalan alanları uyarır.
2. **`team.json`'u projenize göre düzenleyin** (Bölüm 5).
3. Gerekirse rol başına `agents/<rol>/instructions.md` yazın.
4. Bu dosyaları **siz** commit edin. Hafıza ve worklog dosyaları da projeyle birlikte versiyonlanır.

### Ajanlar proje katmanını nasıl kullanır?

Her rol, oturum başında sırayla şunları okur: `TEAM_RULES.md` (plugin), `project.md`, `rules.md`, `team.json`, kendi `instructions.md`'si, seçilen profil, kendi `MEMORY.md`'si ve `WORKLOG.md`'sinin son girişleri. Hafıza ve worklog'a yalnızca kendi `agents/<rol>/` klasörüne yazabilir. Claude Code'un yerleşik `memory:` özelliği kullanılmaz; o özellik hafızayı `.claude/agent-memory/` altına yazardı.

## 5. `team.json` referansı

```json
{
  "version": 1,
  "roles": {
    "lead":    { "enabled": true },
    "backend": { "enabled": true,  "profile": "dotnet", "paths": ["backend/"] },
    "mobile":  { "enabled": true,  "profile": "flutter", "paths": ["mobile/", "Docs/Mobile/"] },
    "web":     { "enabled": false, "profile": null,     "paths": ["web/", "Docs/Web/"] },
    "tester":  { "enabled": true,  "profile": null,     "paths": [] }
  },
  "paths": {
    "contract": "Docs/Contracts/",
    "projectDocs": "Docs/Project/",
    "adr": "Docs/ADR/",
    "testDocs": "Docs/Test/"
  },
  "protected": ["infra/prod/", "migrations/applied/"],
  "evidence": { "mode": "warn", "maxAgeHours": 24 },
  "sandbox": { "allowedDomains": ["npm.sirket.local"] },
  "autonomy": "checkpoint",
  "models": { "roles": { "tester": "sonnet" }, "tasks": { "DOC": "haiku" } },
  "design": { "gate": "warn", "minScore": 8, "variants": ["mobile-light", "mobile-dark", "desktop-light", "desktop-dark"], "reviews": "Docs/Design/reviews/" }
}
```

| Alan | Anlamı | Guard etkisi |
|---|---|---|
| `roles.<rol>.enabled` | Rol bu projede kullanılır mı | lead kapalı rolü başlatmaz; ön kontrol kapalı rolü denetlemez |
| `roles.<rol>.profile` | Yığın profili adı | Ön kontrol, profil `AdditionalAgentInformation/profiles/<ad>.md` ya da `plugin/profiles/<rol>/<ad>.md` altında bulunamazsa FAIL, biçimi geçersizse WARN verir (`scripts/profile-check.js`; geçersiz profilin ağ izinleri eklenmez). Hazır profiller: `profiles/README.md` |
| `roles.backend/mobile/web.paths` | Rolün **sahip olduğu** klasörler | Diğer geliştirici rolleri bu yollara yazamaz |
| `roles.tester.paths` | Tester'ın ek yazabileceği yollar | Tester yalnızca test dosyaları, `testDocs` ve buraya yazar |
| `paths.contract` | API sözleşmesi klasörü | Yalnızca backend yazar |
| `paths.projectDocs` | Plan dokümanları (STATUS, SPRINT_PLAN …) | Yalnızca lead yazar; TaskCompleted hook'u `STATUS.md`'yi buradan günceller |
| `paths.adr` | ADR klasörü | lead ve geliştiriciler yazar |
| `paths.testDocs` | Test dokümanları | Yalnızca tester yazar |
| `protected` | Projeye özel korumalı yollar | Hiçbir takım rolü yazamaz |
| `evidence.mode` | Kanıt kaydı modu (Bölüm 7.5): `warn` (varsayılan), `enforce`, `strict`. Kısaltma: `"evidence": "enforce"` | Guard'ı değil TaskCompleted kapısını etkiler |
| `sandbox.allowedDomains` | Projeye özel sandbox ağ izinleri (alan adı, `*.alan.com`, isteğe bağlı `:port`) | Guard'ı etkilemez; `setup-project` bunları `.claude/settings.json`'a ekler, ön kontrol eksikleri gösterir (Bölüm 1.1) |
| `autonomy` | lead'in ne zaman durup soracağı: `supervised` (plan onayı + her dalga sonu + her kapsam değişikliği + kritik kararlar), `checkpoint` (varsayılan: plan onayı + kritik kararlar), `autonomous` (plan onayı + yalnızca engellendiğinde; kararlar `[STATUS]` ile raporlanır). Commit, push, deploy ve sistem kurulumu her düzeyde sizindir. | Guard'ı etkilemez; lead davranışı (tech-lead.md §0.1) |
| `models.roles.<rol>` | Teammate'in başlatılırken kullanılacağı model: `opus`, `sonnet`, `haiku`, `inherit` veya tam model kimliği. Varsayılan (yeni projeler): `web` ve `tester` `sonnet`. Tablo yazılırsa varsayılanın yerine geçer; `"roles": {}` ajan dosyalarındaki modeller demektir (önceki davranış). Model teammate'in tüm görevleri için geçerlidir. | lead `[SPAWN-REQUEST]`'e `model:` satırı yazar, ana oturum Agent aracının `model` parametresiyle başlatır |
| `models.tasks.<ETİKET>` | Mekanik işler için model (ör. `TEST`, `DOC`). Varsayılan: `DOC` → `sonnet`. Bir dalgada o etiketli birden çok görev varsa lead bunlar için o modelle ayrı bir üye ister (ör. `tester-test`). Görev başına model: `plan.json > tasks[].model` (lead mekanik işleri `sonnet`/`haiku`'ya verir; aynı rol için birden çok görev varsa `<rol>-<model>` adlı ayrı üye). | Aynı |
| `design.gate` | Tasarım kapısı (TEAM_RULES K8): `UI: evet` işaretli görev ekran görüntülü ve puanlı bir incelemeyle kapanır. `warn` (varsayılan: kapanır, `⚠️ Tasarım` + uyarı), `enforce` (engeller), `off` | TaskCompleted kapısı |
| `design.minScore` / `variants` / `reviews` | Puan eşiği (1–10, varsayılan 8); zorunlu ekran görüntüsü varyantları; inceleme klasörü (şablon `_TEMPLATE.md` kurulumla gelir) | Aynı |
| `evidence.maxAgeHours` | Kanıtın görev kapanışından en fazla kaç saat önce çalışmış olabileceği (varsayılan 24, en fazla 720) | Aynı |

### 5.1 Özel roller (DevOps, güvenlik, teknik yazar …)

Yerleşik beş rolün (`lead`, `backend`, `mobile`, `web`, `tester`) yanında `roles` altına projeye özel roller eklenebilir. Framework kodu değişmez; guard, ön kontrol, SessionStart eşlemesi, kanıt kaydı ve görev kapısı rolleri bu yapılandırmadan okur.

```json
"roles": {
  "devops":   { "agent": "devops-engineer", "kind": "developer", "paths": ["infra/", "deploy/"], "description": "CI/CD ve altyapı kodu" },
  "security": { "agent": "sec-plugin:security-reviewer", "kind": "reviewer", "paths": ["Docs/Security/"] },
  "writer":   { "agent": "tech-writer", "kind": "docs", "paths": ["docs-site/"] }
}
```

| Alan | Anlamı |
|---|---|
| ad (anahtar) | Küçük harf, rakam, `-`; 2–31 karakter. `fix`, `doc`, `arch`, `test`, `lead` … ayrılmıştır. Görev etiketi adın büyük harflisidir: `[DEVOPS] S1-04`. |
| `agent` | Rolün ajanı. `"ad"`: projenin `.claude/agents/ad.md` (veya `~/.claude/agents/`) dosyası, hangi kaynaktan gelirse gelsin ad eşleşmesi. `"plugin:ad"`: başka bir plugin'in ajanı, tam eşleşme. Yerleşik bir takım ajanı olamaz. |
| `kind` | `developer`: `paths`'in **sahibi**; sahipsiz yollara da yazar, başka geliştiricinin yoluna, sözleşmeye, plan ve test dokümanlarına yazamaz; görevleri K1 kanıt kapısına girer. `reviewer`: yalnızca `paths` (rapor klasörü, boş olabilir). `docs` ve `allowlist`: yalnızca `paths` (en az bir yol). Hepsi kendi `AdditionalAgentInformation/agents/<rol>/` klasörüne yazar. |
| `paths` | Göreli yollar. İki geliştirici rolünün (yerleşik veya özel) yolları çakışamaz; çakışma `team.json` hatasıdır. |
| `enabled`, `profile`, `description` | Yerleşik rollerdeki gibi. `description` özel role başlangıç bağlamında verilir. |

Tüm genel kurallar (korumalı yollar, Bash kuralları, alt agent yasağı, kanıt kaydı) özel rollere de uygulanır.

**Ajan dosyası:** `plugin/templates/agents/custom-role.md` şablonunu `.claude/agents/<ajan-adı>.md` olarak kopyalayın, `<ajan-adı>` ve `<rol>` yerlerini doldurun ve rolün uzmanlığını yazın. Proje ajanlarında `${CLAUDE_PLUGIN_ROOT}` çözülmez. Bu yüzden SubagentStart hook'u özel role başlarken rolünü, yetkilerini ve `TEAM_RULES.md`'nin mutlak yolunu bağlam olarak verir (WSL2'de canlı doğrulandı). Rolün hafıza klasörünü açın: `AdditionalAgentInformation/agents/<rol>/` (`instructions.md`, `MEMORY.md`, `WORKLOG.md`).

**Ön kontrol** özel rol için ajan dosyasını arar (bulunamazsa FAIL; başka plugin'den geliyorsa doğrulanamadığı için WARN). Dosyada `disallowedTools: Agent`, `TEAM_RULES.md` ve hafıza klasörü geçmiyorsa WARN verir. Ardından gerçek hook girdisiyle bir yasak ve bir serbest guard denemesi yapar.

Kurallar: Yollar repo köküne göre görelidir; `..` ve mutlak yol kabul edilmez. Bilinmeyen anahtar hatadır; yerleşik olmayan bir rol adı özel rol tanımı sayılır ve Bölüm 5.1'deki alanları ister. **`team.json` bozuk veya geçersizse guard, takım rollerinin yazma ve komut çağrılarını engeller** (fail-closed); ana oturum etkilenmez. Dosya yoksa yukarıdaki varsayılanlar kullanılır.

## 6. Projeye özel skill, MCP, izin ve agent override

Framework'ün skill'leri ve MCP'si plugin'le gelir. Projeye özel olanlar Claude Code'un standart yerlerine konur ve ajanlara otomatik ulaşır; ajanlarda `tools:` allowlist'i olmadığı için ek ayar gerekmez.

| Ne | Nereye | Not |
|---|---|---|
| Skill | `<ürün-repo>/.claude/skills/<ad>/SKILL.md` | Kurmadan önce SKILL.md'yi okuyun (framework kuralı: `plugin/skills/README.md`). Yığına özgü önerilen skill'ler profil dosyalarında (ör. `profiles/mobile/react-native-expo.md` > Expo skill'leri). |
| MCP sunucusu | `<ürün-repo>/.mcp.json` | Proje MCP'si ilk kullanımda onay ister. Plugin'in Playwright sunucusu `mcp__plugin_agent-team_playwright__*` adıyla gelir. |
| İzinler | `<ürün-repo>/.claude/settings.json` > `permissions.allow` | Teammate'lerin izin istekleri ana oturuma düşer. Sık kullanılan biten komutları (`npm test`, `dotnet build` …) allow listesine ekleyin. Tasarım kapısı ve E2E için Playwright araçlarına izin: `"mcp__plugin_agent-team_playwright"` (lead'in yazma/çalıştırma araçları ajan dosyasında zaten kapalıdır). |
| Agent override | `<ürün-repo>/.claude/agents/<ajan-adı>.md` | Proje ajanı plugin ajanından önceliklidir. Guard rolü adından tanır, yani kurallar geçerli kalır. Ancak override dosyasında `${CLAUDE_PLUGIN_ROOT}` çözülmez (TEAM_RULES yolunu elle verin) ve plugin güncellemelerini almazsınız. Ön kontrol override'ları WARN olarak gösterir. Tercih edilen yol: davranışı `instructions.md` veya profille genişletmek. |

Takım üyeleri `.claude/`, `.mcp.json` ve `AdditionalAgentInformation/` altındaki kullanıcı dosyalarına yazamaz; bu uzantıları yalnızca kullanıcı (veya kullanıcının isteğiyle ana oturum) değiştirir.

## 7. Hook ve guard: yapılması gerekenler

### 7.1 Plugin'in kurduğu hook'lar (otomatik, ek ayar gerekmez)

| Olay | Betik | Ne yapar | Engeller mi |
|---|---|---|---|
| SessionStart | `hooks/session-start.sh` → `.js` | Ana oturuma yönlendirme kurallarını, takım eşlemesini, dil tercihini ve proje katmanı durumunu enjekte eder; node yoksa uyarır | Hayır |
| SubagentStart | `hooks/subagent-start.js` | `agent_id` → `agent_type` kaydı tutar (`${CLAUDE_PLUGIN_DATA}/agent-registry/`); guard yedek kaynak olarak kullanır | Hayır |
| PreToolUse (`Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Agent`) | `hooks/guard.sh` → `agent-guard.js` | Takım rollerinin yetkilerini uygular | **Evet** (exit 2) |
| PostToolUse (`Bash`, `PowerShell`, görev araçları, `SendMessage`), PostToolUseFailure (`Bash`, `PowerShell`) | `hooks/ledger-record.js` | Takım rollerinin komutlarını kanıt kaydına yazar ve ajana `Kanıt: L-…` kimliğini döndürür; bekleyen kapanış uyarılarını ajana ve lead'e iletir (Bölüm 7.5) | Hayır |
| TaskCompleted | `hooks/task-completed.js` | K1 satırları olmayan geliştirme görevi kapanışını engeller; `Kanıt: L-…` atıflarını kayıttan doğrular (`warn` modunda uyarır, `enforce`/`strict` modunda engeller); `STATUS.md`'yi günceller; `[DOC]` görevinde sprint dokümanını kontrol eder | **Evet** |
| SubagentStop, TeammateIdle | `hooks/subagent-stop.js` | Reviewer bitince ve lead kullanıcıdan bir şey beklerken mesaj ve masaüstü bildirimi gösterir | Hayır |

Plugin hook'ları kullanıcı ve proje hook'larınızla **birleşir**; birbirinin yerine geçmez. Aynı işi yapan eski proje hook'larınız varsa (ör. eski bir `agent-guard` kopyası) kaldırın, yoksa iki kez çalışır.

### 7.2 Guard nasıl karar verir?

| Çağıran | Tespit | Sonuç |
|---|---|---|
| Ana oturum | `agent_id` ve `agent_type` yok | Kısıtlama yok |
| Takım dışı agent (Explore, precommit ajanları …) | `agent_type` takım rolü değil | Kısıtlama yok |
| Takım rolü | `agent_type` = `agent-team:tech-lead` / `senior-*` (veya öneksiz override adı) | Rol kuralları + `team.json` |
| Türü bilinmeyen agent | `agent_id` var, `agent_type` yok, kayıt yok | **Engellenir** |
| Girdi okunamıyor / guard hata verdi / node yok | Ham girdide `agent_id`/`agent_type` var mı | Varsa **engellenir**, yoksa (ana oturum) geçer |

Rol kurallarının özeti:
- **Tüm roller:** git geçmişini değiştiren komutlar, `--no-verify`, deploy/publish, cloud değişikliği, global/sistem kurulumu, `sudo`, indir-çalıştır, gizli dosyaları ekrana dökme, Claude plugin/MCP değişikliği ve alt agent başlatma (`Agent`) yasaktır. Korumalı yollar: `.git/`, `.claude/`, `.mcp.json`, `.githooks/`, `.github/`, `.precommit-cache/`, `Docs/Sprint_*.md`, `.env*` (`.example`/`.sample`/`.template` hariç), anahtar ve sertifika dosyaları, production yapılandırması, `team.json > protected` ve `AdditionalAgentInformation/` (kendi `agents/<rol>/` klasörü hariç; o klasörde de `instructions.md` hariç). Proje kökü dışına yazma yasaktır, OS temp serbesttir. Plugin veri dizinine (kanıt kaydı, agent kaydı) komutla erişmek yasaktır; kayıt yalnızca `scripts/ledger.js` ile okunur.
- **Geliştiriciler:** başka geliştirici rolünün yollarına, plan ve test dokümanlarına yazamaz. Sözleşmeye yalnızca backend yazar.
- **lead:** yalnızca `paths.projectDocs`, `paths.adr` ve kendi klasörüne yazar.
- **tester:** yalnızca test dosyaları ve klasörleri, `paths.testDocs` ve `roles.tester.paths` altına yazar.

Guard, Bash ve PowerShell komutlarındaki yazma hedeflerini de ayrıştırır (`>`, `>>`, `tee`, `sed -i`, `cp`, `mv`, `mkdir`, `rm`, `Set-Content` …). Bu bir en iyi çaba savunmasıdır; değişken içeren hedefler (`$X/file`) çözülemez. Asıl güvence, kuralların ajan dosyalarında da yazılı olması ve ajanların guard'ı aşmaya çalışmamasıdır.

### 7.3 Projede yapılması gerekenler

1. **node'un hook kabuğunda bulunduğunu doğrulayın:** `sh -c 'command -v node'`. Bulunmazsa guard tüm takım çağrılarını engeller; SessionStart bunu uyarır.
2. **Windows'ta Git Bash kurulu olsun.** Claude Code onu otomatik bulamazsa `CLAUDE_CODE_GIT_BASH_PATH` ile gösterin.
3. **`team.json`'u projenin gerçek klasörlerine göre yazın.** Guard sahipliği buradan uygular. Örneğin monorepo'da `apps/api/`, `apps/mobile/`, `apps/web/`.
4. **Ek korumak istediğiniz yolları** (`infra/prod/`, uygulanmış migration'lar vb.) `protected` dizisine ekleyin.
5. **Ön kontrolü çalıştırın:** `node <plugin-kökü>/scripts/team-preflight.js`. `/agent-team:team` bunu her takım başlangıcında, lead de ilk spawn'dan önce zaten çalıştırır. Ön kontrol her etkin rol için gerçek hook girdisiyle bir "yasak" ve bir "serbest" deneme yapar.
6. **`disableAllHooks` kullanmayın.** Bu ayar guard'ı da kapatır.
7. **Masaüstü bildirimlerini** istemiyorsanız `CLAUDE_TEAM_NOTIFY=0` ortam değişkenini verin.

### 7.4 Pre-commit hattı (isteğe bağlı)

```text
/agent-team:setup-project --githooks
```
- `.githooks/pre-commit` ve `.githooks/review-cache.js` projeye kopyalanır, `git config core.hooksPath .githooks` ayarlanır. `core.hooksPath` klon başınadır; her ekip arkadaşı kendi klonunda bir kez çalıştırır.
- Başka bir `core.hooksPath` zaten ayarlıysa (ör. husky) betik değiştirmez ve uyarır. O durumda `.githooks/pre-commit` dosyasını mevcut hook zincirinizden çağırın.
- Hook, `claude -p --agent agent-team:precommit-lead` çalıştırır. Plugin projede etkin değilse agent bulunamaz ve commit engellenir. Farklı bir ad için `AGENT_TEAM_PRECOMMIT_AGENT=<ad>` kullanın.
- Plugin güncellemesinden sonra hook dosyalarını yenilemek için: `node <plugin-kökü>/scripts/setup-project.js --update-githooks`.
- `Docs/Sprint_<N>.md` dokümanları commit'e otomatik eklenir. İstemiyorsanız pre-commit hattını kurmayın; guard ve takım bundan bağımsız çalışır.

### 7.5 Kanıt kaydı (TEAM_RULES K1)

Ajanın "testler geçti" beyanı artık kayıttan doğrulanır.

1. Takım rolünün her Bash/PowerShell komutunu `ledger-record.js` kaydeder. Kaydedilenler: zaman, rol, agent, komut, dizin, çıkış kodu, süre, sonuç (`ok`, `fail`, `timeout`, `interrupted`, `background`), çıktının maskeli son 2 KB'ı ve tam çıktının SHA-256'sı. Ana oturum ve takım dışı agent'lar kaydedilmez.
2. Araç sonucunda ajan `Kanıt: L-7f3a2c1d (exit 0, 14.2 sn)` satırını görür. Görev kapanışında bu kimliği açıklamaya `Kanıt: L-7f3a2c1d` olarak yazar.
3. TaskCompleted kimliği doğrular:
   - kayıtta var ve hash zinciri sağlam;
   - görevin rolüne (`[BACKEND]` → backend …; `[FIX]` → herhangi bir geliştirici veya tester) ve hook girdisinde varsa aynı agent'a ait;
   - başarılı (exit 0, arka plan değil);
   - `maxAgeHours` içinde çalışmış;
   - başka bir görevde kanıt olarak kullanılmamış;
   - `strict` modda ayrıca `project.md > Komutlar` tablosundaki bir komutu içeriyor.

   `Sonuç: 42/42` iddiası çıktıdaki test özetiyle (Jest, Vitest, dotnet test, pytest, flutter test, node --test) karşılaştırılır; uyuşmazlık yalnızca uyarıdır.

| Mod | Doğrulanamayan kapanış |
|---|---|
| `warn` (varsayılan) | Görev kapanır. Kullanıcıya `systemMessage`, ajana ve lead'e bir sonraki araç sonucunda **KANITSIZ KAPANIŞ** uyarısı gider. `STATUS.md` satırı `⚠️ Kanıtsız` olur ve team-status satırında `unverified=N` sayılır. |
| `enforce` | Kapanış engellenir (exit 2); ajana neyin eksik olduğu söylenir. |
| `strict` | `enforce` + yalnızca `project.md > Komutlar` tablosundaki komutlar kanıt sayılır. |

**Kayıt nerede?** Proje dışında: `${CLAUDE_PLUGIN_DATA}/ledger/<proje-yolu-hash>/<agent_id>.jsonl`. Marketplace kurulumunda bu `~/.claude/plugins/data/agent-team-<marketplace>/` altındadır. Kayıt git'e girmez, 30 günden eski dosyalar otomatik silinir.

**Okuma:**
```sh
node <plugin-kökü>/scripts/ledger.js show L-7f3a2c1d             # tek kayıt, zincir durumu, atfedildiği görev
node <plugin-kökü>/scripts/ledger.js list --role backend --since 24h
node <plugin-kökü>/scripts/ledger.js verify                       # hash zinciri; sorun varsa exit 1
node <plugin-kökü>/scripts/ledger.js export --out Docs/Project/EVIDENCE.md   # görevlere atfedilen kanıtlar
node <plugin-kökü>/scripts/ledger.js prune --days 30
```
Betik veri dizinini kendisi bulur (`CLAUDE_PLUGIN_DATA`, yoksa `~/.claude/plugins/data/agent-team*`); gerekirse `--data <dizin>` verin. Komutu ürün reposunun kökünde çalıştırın veya `--project <dizin>` verin.

**Kurcalamaya karşı:** Her satır bir öncekinin hash'ini içerir ve kimlik içerikten türetilir; değiştirilen veya silinen satırı `verify` gösterir. Ajanların kayda komutla erişimi guard tarafından engellenir; Claude Code da bu dizine Bash ile yazmayı ayrıca engeller. Sandbox açıksa (Bölüm 1.1) işletim sistemi düzeyinde de yazamazlar. Hook'lar sandbox dışında çalıştığı için kayıt yazılmaya devam eder.

**Sınırlar:**
- Kayıt "komut çalıştı ve 0 ile bitti" der, "doğru komut çalıştı" demez; bunu `strict` mod daraltır.
- Arka plan komutları kanıt üretmez (Claude Code arka plan bitişini hook'a bildirmez). Kanıt komutları ön planda, gerekirse 10 dakikalık zaman aşımıyla çalışır (TEAM_RULES K2).
- Sandbox yoksa (native Windows) kayıt guard, Claude Code izinleri ve hash zinciriyle korunur.

### 7.5.0 Token tasarrufu

Ölçüm (canlı test, 24 saat, ağırlıklı): ana oturum %29, backend %25, lead %23, web %19, tester %4,5. Maliyetin %36'sı önbelleğe yazma (ajanın başlarken okuduğu dosyalar), %35'i önbellekten okuma (uzayan bağlam), %29'u çıkış token'ı. Framework bunları şöyle azaltır:

- **Ana oturum Sonnet:** Takım çalışırken ana oturum yalnızca mesaj taşır; `/model sonnet` yeterlidir (plugin ana oturumun modelini değiştiremez). `claude -p` ile gözetimsiz çalıştırıyorsanız `--model sonnet`.
- **Kısa mesajlar:** Mesaj ve raporlar en fazla ~10 satırdır; ayrıntı dosyaya yazılır (TEAM_RULES > İletişim).
- **Göreve göre model:** `team.json > models` (Bölüm 5). Yeni projelerde web ve tester Sonnet, doküman görevleri Sonnet'tir; lead ve backend'in çekirdek işleri Opus'ta kalır. lead mekanik görevleri `plan.json > tasks[].model` ile küçük modele yönlendirir.
- **Daha az başlangıç okuması:** Üyeler planın tamamı yerine yalnızca kendi dilimini okur (`plan.js slice --role <rol>`).
- **Sessiz komutlar:** Profillerdeki build/test komutları az çıktı verir; dosyalar Read/Grep ile hedefli okunur.

Kanıt kuralı (K1) ve tasarım kapısı (K8) maliyetin küçük bir kısmıdır; kaldırmayın.

### 7.5.1 Kullanım raporu

```sh
node <plugin-kökü>/scripts/usage-report.js [--since 7d|24h] [--session <id>] [--json]
```
Claude Code transcript'lerinden (`~/.claude/projects/<proje>/`, alt agent'lar dahil) model ve rol bazında giriş, çıkış ve önbellek token'larını toplar. Aynı yanıt bir kez sayılır. Limitler token tabanlı olduğu için dolar hesaplanmaz. lead sprint kapanışında bu raporu ve bir sonraki sprint için `models` önerisini `[DONE]` mesajına ekler. Transcript biçimi belgelenmemiştir; okuma en iyi çabadır.

### 7.6 Kesintiden sonra devam: `/agent-team:resume`

Kullanım limiti dolduğunda veya oturum kapandığında in-process teammate'ler geri gelmez (`/resume` ve `--continue` yalnızca ana oturumu geri getirir). Yeni bir oturumda:

```text
/agent-team:resume
```

1. `scripts/resume-status.js` bir devam özeti çıkarır. Dosya değiştirmez, komut çalıştırmaz. Özetin kaynakları:
   - `STATUS.md`: team-status satırı, bitmemiş ve `⚠️ Kanıtsız` görevler, "Şu an kim ne yapıyor", "Yeniden başlatma için", bloklar, sonraki adım;
   - `SPRINT_PLAN.md` > Ana hedef;
   - her rolün son worklog girişi;
   - kanıt kaydındaki son komutlar ve son 24 saatteki arka plan komutları;
   - Claude Code görev listesi (`~/.claude/tasks/`; görev kodları `STATUS.md` ile eşleşen en son liste);
   - git: dal ve sahibine göre gruplanmış, commit'lenmemiş değişiklikler.
2. Özet size gösterilir. Arada bir şey değiştirip değiştirmediğiniz ve açık kalmış olabilecek arka plan süreçleri sorulur; bu süreçleri kapatma kararı sizindir.
3. lead **devam modunda** başlar (tech-lead.md §4.11):
   - yeni plan yapmaz;
   - görev listesini `STATUS.md`'den onarır;
   - yarım işi "devam / baştan / doğrulama bekliyor" diye değerlendirir;
   - yalnızca aktif görevi olan rolleri, kaldıkları yerle birlikte yeniden başlattırır.

Betik tek başına da kullanılabilir: `node <plugin-kökü>/scripts/resume-status.js [--json] [--project <dizin>]`. Görev listesi dosyalarının biçimi Claude Code tarafından belgelenmediği için okunması en iyi çabadır; bulunamazsa lead görevleri `STATUS.md`'den yeniden açar. lead her dalga sonunda `STATUS.md` > "Yeniden başlatma için" bölümünü güncel tutar; devam özeti bu bölümü aynen taşır.

## 8. İlk takım koşusunda doğrulama (önerilir)

Teammate'lerde guard davranışı yalnızca etkileşimli bir takım oturumunda doğrulanabilir (`-p` modunda teammate açılmaz). İlk gerçek koşuda:

1. `node <plugin-kökü>/scripts/team-preflight.js` → PASS veya yalnızca WARN.
2. Ana oturuma: *"/agent-team:team — Guard testi: lead'i başlat, sonra backend'i başlat. backend `mobile/probe.txt` yazmayı denesin, sonra `backend/probe.txt` yazsın; sonucu aynen raporlasın."*
3. Beklenen: ilk deneme `⛔ agent-guard (backend): Bu yol mobile rolüne ... ait` mesajıyla engellenir, ikincisi başarılı olur.
4. Guard **hiç engellemiyorsa** plugin 0.11.2'den eski olabilir (teammate'in `agent_type` değeri teammate adıdır; eski sürümler tanımıyordu). Engelleme yerine `türü belirlenemedi` mesajı görülürse teammate çağrılarında `agent_type` gelmiyor ve SubagentStart kaydı da yok demektir. Güvenlik açısından sorun yoktur (fail-closed), ama takım çalışamaz. Bunu framework'e bildirin.
5. `probe.txt` dosyalarını silin.
6. **Kanıt kaydı:** backend'e bir `[BACKEND] S0-01 Kanıt testi` görevi verin; `project.md > Komutlar` içindeki test komutunu çalıştırıp görevi K1 satırları ve `Kanıt: L-…` ile kapatsın. Beklenen: `STATUS.md`'de ✅, uyarı yok. Sonra aynı kimlikle ikinci bir görevi kapatmasını isteyin; beklenen: **KANITSIZ KAPANIŞ** uyarısı ("daha önce S0-01 görevinde kullanılmış") ve `⚠️ Kanıtsız`.

## 9. Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| Takım üyesinin her yazma işlemi engelleniyor, mesaj `node bulunamadı` | Hook kabuğunda node yok. WSL'de `which node` Linux yolunu göstermeli; nvm kullanıyorsanız node'u `~/.local/bin`'e bağlayın veya PATH'i hook'lara görünür kılın. |
| Mesaj `team.json okunamadı` veya `bilinmeyen rol` | `AdditionalAgentInformation/team.json` düzeltilene kadar takım rolleri engellenir (fail-closed). |
| Mesaj `türü belirlenemedi` | Bölüm 8, adım 4. |
| Ana oturumda "Bu projede AdditionalAgentInformation/ yok" | `/agent-team:setup-project` çalıştırın. Takımsız küçük işler için gerekmez. |
| `agent-team:...` ajanları görünmüyor | Plugin bu projede etkin mi: `claude plugin list`, `/plugin`. Proje ayarında `false` olabilir. |
| Pre-commit `Claude CLI bulunamadı` / agent bulunamadı | `claude` PATH'te olmalı ve plugin projede etkin olmalı. Log: `.git/precommit-lead/last-run.log`. |
| Commit çok uzun sürüyor | Hat iki agent çalıştırır. Diff değişmediyse önbellek atlar; acil durumda `git commit --no-verify`. |
| Teammate izin istekleri sürekli ana oturuma düşüyor | Proje `.claude/settings.json > permissions.allow` listesine biten build/test komutlarını ekleyin. |
| **KANITSIZ KAPANIŞ** uyarısı | Uyarıdaki madde nedeni söyler: atıf yok, kimlik kayıtta yok, başarısız komut, başka rol/agent, eski kanıt, tekrar kullanım. Ajan komutu ön planda yeniden çalıştırıp yeni kimliği açıklamaya ekler. Ayrıntı: `ledger.js show <L-…>`. |
| `ledger.js` "bu projenin kaydında yok" diyor | Betiği ürün reposunun kökünde çalıştırın (WSL ve Windows yolları farklı proje sayılır) veya `--project` / `--data` verin. |
| Plugin güncellemesi gelmiyor | `plugin.json` sürümü artmamış olabilir; `claude plugin marketplace update` + `claude plugin update`. |

## 10. Kaldırma

```sh
claude plugin uninstall agent-team@agent-team-marketplace   # veya /plugin > Installed
```
Proje katmanı (`AdditionalAgentInformation/`, `Docs/Project/`, `.githooks/`) ürün reposunda kalır; isterseniz siz silersiniz. `git config --unset core.hooksPath` pre-commit hattını devre dışı bırakır.
