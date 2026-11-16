# Retrospektif: Sprint <n>

- Tarih: <YYYY-AA-GG>
- Ana hedef: <plan.json > goal>
- Sonuç: <go / no-go; kapsam maddelerinin durumu>

## Veriler
Kaynaklar: `STATUS.md` (team-status satırı: kanıtsız/tasarım sayaçları), `plan.json`, rol worklog'ları, `node "<plugin>/scripts/ledger.js" list` (başarısız komutlar), isteğe bağlı `usage-report.js` (rol başına token).

| Ölçüt | Değer |
|---|---|
| Planlanan / tamamlanan görev | <n> / <n> |
| Tekrar açılan görev | <n> |
| `⚠️ Kanıtsız` / `⚠️ Tasarım` kapanış | <n> / <n> |
| Guard engeli (rol → yol) | <n> |
| Bloke kalma (süre, neden) | <...> |

## İyi gidenler
- <...>

## Aksayanlar (kök nedenle)
- <ne oldu> → <neden> → <ders>

## Dersler

### Projeye ait (öneri; kullanıcı onayıyla ana oturum uygular)
Lead `AdditionalAgentInformation/` altına yazamaz; her madde hedef dosyasıyla önerilir.

| Ders | Hedef | Önerilen metin | Onay |
|---|---|---|---|
| <...> | `rules.md` / `agents/<rol>/MEMORY.md` | <...> | ⬜ |

### Framework'e ait (genel; issue taslağı)
Her projede geçerli olacak dersler. **Projeye özgü bilgi yazılmaz:** proje/kişi/şirket adı, yol, alan adı, kod parçası yok. Gönderim kullanıcı onayıyla yapılır (`/agent-team:retro`).

#### Öneri 1: <kısa başlık>
- **Gözlem:** <framework'ün hangi parçası (ajan, kural, hook, şablon) nasıl davrandı>
- **Etkisi:** <zaman kaybı, hata, gereksiz token>
- **Öneri:** <somut değişiklik>
- **Bileşen:** <ör. agents/tech-lead.md §4.5, TEAM_RULES K5, hooks/task-completed.js>

## Sonraki sprint için aksiyonlar
- [ ] <...>
