---
name: onboard
description: Var olan bir ürün reposunu agent-team'e hazırlar. Repoyu tarayıp yığını, uygun profili, build/test/lint komutlarını, klasör sahipliğini ve mevcut dokümanları tespit eder; project.md ve team.json taslağını tespit/tahmin işaretleriyle kullanıcı onayına sunar, komutları bir kez çalıştırıp doğrular. Kullanıcı "/agent-team:onboard", "bu repoya takımı kur", "mevcut projeyi agent-team'e bağla" dediğinde ana oturum kullanır. Boş repo için /agent-team:setup-project yeterlidir.
argument-hint: "[--no-sandbox] [--githooks]"
disable-model-invocation: true
---

# /agent-team:onboard

Yalnızca **ana oturum** çalıştırır. Hiçbir adımda kullanıcının dosyalarının üzerine yazılmaz. Commit kullanıcınındır.

1. **Hedefi doğrula:** `git rev-parse --show-toplevel`. Repo değilse dur ve kullanıcıya söyle (onboard var olan repo içindir).
2. **Proje katmanı:** `AdditionalAgentInformation/` yoksa önce kuru, onaydan sonra gerçek kurulum yap:
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js" --dry-run [--githooks] [--no-sandbox]
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js" [--githooks] [--no-sandbox]
   ```
3. **Tara** (komut çalıştırmaz, dosya yazmaz):
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/onboard-scan.js"
   ```
   Raporu kullanıcıya göster: tespit edilen uygulamalar ve roller, profiller, sahiplik yolları, komutlar, notlar (watch komutları, profili olmayan yığınlar, kökteki uygulama), mevcut dokümanlar. Her satırın **tespit** mi **tahmin** mi olduğunu koru.
4. **Kullanıcıya tek mesajda sor:** Roller ve yollar doğru mu? Kapatılacak/eklenecek rol var mı? Komutlar doğru mu (özellikle tahmin olanlar)? Var olan `CLAUDE.md`/`AGENTS.md` veya doküman klasörü varsa, içindeki kuralların `rules.md`'ye taşınmasını ister mi (taşımayı kullanıcı onaylarsa sen yaparsın; özgün dosyayı silme)?
5. **Taslakları yaz:**
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/onboard-scan.js" --write
   ```
   `team.json` ve `project.md` şablondan hiç değiştirilmemişse doğrudan güncellenir; değiştirilmişse yanlarına `.draft` dosyası yazılır. `.draft` varsa farkı kullanıcıya göster ve onayıyla birleştir. Sonra kullanıcının 4. adımdaki düzeltmelerini `team.json`/`project.md`'ye uygula.
   **Hazır profil yoksa taslak üret:** Bir rolün yığını için plugin'de profil yoksa (mevcut profiller: `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`; tarama notunda "hazır profil yok") kullanıcıya sor: taslak profil hazırlansın mı? Evet ise:
   - `${CLAUDE_PLUGIN_ROOT}/templates/profile.md` şablonunu `AdditionalAgentInformation/profiles/<ad>.md` olarak kopyala ve doldur (plugin'e yazma). İçerik generic kalır; projeye özgü bilgi `project.md`'ye gider. Paket indeksi alan adlarını yığının resmi dokümanından al, tahmin etme.
   - Doğrula: `node "${CLAUDE_PLUGIN_ROOT}/scripts/profile-check.js" AdditionalAgentInformation/profiles/<ad>.md --role <rol>`. HATA kalmayana kadar düzelt.
   - `team.json`'da `"profile": "<ad>"` yap. Komutlar 6. adımda doğrulanır; kullanıcı taslağı gözden geçirip onaylar.
   - Hayır ise `"profile": null` kalır; ajan mevcut kodun yığınına uyar.
6. **Komutları doğrula (K1):** `project.md > Komutlar` tablosundaki her build/test/lint komutunu **bir kez, ön planda** çalıştır (kurulum komutu ağ ve süre gerektirebilir; önce kullanıcıya sor). Sunucu/watch komutu çalıştırma. Her komut için `Komut / Dizin / Sonuç` yaz. Geçenlerin yanındaki "(tahmin, doğrulanmadı)" notunu kaldır; başarısız olanları kullanıcıya göster ve düzeltilmiş komutu birlikte belirleyin. Kırık bir baseline (ör. önceden kırık testler) bir bulgudur; düzeltmeye çalışma, raporla.
7. **Kurulumu yeniden çalıştır** (seçilen profillerin sandbox ağ izinlerini ekler, ön kontrolü çalıştırır):
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js" [--githooks] [--no-sandbox]
   ```
8. **Playwright Chromium:** Ön kontrol `Playwright Chromium yok` diyorsa kullanıcıya sor: `npx playwright install chromium` (~150 MB, sudo gerekmez; tasarım kapısı ve E2E için) şimdi çalıştırılsın mı? Evet → çalıştır ve sonucu göster; hayır → yalnızca uyar. Linux'ta sistem kütüphanesi hatası çıkarsa `sudo npx playwright install-deps chromium` komutunu kullanıcı kendisi çalıştırır.
9. **Özetle:** roller ve profiller, sahiplik yolları, doğrulanan/başarısız komutlar (K1 kanıtıyla), `.draft` dosyaları, ön kontrol sonucu, kullanıcının doldurması gereken `project.md` alanları (amaç, ortam, kısıtlar). Commit'i kullanıcı atar.

Kurallar:
- Tahmini tespit gibi sunma; emin olmadığın her şeyi kullanıcıya sor.
- `project.md`'ye repodan doğrulayamadığın bilgi yazma.
- Var olan dokümanları (README, ADR, CLAUDE.md) silme veya taşıma; yalnızca kullanıcı isterse içeriklerini proje katmanına aktar.
- Sistem paketi veya global araç kurma; eksik araç varsa komutu kullanıcıya ver.
