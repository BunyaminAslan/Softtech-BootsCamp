# Profil: web / nextjs

> Kullanım: `team.json` → `"web": { "profile": "nextjs" }`. `senior-web-developer.md`'yi Next.js'e uyarlar; onu gevşetmez.

## Yığın

| Katman | Varsayılan | Not |
|---|---|---|
| Framework | **Next.js (App Router)**, React Server Components | Statik/ISR öncelikli; `"use client"` yalnızca etkileşim gereken yaprak component'lerde |
| Dil | **TypeScript strict** | `noUncheckedIndexedAccess`, `any` yok |
| Stil | **Tailwind CSS** + CSS değişkenleri (token'lar) | Token'lar K4 ADR'sinden |
| Animasyon | **Motion** (`motion/react`) | Sayfa geçişleri, `layout` animasyonları, gesture; `useReducedMotion()` |
| UI primitifleri | Radix UI / shadcn/ui (kopyalanan component'ler) | Görünüm token'lardan |
| Veri | Server Component'te `fetch` (cache/revalidate bilinçli), istemcide TanStack Query | |
| Form | react-hook-form + zod | Şema sözleşmeden türetilir |
| API istemcisi | `openapi-typescript` + `openapi-fetch` veya orval | Elle DTO yazılmaz |
| i18n | `next-intl` | |
| Test | **Vitest** + Testing Library + MSW | E2E tester'da (Playwright) |
| Kalite | ESLint (`next/core-web-vitals`, `jsx-a11y`), Prettier, `tsc --noEmit` | |

## Konvansiyonlar
- Klasörler: `web/src/app/` (route'lar), `web/src/features/<özellik>/`, `web/src/components/ui/`, `web/src/lib/`, `web/src/styles/`.
- Route seviyesinde `error.tsx`, `not-found.tsx`, `loading.tsx`.
- Ortam değişkenleri: `NEXT_PUBLIC_*` yalnızca herkese açık değerler; `env.ts` içinde zod ile doğrulanır.
- CSP ve güvenlik başlıkları `middleware.ts` (nonce) ve `next.config` `headers()` ile.
- Görseller `next/image` (`sizes`, LCP için `priority`); fontlar `next/font`; üçüncü parti script'ler `next/script` + `strategy`; ağır component'ler `dynamic()`.
- SEO: `metadata` / `generateMetadata`, `sitemap.ts`, `robots.ts`.
- Scroll animasyonları `whileInView` + `viewport={{ once: true }}`.

## Komutlar (project.md > Komutlar'a örnek)
| Amaç | Komut |
|---|---|
| Kurulum | `npm ci` |
| Lint / tip | `npm run lint` · `npx tsc --noEmit` |
| Test | `npx vitest run` |
| Build (kanıt) | `npx next build` |
| Bundle analizi | `ANALYZE=true npx next build` (`@next/bundle-analyzer` kuruluysa) |
| Görsel kontrol | `timeout 120 npx next start -p 3000 &` → kontrol → kapat (K2) |
`next dev` bitti kriteri olamaz (K5).

## Test
| Tür | Araç |
|---|---|
| Unit / component | Vitest + Testing Library (`npx vitest run`) |
| API mock | MSW (sözleşmedeki örneklerden) |
| E2E | tester (Playwright) |

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `registry.npmjs.org`: npm paketleri
- `fonts.googleapis.com`: `next/font/google` build sırasında font CSS'ini indirir
- `fonts.gstatic.com`: font dosyaları

Yarn veya pnpm kullanılıyorsa kendi registry'si (`registry.yarnpkg.com`), harici görsel/CMS/API kaynakları `team.json > sandbox.allowedDomains` ile eklenir.

## DoD ek maddeleri
- [ ] `npx next build` başarılı, route başına First Load JS raporlandı
- [ ] `"use client"` yalnızca gereken yaprak component'lerde
- [ ] `NEXT_PUBLIC_*` değişkenlerinde sır yok

## Önerilen proje skill'leri
Plugin'deki web skill'leri (`frontend-design`, `ui-ux-pro-max`, `impeccable`, `animate`, `review-animations`, `animation-performance`) bu profil için yeterlidir. Landing/pazarlama sayfaları için `taste-skill` (Leonxlnx/taste-skill) değerlendirilebilir; framework incelemesinden henüz geçmedi (bkz. `${CLAUDE_PLUGIN_ROOT}/skills/README.md`), kurulacaksa projenin `.claude/skills/` klasörüne, SKILL.md okunarak.
