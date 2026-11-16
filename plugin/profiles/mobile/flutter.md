# Profil: mobile / flutter

> Kullanım: `team.json` → `"mobile": { "profile": "flutter" }`. `senior-mobile-developer.md`'yi Flutter'a uyarlar; onu gevşetmez.

## Yığın (yeni projede varsayılan öneri)
Dart (null safety), Riverpod (veya Bloc), go_router, Dio + Retrofit, freezed + json_serializable, drift / Isar (offline), flutter_secure_storage, intl / ARB, very_good_analysis. API istemcisi sözleşmeden üretilir (openapi-generator / swagger_parser).

## Konvansiyonlar
- Feature-first: `lib/features/<feature>/{presentation, application, domain, data}` + `lib/core/`.
- State ve modeller immutable (freezed). `build` metodunda iş mantığı yok; `const` widget'lar.
- Üretilen dosyalar (`*.g.dart`, `*.freezed.dart`) elle yazılmaz; `build_runner` çalıştırılır. Commit'e dahil edilip edilmeyeceği `rules.md`'de belirtilir.
- Token'lar `lib/core/theme` içinde; widget içinde sabit renk/boyut yok.
- Test anahtarları: `Key('<ekran>_<öğe>')`.
- Release: `--obfuscate --split-debug-info`.

## Komutlar (project.md > Komutlar'a örnek)
| Amaç | Komut |
|---|---|
| Bağımlılık | `flutter pub get` · `flutter pub outdated` |
| Analiz | `flutter analyze` · `dart format --set-exit-if-changed .` |
| Test | `flutter test` |
| Kod üretimi | `dart run build_runner build --delete-conflicting-outputs` · `flutter gen-l10n` |
| Build (kanıt) | `flutter build apk --debug` |
| Ortam | `flutter doctor` · `flutter devices` |
`flutter run` yalnızca local emülatör/cihaza ve arka planda + timeout ile (K2).

## Test
| Tür | Araç |
|---|---|
| Unit | flutter_test + mocktail |
| Widget | flutter_test |
| Golden | golden_toolkit / alchemist |
| Integration (cihazsız) | integration_test + mock API |
E2E (Patrol / Maestro) tester'ındır.

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler (PLUGIN.md > 1.1).
- `pub.dev`: paket indeksi (`flutter pub get`)
- `storage.googleapis.com`: paket arşivleri ve Flutter/Dart SDK artefaktları
- `services.gradle.org`: Gradle dağıtımı (Android build)
- `plugins.gradle.org`: Gradle eklentileri
- `repo.maven.apache.org`: Maven Central
- `dl.google.com`: Google Maven (Android Gradle eklentisi, AndroidX)
- `maven.google.com`: Google Maven
- `cdn.cocoapods.org`: CocoaPods spec CDN'i (iOS, macOS'ta)

## DoD ek maddeleri
- [ ] `flutter analyze` uyarısız, `dart format` temiz
- [ ] Golden testler light + dark ve büyük yazı boyutunda güncel
- [ ] `flutter build apk --debug` başarılı

## Önerilen proje skill'leri
Plugin'de Flutter'a özgü skill yok. Kullanılacaksa resmi kaynaktan incelenip projenin `.claude/skills/` klasörüne kurulur (`${CLAUDE_PLUGIN_ROOT}/skills/README.md` > inceleme kuralları).
