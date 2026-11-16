---
name: setup-project
description: Bir ürün reposuna agent-team proje katmanını (AdditionalAgentInformation/ bağlam, kurallar, team.json, rol hafızaları; Docs/Project şablonları; isteğe bağlı pre-commit kontrolü) kurar ve takım ön kontrolünü çalıştırır. Kullanıcı "projeyi agent-team'e hazırla", "/agent-team:setup-project" dediğinde veya takım işi istenip proje katmanı yoksa ana oturum kullanır.
argument-hint: "[--githooks] [--no-sandbox] [--name <proje-adı>]"
disable-model-invocation: true
---

# /agent-team:setup-project

Yalnızca **ana oturum** çalıştırır (takım üyeleri proje katmanının kullanıcıya ait dosyalarına yazamaz).

1. **Hedefi doğrula:** Mevcut çalışma dizininin ürün reposu olduğundan emin ol (`git rev-parse --show-toplevel`). Repo değilse kullanıcıya sor: `git init` yapılsın mı (`--init-git`)?
2. **Kullanıcıya sor (tek mesajda):**
   - Commit öncesi agent kontrolü (pre-commit hook) kurulsun mu? → evetse `--githooks`
   - Hangi roller kullanılacak, hangi yığın profilleri? (Bilinmiyorsa varsayılanla devam et; sonra `team.json`'dan değiştirilir.)
   - Sandbox (PLUGIN.md > 1.1): macOS, Linux ve WSL2'de varsayılan olarak açılır; proje `.claude/settings.json` dosyasına sandbox bloğu ve profillerin ağ izinleri **birleştirilir** (var olan ayar ezilmez). İstemiyorsa → `--no-sandbox`. Sandbox kullanıcının kendi ana oturumunu da kapsar; bunu söyle.
3. **Önce kuru çalıştır,** ne yazılacağını göster:
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js" --dry-run [--githooks] [--no-sandbox]
   ```
4. **Onaydan sonra gerçek çalıştır** (aynı argümanlarla, `--dry-run` olmadan). Betik var olan hiçbir dosyanın üzerine yazmaz.
5. **team.json'u kullanıcının cevaplarına göre düzenle:** kullanılmayan rol → `"enabled": false`; profil → `"profile": "<ad>"` (mevcut profiller: `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`); klasörler farklıysa `paths`; projeye özel ağ izinleri → `sandbox.allowedDomains`. Sonra kurulumu **aynı argümanlarla yeniden çalıştır**: var olan dosyalara dokunmaz, yalnızca seçilen profillerin eksik ağ izinlerini ekler ve ön kontrolü çalıştırır:
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js" [--githooks] [--no-sandbox]
   ```
   **Hazır profil yoksa taslak üret:** Bir rolün yığını için plugin'de profil yoksa (mevcut profiller: `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`; tarama notunda "hazır profil yok") kullanıcıya sor: taslak profil hazırlansın mı? Evet ise:
   - `${CLAUDE_PLUGIN_ROOT}/templates/profile.md` şablonunu `AdditionalAgentInformation/profiles/<ad>.md` olarak kopyala ve doldur (plugin'e yazma). İçerik generic kalır; projeye özgü bilgi `project.md`'ye gider. Paket indeksi alan adlarını yığının resmi dokümanından al, tahmin etme.
   - Doğrula: `node "${CLAUDE_PLUGIN_ROOT}/scripts/profile-check.js" AdditionalAgentInformation/profiles/<ad>.md --role <rol>`. HATA kalmayana kadar düzelt.
   - `team.json`'da `"profile": "<ad>"` yap. Profildeki komutları bir kez ön planda çalıştırıp doğrula (K1); kullanıcı taslağı gözden geçirip onaylar.
   - Hayır ise `"profile": null` kalır; ajan mevcut kodun yığınına uyar.
6. **Playwright Chromium:** Ön kontrol `Playwright Chromium yok` diyorsa kullanıcıya sor: `npx playwright install chromium` (~150 MB, sudo gerekmez; tasarım kapısı ve E2E için) şimdi çalıştırılsın mı? Evet → çalıştır ve sonucu göster; hayır → yalnızca uyar. Linux'ta sistem kütüphanesi hatası çıkarsa `sudo npx playwright install-deps chromium` komutunu kullanıcı kendisi çalıştırır.
7. **Özetle:** oluşturulan/atlanan dosyalar, sandbox özeti (eklenen ayarlar, dokunulmayan farklı değerler, eksik `bwrap`/`socat` varsa kurulum komutu: kullanıcı kendisi `sudo` ile kurar), preflight sonucu (FAIL/WARN satırları ve çözümleri), doldurulması gereken `project.md` alanları. Commit'i kullanıcı atar.

**Var olan katmanı yükseltme:** Ön kontrol veya kurulum "katman sürümü eski" derse kullanıcıya `--upgrade --dry-run` çıktısını göster; onaylarsa `--upgrade` ile uygula. Yükseltme yalnızca eksik alanları ekler.

Kurallar:
- Var olan `AdditionalAgentInformation/` içeriğini silme veya baştan yazma; eksikleri tamamla.
- `project.md`'yi kullanıcı adına uydurma bilgiyle doldurma; yalnızca kullanıcının verdiği veya repodan doğrulayabildiğin bilgileri yaz (ör. `package.json`'dan komutlar) ve hangilerini çıkarım yaptığını belirt.
- Sistem paketi (`bubblewrap`, `socat`) kurma; komutu kullanıcıya ver.
- Plugin'i projede etkinleştirmek gerekiyorsa komutu kullanıcıya ver (`claude plugin install agent-team@<marketplace> --scope project`); kendin çalıştırma.
