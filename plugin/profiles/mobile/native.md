# Profil: mobile / native

> Kullanım: `team.json` → `"mobile": { "profile": "native" }`. `senior-mobile-developer.md`'yi native Android + iOS'a uyarlar; onu gevşetmez.

## Yığın (yeni projede varsayılan öneri)
- **Android:** Kotlin, Jetpack Compose, MVVM + UDF, Hilt, Retrofit/OkHttp, Room, Coroutines/Flow, EncryptedSharedPreferences / Keystore, ktlint + detekt.
- **iOS:** Swift, SwiftUI, async/await + Swift Concurrency, URLSession, SwiftData / Core Data, Keychain, SwiftLint.
- API istemcisi sözleşmeden üretilir (openapi-generator).

## Konvansiyonlar
- Test ID'leri: Android `testTag`, iOS `accessibilityIdentifier`; `Docs/Mobile/TEST_IDS.md`.
- Release: Android R8/ProGuard; iOS'ta debug bayrakları kapalı.
- iOS doğrulaması macOS gerektirir; ortamda yoksa açıkça belirtilir.

## Komutlar (project.md > Komutlar'a örnek)
| Amaç | Komut |
|---|---|
| Android lint/test | `./gradlew lint test -q` |
| Android build (kanıt) | `./gradlew assembleDebug -q` |
| Android cihaz testleri | `./gradlew connectedDebugAndroidTest` (local emülatör) |
| iOS test (macOS) | `xcodebuild test -quiet -scheme <scheme> -destination 'platform=iOS Simulator,name=<cihaz>'` |

## Test
Unit: JUnit + MockK / XCTest. UI: Compose UI Test / XCUITest. Snapshot: Paparazzi / swift-snapshot-testing. E2E (Maestro / Appium) tester'ındır.

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `services.gradle.org`: Gradle dağıtımı
- `plugins.gradle.org`: Gradle eklentileri
- `repo.maven.apache.org`: Maven Central
- `dl.google.com`: Google Maven (Android Gradle eklentisi, AndroidX)
- `maven.google.com`: Google Maven
- `cdn.cocoapods.org`: CocoaPods spec CDN'i (CocoaPods kullanılıyorsa)

Swift Package Manager bağımlılıkları genellikle `github.com` üzerinden gelir (ortak listede). Başka bir kaynak varsa `team.json > sandbox.allowedDomains` ile eklenir.

## DoD ek maddeleri
- [ ] `./gradlew lint test assembleDebug` başarılı
- [ ] iOS etkisi varsa macOS doğrulaması gerektiği not edildi
