#!/bin/bash
. "$(dirname "$0")/../../lib/scaffold.sh"
# Kesintiye uğramış bir sprint: S1-01 bitti, S1-02 (web) yarım, S1-03 (tester) bekliyor, S1-04 (backend) kanıtsız kapandı.
mkdir -p Docs/Project AdditionalAgentInformation/agents/web web/src
cat > Docs/Project/SPRINT_PLAN.md <<'MD'
# Sprint S1
**Ana hedef:** Not uygulaması: backend API (ekle, listele, sil) ve web arayüzü.

| Görev | Sahip | Dalga | Bekler | Bitti kriteri |
|---|---|---|---|---|
| [BACKEND] S1-01 Not API'si (ekle, listele) | backend | W1 | — | cd backend && sh test.sh geçer |
| [WEB] S1-02 Liste ekranı | web | W2 | S1-01 | web build başarılı |
| [TEST] S1-03 E2E | tester | W3 | S1-02 | E2E geçer |
| [BACKEND] S1-04 Not silme | backend | W2 | — | cd backend && sh test.sh geçer |
MD
cat > Docs/Project/STATUS.md <<'MD'
# Proje Durumu
**Sprint:** S1 — notlar   **İlerleme:** 2/4 görev   **Aktif dalga:** W2
<!-- team-status: sprint=S1 wave=W2 done=2 total=4 blocked=0 unverified=1 -->

| Görev | Sahip | Dalga | Bekler | Durum | Not |
|---|---|---|---|---|---|
| [BACKEND] S1-01 Not API'si (ekle, listele) | backend | W1 | — | ✅ Tamamlandı | |
| [WEB] S1-02 Liste ekranı | web | W2 | S1-01 | 🟡 Devam ediyor | sayfalama yarım |
| [TEST] S1-03 E2E | tester | W3 | S1-02 | ⚪ Bekliyor | |
| [BACKEND] S1-04 Not silme | backend | W2 | — | ⚠️ Kanıtsız | kanıt atfı yoktu |

## Yeniden başlatma için (kesinti olursa: kim neredeydi, açık süreçler, sıradaki adım)
web: S1-02 liste bileşeni bitti, sayfalama yarım. Arka planda 'node web/server.js' (port 3000) çalışıyor olabilir.
MD
printf '# Worklog\n\n## 2026-11-16\n- S1-02: liste bileşeni (web/src/List.js) bitti; sayfalama yarım.\n' > AdditionalAgentInformation/agents/web/WORKLOG.md
printf 'module.exports = function List(){ return "notes"; };\n' > web/src/List.js
git add -A >/dev/null && git commit -qm "S1 başlangıç" && printf '// sayfalama: TODO\n' >> web/src/List.js
