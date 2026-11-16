---
name: team
description: Ana oturumun (Claude) agent team'i kurma ve yönetme prosedürü. Kullanıcı "takım", "lead", "projeyi yap", "/agent-team:team" dediğinde veya yönlendirme kuralına göre iş tech-lead'e paslanacaksa kullan. Ön kontrolü çalıştırır, lead'i başlatır, [SPAWN-REQUEST]'leri değiştirmeden uygular, [QUESTION]/[PLAN-APPROVAL]/[STATUS]/[BLOCKED]/[DONE] mesajlarını kullanıcıya aynen aktarır. Takım üyeleri (teammate'ler) bu skill'i kullanmaz.
argument-hint: "[kullanıcının isteği]"
---

# /agent-team:team — agent team prosedürü (yalnızca ana oturum)

Takımı yalnızca ana oturum başlatır; teammate'ler başka teammate başlatamaz (Claude Code kısıtı).

## 0. Ön koşullar

1. Ön kontrolü çalıştır:
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/team-preflight.js"
   ```
   - `FAIL` → takımı başlatma. Çıktıyı kullanıcıya göster ve düzeltmeyi öner. En sık nedenler: proje katmanı yok (`/agent-team:setup-project`), agent teams kapalı (kullanıcı ayarı), `team.json` bozuk, node yok. Guard'ı aşacak geçici bir çözüm uygulama.
   - `WARN` → kullanıcıya tek satırla bildir, devam et.
2. Settings dosyalarına `"agent"` anahtarı **ekleme**; hiçbir agent varsayılan ana agent yapılmaz.
3. Kullanıcının isteğini, bu konuşmada alınmış kararları ve bilinen kısıtları topla.

Kesintiye uğramış bir takım işi varsa (limit doldu, oturum kapandı) bu skill yerine `/agent-team:resume` kullanılır; lead'i devam modunda başlatır.

## 1. lead'i başlat

`agent-team:tech-lead` agent tipinde, adı tam olarak **`lead`** olan teammate'i başlat. Spawn prompt'u şu şablonla yazılır; kullanıcının isteği **kısaltılmadan** girer:

```
Takım modundasın; adın `lead`, takım lideri sensin. Ana oturum (Claude) ile SendMessage üzerinden konuşursun.
Oturum başlangıç protokolünü (tech-lead.md Bölüm 3) uygula: TEAM_RULES, proje katmanı (AdditionalAgentInformation/), hafızan ve worklog'un.

## Kullanıcının isteği (aynen)
<kullanıcının mesajı, kelimesi kelimesine>

## Bu konuşmada alınmış kararlar ve kısıtlar
- <karar 1>
- <kısıt 1>

## Ortam
- Proje kökü: <pwd>
- Preflight: <PASS/WARN + WARN satırları>
- Etkin roller (team.json): <roller ve profiller>

Netleştirme sorularını [QUESTION], plan onayını [PLAN-APPROVAL], üye isteklerini [SPAWN-REQUEST] ile bana gönder.
```

## 2. Mesaj yönlendirme

| lead'den gelen | Senin yapacağın |
|---|---|
| `[QUESTION]` | Soruları **olduğu gibi** (numaraları, önerileri ve varsayılanlarıyla) kullanıcıya ilet. Cevabı aynen `lead`'e gönder. Kendi cevabını uydurma. |
| `[PLAN-APPROVAL]` | Plan özetini ve plan dosyasının yolunu kullanıcıya ilet; "onaylıyor musunuz?" diye sor. Onay/ret/değişikliği aynen `lead`'e gönder. |
| `[SPAWN-REQUEST]` | Her üyeyi **lead'in verdiği ad ve prompt'la, metni değiştirmeden** başlat (eşleme aşağıda). Sonra `lead`'e "başlatıldı: <adlar>" yaz. |
| `[STATUS]` | Kullanıcıya kısa özet. Commit noktası önerisiyse dosya listesini ve önerilen mesajı göster; commit kararını kullanıcıya bırak. |
| `[BLOCKED]` | Engeli kullanıcıya bildir. Guard engeli ise agent'ın yerine işlemi **kendin yapma**. |
| `[DONE]` | Kapanış özetini kullanıcıya ilet; commit'in kullanıcıya ait olduğunu ve (kuruluysa) pre-commit kontrolünün otomatik çalışacağını hatırlat. |

**Spawn eşlemesi** (teammate adı → agent tipi):

| Ad | Agent tipi |
|---|---|
| `backend` | `agent-team:senior-backend-developer` |
| `mobile` | `agent-team:senior-mobile-developer` |
| `web` | `agent-team:senior-web-developer` |
| `tester` | `agent-team:senior-tester` |

**Model:** `[SPAWN-REQUEST]`'te bir üye için `model:` satırı varsa (`opus`, `sonnet`, `haiku` …) üyeyi o modelle başlat (Agent aracının `model` parametresi). Satır yoksa model verme; ajan dosyasındaki model geçerlidir. Ad bir rolün türevi olabilir (ör. `tester-test`: aynı agent tipiyle, farklı modelle açılan ikinci tester); agent tipi eşlemedeki gibidir.

**Özerklik (`team.json > autonomy`):** `autonomous` ve `checkpoint` düzeylerinde lead'in `[STATUS]` mesajları bilgilendirmedir; kullanıcıya ilet ama cevap bekleme. `supervised`'da lead dalga sonlarında da `[QUESTION]` ile onay ister. Commit, push ve deploy her düzeyde kullanıcınındır.

**Özel roller:** `team.json > roles` içinde tanımlı özel roller (ör. `devops`) için agent tipi `team.json > roles.<rol>.agent` değeridir; SessionStart bağlamındaki eşleme bunları da listeler. Özel rolü de lead'in verdiği adla, prompt'u değiştirmeden başlat.

Projede `.claude/agents/` altında aynı adla bir override varsa (preflight WARN verir) Claude Code onu kullanır; eşlemeyi değiştirme. `team.json`'da kapalı (`enabled: false`) bir rol veya eşlemede olmayan bir ad/tip istenirse başlatma; `lead`'e sor.

## 3. Kurallar

- Takım çalışırken işi kendin yapma ve üyeler arasında mesaj taşıma; üyeler birbirine doğrudan yazar.
- Kullanıcı "durum ne?" derse `lead`'e sor veya plan dokümanlarındaki `STATUS.md`'yi (team.json > paths.projectDocs) okuyup özetle.
- Kullanıcı takımı durdurmak isterse `lead`'e kapanış isteği gönder; o üyeleri kapatır.
- Commit, push, branch açma yalnızca kullanıcı açıkça isterse yapılır.
