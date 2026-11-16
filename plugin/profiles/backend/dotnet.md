# Profil: backend / dotnet

> Kullanım: `AdditionalAgentInformation/team.json` → `"backend": { "profile": "dotnet" }`.
> Bu profil `senior-backend-developer.md`'deki generic kuralları .NET'e uyarlar; onları gevşetmez.

## Yığın (yeni projede varsayılan öneri)

| Katman | Varsayılan | Not |
|---|---|---|
| Runtime | .NET (güncel LTS) + ASP.NET Core Web API | Nullable reference types açık, `TreatWarningsAsErrors` |
| Mimari | Clean Architecture: `Domain`, `Application`, `Infrastructure`, `Api` | Küçük projede katman sayısını abartma |
| Veri erişimi | EF Core + PostgreSQL (alternatif: SQL Server) | Migration'lar kodla birlikte versiyonlanır |
| Doğrulama | FluentValidation | Application katmanında |
| Hata modeli | RFC 9457 ProblemDetails | Global exception handler |
| Loglama | Serilog (structured, JSON) + correlation id | PII loglanmaz |
| Kimlik | ASP.NET Core Identity / JWT Bearer + refresh token | Ya da projede kararlaştırılan IdP (Keycloak, Entra ID…) |
| Cache | `IDistributedCache` (Redis) | Önce ölç, sonra cache'le |
| Arka plan işleri | `BackgroundService` / Hangfire / Quartz | Gereksinime göre ADR |
| Mesajlaşma | Gerekirse RabbitMQ / MassTransit, Outbox pattern | Gerçek ihtiyaç yoksa ekleme |
| Gözlemlenebilirlik | Health checks, OpenTelemetry | `/health/live`, `/health/ready` |
| API dokümanı | OpenAPI (built-in / Swashbuckle) | Sözleşme dosyasıyla senkron |
| Test | xUnit, FluentAssertions, NSubstitute, Testcontainers, WebApplicationFactory, Bogus | |

## Konvansiyonlar
- Bağımlılık yönü: `Api → Application → Domain`, `Infrastructure → Application`.
- Application: use case başına handler (CQRS-lite). MediatR zorunlu değil; projede yoksa eklemek ADR ister.
- Beklenen iş hataları için `Result<T>` veya domain exception; global handler dışında `catch (Exception)` yasak.
- Async: tüm I/O async; `.Result` / `.Wait()` yasak; `CancellationToken` uçtan uca.
- DI: constructor injection; `DbContext` scoped; `static` mutable state yasak.
- Konfigürasyon: Options pattern + `ValidateOnStart`.
- İsimlendirme: .NET konvansiyonları; async metotlar `Async` ile biter.
- Anonim endpoint'ler `[AllowAnonymous]` ile açıkça işaretlenir; rate limiting için `RateLimiter`.
- Tarih: `DateTimeOffset`; para: `decimal`. Saat soyutlaması: `TimeProvider`.
- Sırlar: local'de User Secrets / `.env`; `appsettings.json`'a gerçek sır yazılmaz. `appsettings.Production.json` guard ile korunur.

## EF Core ve migration
- Migration SQL'i: `dotnet ef migrations script` ile gözden geçirilir.
- Concurrency: `RowVersion` / concurrency token.
- Audit alanları interceptor ile; soft delete global query filter ile.
- N+1'e karşı `Include` / projection (`Select`); salt okunur sorgularda `AsNoTracking`.
- Ham SQL yalnızca `FromSqlInterpolated` ile.

## Komutlar (project.md > Komutlar'a örnek)
| Amaç | Komut |
|---|---|
| Restore | `dotnet restore` |
| Build | `dotnet build -warnaserror` |
| Test | `dotnet test` |
| Kapsam | `dotnet test --collect:"XPlat Code Coverage"` |
| Format | `dotnet format --verify-no-changes` |
| Güvenlik açığı taraması | `dotnet list package --vulnerable --include-transitive` |
| Migration | `dotnet ef migrations add <Ad>` · `dotnet ef migrations list` · `dotnet ef migrations script` · `dotnet ef database update` (yalnızca local DB) |

Serbest komutlara ek: `dotnet ef migrations remove` yalnızca uygulanmamış son migration için. `dotnet ef database drop` guard tarafından engellenir.

## Test
| Tür | Araç |
|---|---|
| Unit | xUnit + FluentAssertions + NSubstitute |
| Integration | WebApplicationFactory + Testcontainers (gerçek DB) |
| Contract | OpenAPI şemasına karşı response doğrulama |
Test isimleri `Method_Scenario_ExpectedResult`.

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `api.nuget.org`: NuGet paket indeksi (`dotnet restore`)
- `globalcdn.nuget.org`: NuGet paket indirmeleri
- `dotnetcli.azureedge.net`: .NET SDK/araç indirmeleri (`dotnet tool restore`)
- `builds.dotnet.microsoft.com`: .NET SDK/araç indirmeleri (yeni adres)

Özel NuGet beslemeleri (Azure Artifacts, GitHub Packages) `team.json > sandbox.allowedDomains` ile eklenir. Entegrasyon testleri Docker (Testcontainers) kullanıyorsa Docker soketi sandbox içinde erişilemez; `dotnet test`'i sandbox dışına almak yerine kullanıcı `sandbox.network.allowUnixSockets` ile soketi açmaya karar verir.

## DoD ek maddeleri
- [ ] `dotnet build -warnaserror` geçiyor
- [ ] `dotnet format --verify-no-changes` temiz
- [ ] `dotnet list package --vulnerable` yeni yüksek/kritik açık göstermiyor
- [ ] Yeni migration'ın SQL'i (`dotnet ef migrations script`) incelendi

## Yetkinlik vurguları
Modern C# (records, pattern matching, primary constructors), .NET runtime/GC/async iç yapısı, ASP.NET Core minimal API ve controller'lar, EF Core (compiled queries, interceptor'lar, owned types), Polly, dotnet-counters / dotnet-trace, BenchmarkDotNet.
