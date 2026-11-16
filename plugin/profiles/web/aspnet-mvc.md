# Profil: web / aspnet-mvc

> Kullanım: `AdditionalAgentInformation/team.json` → `"web": { "profile": "aspnet-mvc" }`.
> Bu profil `senior-web-developer.md`'deki generic kuralları sunucu tarafında render eden ASP.NET Core MVC / Razor Pages'e uyarlar; onları gevşetmez.
> API ayrı bir backend servisindeyse web rolü yalnızca UI katmanını yazar; aynı projede API controller'ları varsa sahiplik `team.json > paths` ile ayrılır.

## Yığın (yeni projede varsayılan öneri)

| Katman | Varsayılan | Not |
|---|---|---|
| Runtime | .NET (güncel LTS) + **ASP.NET Core MVC** (alternatif: Razor Pages sayfa odaklı uygulamada) | Nullable açık, `TreatWarningsAsErrors` |
| View | Razor (`.cshtml`), **Tag Helpers**, View Components, partial view'lar | HTML Helper yerine Tag Helper |
| Etkileşim | Önce sunucu render; gerekirse **htmx** veya küçük, ayrı JS modülleri | SPA framework'ü eklemek ADR ister |
| Stil | CSS değişkenleri (token'lar) + Tailwind CLI veya sade CSS | Token'lar K4 ADR'sinden |
| İstemci kütüphaneleri | LibMan veya npm (yalnızca build zamanında) | CDN'den çalışma anında yükleme yok (CSP) |
| Doğrulama | DataAnnotations / FluentValidation + unobtrusive client validation | Sunucu doğrulaması her zaman çalışır |
| Kimlik | ASP.NET Core Identity (cookie) veya projede kararlaştırılan IdP (OIDC) | |
| i18n | `IStringLocalizer` + `.resx` | |
| Test | xUnit, **WebApplicationFactory**, AngleSharp (HTML doğrulama) | E2E tester'da (Playwright) |

## Konvansiyonlar
- Controller ince: model bağlama, doğrulama, servis çağrısı, view seçimi. İş kuralı Application/servis katmanında.
- Her view'ın kendi **ViewModel**'i vardır; domain entity view'a geçmez. `ViewBag`/`ViewData` yerine tipli model.
- POST formlarında anti-forgery token (`[ValidateAntiForgeryToken]` veya global filtre); PRG (Post/Redirect/Get) deseni.
- Razor çıktısı varsayılan olarak encode edilir; `Html.Raw` yalnızca sanitize edilmiş içerikle ve gerekçesi yazılarak.
- Layout: `_Layout.cshtml`, `_ViewImports.cshtml`, `_ViewStart.cshtml`; tekrar eden UI View Component'e.
- Erişilebilirlik: semantik HTML, form alanlarında `<label asp-for>`, doğrulama mesajları `aria-describedby` ile bağlı.
- Güvenlik başlıkları ve CSP middleware'de; statik dosyalar `asp-append-version="true"` ile önbellek kırma.
- Async: tüm I/O async; `.Result` / `.Wait()` yasak.
- Sırlar: local'de User Secrets; `appsettings.json`'a gerçek sır yazılmaz.

## Komutlar (project.md > Komutlar'a örnek)
İzleme modundaki komutlar ve açık kalan sunucu kanıt değildir (K2/K5).

| Amaç | Komut |
|---|---|
| Restore | `dotnet restore` |
| Build | `dotnet build -warnaserror` |
| Test | `dotnet test` |
| Format | `dotnet format --verify-no-changes` |
| İstemci kütüphaneleri | `libman restore` (LibMan kullanılıyorsa) |
| Güvenlik açığı taraması | `dotnet list package --vulnerable --include-transitive` |
| Görsel kontrol | `timeout 120 dotnet run --no-build --urls http://127.0.0.1:5080 &` → kontrol → kapat (K2) |

## Test
| Tür | Araç |
|---|---|
| Unit | xUnit + FluentAssertions (controller/servis) |
| Integration | WebApplicationFactory + AngleSharp: sayfa 200 döner, form doğrulaması, anti-forgery, yetkisiz erişim yönlendirmesi |
| Görsel / E2E | tester (Playwright); tasarım kapısı ekran görüntüleri (K8) |

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `api.nuget.org`: NuGet paket indeksi (`dotnet restore`)
- `globalcdn.nuget.org`: NuGet paket indirmeleri
- `dotnetcli.azureedge.net`: .NET SDK/araç indirmeleri (`dotnet tool restore`)
- `builds.dotnet.microsoft.com`: .NET SDK/araç indirmeleri (yeni adres)

LibMan varsayılan sağlayıcısı (`api.cdnjs.com`, `cdnjs.cloudflare.com`) veya npm (`registry.npmjs.org`) kullanılıyorsa `team.json > sandbox.allowedDomains` ile eklenir.

## DoD ek maddeleri
- [ ] `dotnet build -warnaserror` ve `dotnet format --verify-no-changes` temiz
- [ ] Yeni POST uçlarında anti-forgery ve sunucu tarafı doğrulama var; entegrasyon testi kapsıyor
- [ ] `Html.Raw` kullanımı yok veya gerekçesi yazılı
- [ ] `dotnet list package --vulnerable` yeni yüksek/kritik açık göstermiyor

## Yetkinlik vurguları
Razor ve Tag Helper'lar, model bağlama ve doğrulama hattı, filtreler ve middleware, cookie kimlik doğrulama ve yetkilendirme politikaları, output caching, htmx ile kısmi sayfa güncelleme.
