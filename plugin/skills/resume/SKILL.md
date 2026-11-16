---
name: resume
description: Kesintiden (kullanım limiti, kapanan oturum) sonra agent team'i kaldığı yerden yeniden kurar. Plan dokümanlarından, görev listesinden, rollerin worklog'larından, kanıt kaydından ve git durumundan bir devam özeti çıkarır, kullanıcıya gösterir ve lead'i "devam modu"nda başlatır; lead yalnızca bitmemiş görevi olan üyeleri yeniden başlattırır. Kullanıcı "/agent-team:resume", "takım kaldığı yerden devam etsin", "limit bitti, devam" dediğinde ana oturum kullanır.
argument-hint: "[ek not]"
---

# /agent-team:resume

Yalnızca **ana oturum** çalıştırır. In-process teammate'ler oturum devamında (`/resume`, `--continue`) geri gelmez; bu skill takımı yeni bir oturumda yeniden kurar.

1. **Devam özetini çıkar** (dosya değiştirmez, komut çalıştırmaz):
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/resume-status.js"
   ```
   Proje katmanı yoksa veya plan/görev yoksa devam edilecek bir takım işi yoktur; kullanıcıya söyle ve dur.
2. **Kullanıcıya göster:** plan durumu, bitmemiş görevler, rollerin son durumu, açık kalmış olabilecek arka plan süreçleri, commit'lenmemiş değişiklikler, yeniden başlatılması önerilen roller. Şunu sor: devam edilsin mi; arada kendisi bir şey değiştirdi mi; arka plan süreçleri ne olsun (kontrol/kapatma kararı kullanıcının)?
3. **Ön kontrol:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/team-preflight.js"`. FAIL varsa düzeltilmeden devam etme.
4. **lead'i devam modunda başlat:** `/agent-team:team` skill'indeki gibi `agent-team:tech-lead` tipinde, adı **`lead`** olan teammate; prompt şablonu:
   ```
   Takım modundasın; adın `lead`, takım lideri sensin. Ana oturum (Claude) ile SendMessage üzerinden konuşursun.
   DEVAM MODU: önceki oturum kesildi. tech-lead.md Bölüm 4.11'i uygula; yeni plan yapma.

   ## Devam özeti (resume-status.js çıktısı, aynen)
   <özetin tamamı>

   ## Kullanıcının notları
   - <2. adımdaki cevaplar, arka plan süreçleri kararı, kullanıcının yaptığı değişiklikler>

   ## Ortam
   - Proje kökü: <pwd>
   - Preflight: <PASS/WARN + WARN satırları>
   ```
5. Sonrası `/agent-team:team` skill'indeki gibidir: `[SPAWN-REQUEST]`leri değiştirmeden uygula, `[QUESTION]`/`[STATUS]`/`[BLOCKED]`/`[DONE]` mesajlarını kullanıcıya aynen aktar.

Kurallar:
- Görevleri sen yeniden açma veya üyeleri kendi kararınla başlatma; görev listesini lead onarır, üyeleri lead ister.
- Arka plan süreçlerini kullanıcı onayı olmadan kapatma.
- Commit'lenmemiş değişiklikleri geri alma veya commit etme.
