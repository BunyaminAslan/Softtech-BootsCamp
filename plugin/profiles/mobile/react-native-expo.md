# Profil: mobile / react-native-expo

> Kullanım: `team.json` → `"mobile": { "profile": "react-native-expo" }`. `senior-mobile-developer.md`'yi React Native + Expo'ya uyarlar; onu gevşetmez.

## Yığın (yeni projede varsayılan öneri)
TypeScript strict, Expo (prebuild / dev client), Expo Router, TanStack Query, Zustand, react-hook-form + zod, MMKV, expo-secure-store / react-native-keychain, i18next, Reanimated + Gesture Handler. API istemcisi sözleşmeden üretilir (orval / openapi-typescript).

## Konvansiyonlar
- New Architecture (Fabric, TurboModules) açık; Hermes.
- Token'lar tek bir `theme/` modülünde; web ile paylaşılacaksa ortak paket veya ADR'de tanımlı kaynak.
- Test ID'leri: `testID="<ekran>_<öğe>"`; `Docs/Mobile/TEST_IDS.md`.
- Animasyonlar UI thread'de (Reanimated worklet'leri); `useReducedMotion` (K3).
- Token'lar yalnızca secure store'da; AsyncStorage'da token yok.

## Komutlar (project.md > Komutlar'a örnek)
| Amaç | Komut |
|---|---|
| Kurulum | `npm ci` (uzun sürer: arka planda, K2) |
| Lint / tip | `npm run lint` · `npx tsc --noEmit` |
| Test | `npx jest --ci --watchAll=false` |
| Sağlık | `npx expo-doctor` |
| Derlenebilirlik kanıtı | `npx expo export --platform android --output-dir <geçici-dizin>` (web hedefi varsa `--platform web`) |
| Bağımlılık hizalama | `npx expo install --check` |
`npx expo start` **bitti kriteri olamaz** (K5); canlı deneme gerekiyorsa arka planda + timeout, `CI=1` ile ve sonunda kapatılarak (K2). Metro süreci kapatılırken PID `ss -ltnp | grep 8081` ile bulunur; `pkill -f "expo start"` kullanılmaz.

## Bilinen tuzaklar (generic)
- `npx expo install a b -- --save-dev` dev bağımlılıklarını `dependencies`'e yazabilir; devDependencies'i elle düzenleyip `npm install` daha güvenli.
- SDK yükseltmelerinde peer çakışması (ERESOLVE) çıkarsa `overrides` ile hizala; `--legacy-peer-deps` kullanma.
- `create-expo-app` `AGENTS.md` ve (Claude Code kuruluysa) `.claude/settings.json` üretebilir → `lead`'e raporla (K6).
- Reanimated jest altında mock gerektirir; gerçek bundle'ı `expo export` ile kanıtla.
- EAS build/submit/update guard tarafından engellenir; kullanıcı kararıdır.

## Test
| Tür | Araç |
|---|---|
| Unit | Jest |
| Component | React Native Testing Library |
| Integration (cihazsız) | Jest + MSW |
E2E (Maestro / Detox) tester'ındır.

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `registry.npmjs.org`: npm paketleri
- `api.expo.dev`: Expo API (`expo install` sürüm eşleştirme, `expo-doctor`)
- `exp.host`: Expo API (eski uç noktalar)
- `services.gradle.org`: Gradle dağıtımı (yerel Android build)
- `plugins.gradle.org`: Gradle eklentileri
- `repo.maven.apache.org`: Maven Central
- `dl.google.com`: Google Maven
- `maven.google.com`: Google Maven
- `cdn.cocoapods.org`: CocoaPods spec CDN'i (yerel iOS build, macOS'ta)

Yarn veya pnpm kullanılıyorsa kendi registry'si (`registry.yarnpkg.com`) `team.json > sandbox.allowedDomains` ile eklenir. EAS build/submit zaten guard tarafından yasaktır.

## DoD ek maddeleri
- [ ] `npx tsc --noEmit` ve lint temiz
- [ ] `npx expo-doctor` uyarısız
- [ ] `npx expo export --platform android` başarılı (web hedefi varsa web de)

## Önerilen proje skill'leri
Aşağıdakiler incelenmiş ve önerilir; **projenin** `.claude/skills/` klasörüne kurulur (framework'e değil). Kurulumdan önce SKILL.md yeniden okunur; EAS yayın talimatları uygulanmaz.

| Skill | Kaynak | İncelenen commit | Not |
|---|---|---|---|
| expo-overview, expo-router, expo-animation, expo-design-system, expo-data-fetching, expo-upgrade | [expo/skills](https://github.com/expo/skills) (resmi, MIT) | `ab6cb2c` | `plugins/expo/skills/<ad>` klasörlerini kopyalayın; önce `expo-overview` |
| react-native-best-practices | [software-mansion-labs/skills](https://github.com/software-mansion-labs/skills) (MIT) | `43cde80` | Reanimated, Gesture Handler, New Architecture |

Kurulum örneği (proje kökünde, kullanıcı çalıştırır):
```sh
git clone --depth 1 https://github.com/expo/skills.git /tmp/expo-skills
mkdir -p .claude/skills && cp -r /tmp/expo-skills/plugins/expo/skills/{expo-overview,expo-router,expo-animation,expo-design-system,expo-data-fetching,expo-upgrade} .claude/skills/
```
