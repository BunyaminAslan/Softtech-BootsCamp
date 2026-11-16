# Tester profilleri

Tester'ın araçları genellikle geliştirici rollerinin profillerinden türetilir (backend test çatısı, mobil E2E aracı, web E2E için Playwright). Ayrı bir tester profili yalnızca test yaklaşımı yığından bağımsız bir standarda bağlanacaksa gerekir (ör. tüm E2E'lerin Maestro + Playwright ile yazılması, belirli bir raporlama formatı).

Henüz hazır tester profili yoktur. Projeye özel tester profili `AdditionalAgentInformation/profiles/<ad>.md` olarak yazılır ve `team.json > roles.tester.profile` ile seçilir. Profil yazma kuralları: `../README.md`.

## Ağ izinleri (sandbox)
Tester rolü etkinken ve bir tester profili seçilmemişken `setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1). Bir tester profili seçilirse o profilin kendi "Ağ izinleri" bölümü kullanılır.
- `registry.npmjs.org`: E2E araçlarının npm paketleri (`@playwright/test`, axe, Lighthouse)
- `cdn.playwright.dev`: Playwright tarayıcı indirmeleri (`npx playwright install`)
- `playwright.download.prss.microsoft.com`: Playwright tarayıcı indirmeleri (yedek adres)

Test edilen uygulama yerelde çalışır; `localhost` sandbox ağ kısıtına takılmaz. Uzak bir test ortamı kullanılacaksa adresi `team.json > sandbox.allowedDomains` ile eklenir (guard uzak hedefe yük testini yine engeller).
