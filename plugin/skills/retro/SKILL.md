---
name: retro
description: Sprint retrospektifi yapar ve dersleri ikiye ayırır. Projeye ait dersler kullanıcı onayıyla rules.md'ye veya rol hafızasına işlenir. Genel dersler, projeye özgü bilgi içermeyen bir issue taslağı olarak framework reposuna önerilir. Kullanıcı "retro", "retrospektif" veya "sprintten ne öğrendik" dediğinde ya da lead'in [DONE] mesajından sonra kullanılır.
---

# /agent-team:retro

Ana oturumda çalışır. lead sprint kapanışında (tech-lead.md §4.9) retroyu zaten yazar. Bu skill iki iş yapar: lead'in yazdığı retroyu uygular, ya da takım çalışmıyorken retroyu kendisi yazar.

1. **Retro dosyasını bul:** `Docs/Project/retros/` (`paths.projectDocs`) altındaki en yeni `S<n>.md`. Yoksa `_TEMPLATE.md`'den oluştur ve doldur. Kaynaklar:
   - `STATUS.md`, `plan.json`, `SPRINT_PLAN.md`;
   - `AdditionalAgentInformation/agents/*/WORKLOG.md`;
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.js" list`;
   - isteğe bağlı: `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-report.js"`.

   Sayıları uydurma; bulamadığın değeri "bilinmiyor" yaz.
2. **Projeye ait dersler:** Tabloyu kullanıcıya göster ve hangilerinin uygulanacağını tek mesajda sor. Onaylananları hedef dosyaya (`rules.md`, `agents/<rol>/MEMORY.md`) kısa ve emir kipinde ekle, sonra tabloda `✅` yap. Var olan kuralla çelişen ders varsa iki metni yan yana göster ve kullanıcıya seçtir.
3. **Framework'e ait dersler:**
   - Her öneriyi gizlilik açısından denetle: proje, kişi, şirket, alan adı, yol, kod veya müşteri verisi kalmamalı. Kalmışsa genelleştir.
   - Taslağı kullanıcıya göster ve sor: (a) GitHub issue olarak gönderilsin mi, (b) dosyada kalsın mı?
   - (a) seçilirse:
     - Depo adresini `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json > repository` alanından al.
     - Kullanıcıya göndereceğin başlığı ve gövdeyi aynen göster. Açık onay gelirse `gh issue create --repo <owner/repo> --title "<başlık>" --body-file <geçici dosya>` çalıştır.
     - `gh` yoksa veya oturum açılmamışsa metni kullanıcıya ver; kendisi açar.
   - Onaysız hiçbir şey dışarı gönderilmez.
4. **Özetle:** Retro dosyasının yolunu ve ne yapıldığını yaz: uygulanan proje dersleri, gönderilen veya bekleyen framework önerileri, sonraki sprint aksiyonları. Commit'i kullanıcı atar.

Kurallar:
- Retro suçlama değil, süreç iyileştirmedir. Kişiyi veya rolü değil, olayı ve kök nedeni yaz.
- Ders, ölçülebilir bir davranış değişikliğine dönüşmelidir ("dikkat et" değil, "X'ten önce Y'yi çalıştır").
- Framework önerisi tek projede bir kez görülen bir sorunsa bunu belirt; genel olduğunu iddia etme.
