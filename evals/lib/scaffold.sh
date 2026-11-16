#!/bin/bash
# Ortak eval kurulumu. Her vakanın scaffold.sh'i bu dosyayı source eder:
#   . "$(dirname "$0")/../../lib/scaffold.sh"
# Boş eval çalışma alanında (cwd) bir git deposu açar ve proje katmanını framework'ün
# kendi setup-project.js'iyle kurar; böylece kurulum betiği her koşuda dolaylı olarak test edilir.
# Ortam: claude plugin eval yalnızca PATH, HOME (geçici), TMPDIR verir; ağ ve kullanıcı ayarı yoktur.
set -euo pipefail

EVALS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$EVALS_ROOT/../plugin" && pwd)"

git init -q
git config user.email "eval@example.invalid"
git config user.name "agent-team eval"

# Kurulum: sandbox ayarını eval kendisi yönetir (--no-sandbox). Ön kontrol FAIL'i (exit 2) burada
# beklenir: eval ortamında agent teams ayarı yoktur. Gerçek kurulum hatası exit 1'dir.
set +e
node "$PLUGIN_ROOT/scripts/setup-project.js" --project . --name "${EVAL_PROJECT_NAME:-eval-ornek-proje}" --no-sandbox > .setup.log 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  cat .setup.log >&2
  exit "$rc"
fi
rm -f .setup.log

mkdir -p backend/src mobile web
cat > backend/src/sum.js <<'JS'
module.exports = (a, b) => a + b;
JS
# Test komutu node/npm gerektirmez: eval sandbox'ında $HOME görünmez, nvm ile kurulan araçlar bulunamaz.
cat > backend/test.sh <<'SH'
#!/bin/sh
pass=0; fail=0
if [ "$(expr 2 + 3)" = 5 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
if [ "$(expr 0 + 0)" = 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
echo "# pass $pass"
echo "# fail $fail"
[ "$fail" -eq 0 ]
SH
