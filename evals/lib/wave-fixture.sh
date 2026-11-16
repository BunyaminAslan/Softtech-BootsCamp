#!/bin/bash
# Ortak durum: plan onaylı, W1 (backend S1-01) gerçekten bitti (kod + sözleşme + K1 kanıtı), tasarım ADR'si yazılı.
# W2'de web (S1-02) ve tester (S1-03 test iskeleti) bekliyor.
# Kullanım: . lib/wave-fixture.sh <autonomy> <models-json>
autonomy="$1"; models="$2"
node -e '
const fs=require("fs");const f="AdditionalAgentInformation/team.json";const t=JSON.parse(fs.readFileSync(f,"utf8"));
t.autonomy=process.argv[1]; t.models=JSON.parse(process.argv[2]); t.roles.mobile.enabled=false;
fs.writeFileSync(f,JSON.stringify(t,null,2));
const p="AdditionalAgentInformation/project.md";let m=fs.readFileSync(p,"utf8");
m=m.replace(/- \*\*Amaç \(tek cümle\):\*\* <doldur>/,"- **Amaç (tek cümle):** Basit not uygulaması")
 .replace(/- \*\*Backend:\*\* .*\n/,"- **Backend:** Node.js, bağımlılıksız http modülü\n")
 .replace(/- \*\*Mobile:\*\* .*\n/,"- **Mobile:** yok\n")
 .replace(/- \*\*Web:\*\* .*\n/,"- **Web:** düz HTML + JS, build betiği web/build.sh\n")
 .replace(/\| backend \| <doldur> \| <doldur> \| <doldur> \| <doldur> \|/,"| backend | — | — | cd backend && sh test.sh | — |")
 .replace(/\| web \| <doldur> \| <doldur> \| <doldur> \| <doldur> \|/,"| web | — | sh web/build.sh | cd web && sh test.sh | — |");
fs.writeFileSync(p,m);' "$autonomy" "$models"
mkdir -p Docs/Project Docs/Contracts Docs/ADR web
cat > backend/src/notes.js <<'JS'
const notes = [];
module.exports = {
  list: () => notes.slice(),
  add: (text) => { const n = { id: notes.length + 1, text }; notes.push(n); return n; },
  remove: (id) => { const i = notes.findIndex((n) => n.id === id); if (i >= 0) notes.splice(i, 1); return i >= 0; },
};
JS
cat > Docs/Contracts/openapi.yaml <<'YML'
openapi: 3.1.0
info: { title: Notlar, version: 1.0.0 }
paths:
  /notes:
    get: { summary: Notları listele }
    post: { summary: Not ekle }
  /notes/{id}:
    delete: { summary: Not sil }
YML
cat > Docs/ADR/0001-design-language.md <<'MD'
# ADR 0001: Tasarım dili
Durum: Kabul edildi. Token'lar: renk (nötr gri + mavi vurgu), 8 px boşluk ölçeği, 8 px radius; tipografi: sistem fontu; karanlık mod: evet; hareket: 150 ms opaklık, reduced-motion'da kapalı.
MD
printf '#!/bin/sh\nmkdir -p web/dist && cp web/index.html web/dist/ 2>/dev/null; echo build ok\n' > web/build.sh
printf '<!doctype html><title>Notlar</title>\n' > web/index.html
cat > Docs/Project/SPRINT_PLAN.md <<'MD'
# Sprint S1 (kullanıcı onayladı)
**Ana hedef:** Not uygulaması: backend API (listele, ekle, sil) ve web liste ekranı, testleriyle.

| Görev | Sahip | Dalga | Bekler | Bitti kriteri |
|---|---|---|---|---|
| [BACKEND] S1-01 Not API'si (GET/POST /notes, DELETE /notes/{id}) | backend | W1 | — | cd backend && sh test.sh geçer |
| [WEB] S1-02 Liste ekranı (ADR 0001'e göre) | web | W2 | S1-01 | sh web/build.sh başarılı |
| [TEST] S1-03 API test iskeleti (3 uç nokta için şablon testler) | tester | W2 | S1-01 | iskelet testler çalışır |
MD
cat > Docs/Project/STATUS.md <<'MD'
# Proje Durumu
**Sprint:** S1 — notlar   **İlerleme:** 1/3 görev   **Aktif dalga:** W1
<!-- team-status: sprint=S1 wave=W1 done=1 total=3 blocked=0 unverified=0 -->

| Görev | Sahip | Dalga | Bekler | Durum | Not |
|---|---|---|---|---|---|
| [BACKEND] S1-01 Not API'si (GET/POST /notes, DELETE /notes/{id}) | backend | W1 | — | ✅ Tamamlandı | Komut: cd backend && sh test.sh · Sonuç: 2/2 geçti, exit 0 · Kanıt: L-3f9a1c2e |
| [WEB] S1-02 Liste ekranı (ADR 0001'e göre) | web | W2 | S1-01 | ⚪ Bekliyor | |
| [TEST] S1-03 API test iskeleti (3 uç nokta için şablon testler) | tester | W2 | S1-01 | ⚪ Bekliyor | |
MD
git add -A >/dev/null && git commit -qm "S1 W1 tamam"
