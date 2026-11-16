# Profil: backend / node

> Kullanım: `AdditionalAgentInformation/team.json` → `"backend": { "profile": "node" }`.
> Bu profil `senior-backend-developer.md`'deki generic kuralları Node.js + TypeScript'e uyarlar; onları gevşetmez.

## Yığın (yeni projede varsayılan öneri)

| Katman | Varsayılan | Not |
|---|---|---|
| Runtime | Node.js (güncel LTS) + **TypeScript strict** | `engines.node` ve `.nvmrc` sabitlenir; `any` yok |
| Framework | **Fastify** (alternatif: NestJS büyük ekip/modüler monolit için, Express mevcut kodda) | Seçim ADR ile |
| Doğrulama / şema | **zod** (veya TypeBox + Fastify şemaları) | Şema sözleşmeden (OpenAPI) türetilir veya sözleşmeyi üretir; tek kaynak |
| Veri erişimi | **Drizzle ORM** veya Prisma + PostgreSQL | Migration'lar kodla versiyonlanır |
| Hata modeli | RFC 9457 ProblemDetails | Merkezi error handler |
| Loglama | **pino** (structured, JSON) + request id | PII loglanmaz |
| Kimlik | JWT (jose) + refresh token veya projede kararlaştırılan IdP | Sırlar ortam değişkeninden |
| Arka plan işleri | BullMQ (Redis) | Gereksinime göre ADR |
| Gözlemlenebilirlik | Health endpoint'leri, OpenTelemetry | `/health/live`, `/health/ready` |
| API dokümanı | OpenAPI (`@fastify/swagger` / NestJS Swagger) | Sözleşme dosyasıyla senkron |
| Test | **Vitest** + Supertest / `fastify.inject`, Testcontainers | |
| Kalite | ESLint (typescript-eslint), Prettier, `tsc --noEmit` | |

## Konvansiyonlar
- Katmanlar: `routes/` (HTTP) → `services/` (use case) → `repositories/` (veri). Route handler'da iş kuralı yok.
- ESM (`"type": "module"`); import yolları tutarlı; döngüsel bağımlılık yok.
- Tüm I/O async; yakalanmamış promise yok (`no-floating-promises`). `process.on("unhandledRejection")` loglar ve süreci kontrollü kapatır.
- Girdi her uçta zod/şema ile doğrulanır; doğrulanmamış `req.body` iş katmanına geçmez.
- Konfigürasyon: `env.ts` içinde zod ile doğrulanır, uygulama açılırken hata verir. `.env` git'e girmez; `.env.example` güncel tutulur.
- Graceful shutdown: SIGTERM'de yeni istek alınmaz, açık bağlantılar ve DB havuzu kapatılır.
- Tarih: ISO 8601 / UTC; para: tamsayı (kuruş) veya decimal kütüphanesi, `number` ile kayan nokta değil.
- Bağımlılık eklemeden önce bakım durumu ve lisansı kontrol edilir; `package-lock.json` commit'lenir.

## Komutlar (project.md > Komutlar'a örnek)
Geliştirme sunucusu ve izleme modundaki test komutları kanıt değildir (K2/K5).

| Amaç | Komut |
|---|---|
| Kurulum | `npm ci` |
| Tip kontrolü | `npx tsc --noEmit` |
| Lint | `npx eslint .` |
| Test | `npx vitest run` |
| Kapsam | `npx vitest run --coverage` |
| Build | `npm run build` |
| Güvenlik açığı taraması | `npm audit --audit-level=high` |
| Migration | `npx drizzle-kit generate` · `npx drizzle-kit migrate` (yalnızca local DB) |

## Test
| Tür | Araç |
|---|---|
| Unit | Vitest |
| Integration | `fastify.inject` / Supertest + Testcontainers (gerçek DB) |
| Contract | OpenAPI şemasına karşı response doğrulama |

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `registry.npmjs.org`: npm paketleri (`npm ci`)
- `nodejs.org`: native modül derlemesinde node-gyp başlık dosyaları

Yarn/pnpm (`registry.yarnpkg.com`), özel registry veya Prisma motor indirmesi (`binaries.prisma.sh`) gerekiyorsa `team.json > sandbox.allowedDomains` ile eklenir. Testcontainers Docker soketi ister; karar kullanıcınındır (`sandbox.network.allowUnixSockets`).

## DoD ek maddeleri
- [ ] `npx tsc --noEmit` ve `npx eslint .` temiz
- [ ] `npx vitest run` geçiyor (K1 kanıtıyla)
- [ ] `npm audit --audit-level=high` yeni yüksek/kritik açık göstermiyor
- [ ] Yeni ortam değişkeni `env.ts` şemasına ve `.env.example`'a eklendi

## Yetkinlik vurguları
Node.js event loop ve stream'ler, TypeScript tip sistemi (generics, discriminated unions), Fastify eklenti mimarisi, bağlantı havuzu ve transaction yönetimi, `--inspect` / clinic.js ile profil çıkarma.
