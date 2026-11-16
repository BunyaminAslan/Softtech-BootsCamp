# Profil: <rol> / <ad>

> Kullanım: `AdditionalAgentInformation/team.json` → `"<rol>": { "profile": "<ad>" }`.
> Bu profil `<ajan-dosyası>.md`'deki generic kuralları <yığın>'a uyarlar; onları gevşetmez.
> Doğrulama: `node "${CLAUDE_PLUGIN_ROOT}/scripts/profile-check.js" <dosya>` (zorunlu bölümler, komut tablosu, DoD, alan adları).

## Yığın (yeni projede varsayılan öneri)

| Katman | Varsayılan | Not |
|---|---|---|
| Runtime | <doldur> | Mevcut kod varsa onun sürümü kazanır |
| Test | <doldur> | |

## Konvansiyonlar
- <doldur: dil/framework konvansiyonları, hata modeli, async, konfigürasyon, sırlar>

## Komutlar (project.md > Komutlar'a örnek)
Yalnızca **biten** komutlar (K2/K5); sunucu/watch komutu kanıt komutu değildir.

| Amaç | Komut |
|---|---|
| Kurulum | `<doldur>` |
| Build | `<doldur>` |
| Test | `<doldur>` |
| Lint/Format | `<doldur>` |
| Güvenlik açığı taraması | `<doldur>` |

## Test
| Tür | Araç |
|---|---|
| Unit | <doldur> |
| Integration | <doldur> |

## Ağ izinleri (sandbox)
`setup-project` bu listeyi projenin `.claude/settings.json > sandbox.network.allowedDomains` alanına ekler. Her madde: ``- `alan.adi`: neden``.
- `<doldur.ornek.org>`: paket indeksi

## DoD ek maddeleri
- [ ] <doldur: build/lint/test komutları temiz>
- [ ] <doldur: güvenlik açığı taraması yeni yüksek/kritik açık göstermiyor>

## Yetkinlik vurguları
<doldur>
