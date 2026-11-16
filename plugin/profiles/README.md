# Yığın profilleri

Ajan dosyaları (`agents/*.md`) yığından bağımsızdır. Bir rolün belirli bir teknolojiyle nasıl çalışacağı **profil** dosyasındadır. Proje, hangi profilin kullanılacağını `AdditionalAgentInformation/team.json` içinde seçer:

```json
{ "roles": { "backend": { "profile": "dotnet" }, "mobile": { "profile": "flutter" }, "web": { "profile": "nextjs" } } }
```

## Arama sırası
1. Projenin `AdditionalAgentInformation/profiles/<ad>.md` dosyası (projeye özel veya özelleştirilmiş profil)
2. Plugin'in `profiles/<rol>/<ad>.md` dosyası

Profil tanımlı değilse ajan mevcut kodun yığınına uyar; yeni projede yığın seçimini `lead` ile ADR + kullanıcı onayıyla yapar. `team-preflight.js`, `team.json`'da adı geçen bir profil hiçbir yerde bulunamazsa FAIL verir.

## Mevcut profiller

| Rol | Profil | Özet |
|---|---|---|
| backend | `dotnet` | .NET + ASP.NET Core, EF Core, xUnit |
| backend | `node` | Node.js + TypeScript, Fastify, zod, Drizzle/Prisma, Vitest |
| backend | `python` | Python + uv, FastAPI, Pydantic v2, SQLAlchemy 2.0 + Alembic, pytest |
| mobile | `flutter` | Flutter + Riverpod/Bloc, go_router |
| mobile | `react-native-expo` | React Native + Expo Router, TanStack Query; önerilen Expo skill'leri |
| mobile | `native` | Kotlin/Compose + Swift/SwiftUI |
| web | `nextjs` | Next.js App Router + TypeScript + Tailwind + Motion |
| web | `aspnet-mvc` | ASP.NET Core MVC / Razor Pages, Tag Helpers, htmx |

## Hazır profil yoksa
`setup-project` / `onboard` kullanıcıya sorar ve `templates/profile.md` şablonundan projeye bir taslak üretir (`AdditionalAgentInformation/profiles/<ad>.md`; plugin'e yazılmaz). Proje profili aynı adlı hazır profili gölgeler. İyi bir proje profili PR ile buraya taşınabilir.

## Doğrulama
`scripts/profile-check.js` (`<dosya>`, `--project <dizin>`, `--builtin`) zorunlu bölümleri denetler: `# Profil: <rol> / <ad>` başlığı; `## Yığın`, `## Konvansiyonlar`, `## Komutlar` (`komut` içeren tablo), `## Test`, `## Ağ izinleri` (geçerli alan adları), `## DoD` (`- [ ]` maddeleri). Geçersiz profil:
- sandbox'a ağ izni eklemez;
- ön kontrolde WARN verir;
- SessionStart'ta ana oturum kullanıcıya sorar: Claude düzeltsin mi, yoksa `team.json`'da `"profile": null` yapılıp profilsiz mi devam edilsin? Guard, sahiplik ve kapılar profilden etkilenmez (`team.json`'dan gelir).

Hazır profiller `tests/hooks/profile.test.js` ile her commit'te aynı denetimden geçer.

## Profil yazma kuralları
- Profil, ajan dosyasındaki generic kuralları **uyarlar ve somutlaştırır; gevşetemez**. Çelişki olursa ajan dosyası ve `TEAM_RULES.md` kazanır.
- İçerik: yığın tablosu (yeni projede varsayılan öneri), konvansiyonlar, `project.md > Komutlar` için örnek komutlar (yalnızca **biten** komutlar; K2/K5), test araçları, DoD ek maddeleri, önerilen proje skill'leri (kaynak + incelenen commit).
- **`## Ağ izinleri (sandbox)` bölümü zorunludur:** yığının paket yöneticisi ve build araçlarının eriştiği alan adları; her biri ``- `alan.adi`: neden`` biçiminde bir madde. `setup-project` bu listeyi projenin sandbox ayarına ekler. Sandbox dışında çalışması gereken, gerekçesi yazılmış komutlar varsa `### Sandbox dışında çalışan komutlar` alt başlığında aynı biçimde listelenir (en az düzeyde tutulur; bu komutlarda OS kısıtı yoktur). `tests/hooks/sandbox.test.js` her yerleşik profilde bu bölümü denetler.
- Projeye özgü bilgi (ad, ortam, kişi, makine yolu) profile yazılmaz; o `project.md`'ye gider.
- Şablon: `templates/profile.md`. Yeni bir profil framework'e eklendiğinde bu tablo ve `onboard-scan.js` eşlemesi güncellenir.
