#!/bin/bash
# agent-team davranış testleri (claude plugin eval). Repo kökünden, WSL2 / Linux / macOS'ta çalıştırın:
#   evals/run.sh smoke            # L1: deterministik grader'lar, vaka başına 1 koşu, eşik 1.0, tavan $5
#   evals/run.sh full             # L2: yargı gerektiren davranışlar (llm), vaka başına 3 koşu, eşik 0.8, tavan $25
#   evals/run.sh smoke --case guard-*        # ek argümanlar claude plugin eval'e geçer
# Bütçe ve koşu sayısı ortam değişkeniyle değişir: EVAL_MAX_COST_USD, EVAL_RUNS, EVAL_THRESHOLD.
# Çıkış kodu claude plugin eval'inkidir: 0 geçti · 1 eşik altı/hata · 2 bütçe tavanı (kısmi).
set -euo pipefail

suite="${1:-}"
shift || true
case "$suite" in
  smoke) runs="${EVAL_RUNS:-1}"; threshold="${EVAL_THRESHOLD:-1.0}"; cost="${EVAL_MAX_COST_USD:-5}" ;;
  full)  runs="${EVAL_RUNS:-3}"; threshold="${EVAL_THRESHOLD:-0.8}"; cost="${EVAL_MAX_COST_USD:-25}" ;;
  *) echo "Kullanım: evals/run.sh smoke|full [claude plugin eval argümanları]" >&2; exit 64 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[ "$(uname -s)" = "Linux" ] || [ "$(uname -s)" = "Darwin" ] || { echo "Bash izni olan vakalar OS sandbox'ı ister: WSL2, Linux veya macOS'ta çalıştırın." >&2; exit 64; }
if [ "$(uname -s)" = "Linux" ]; then
  for c in bwrap socat; do command -v "$c" >/dev/null || { echo "$c yok: sudo apt install -y bubblewrap socat (PLUGIN.md > 1.1)" >&2; exit 64; }; done
fi

# Hedef repo kökü: her vaka plugin'i case.yaml > plugins ile (../../../plugin) verir.
# --ablation none: plugin'siz kolda ajanlarımız yoktur, karşılaştırma anlamsızdır.
exec claude plugin eval . \
  --eval-dir "evals/$suite" \
  --scaffold --trust-plugin --ablation none --no-publish \
  --runs "$runs" --threshold "$threshold" --max-cost-usd "$cost" \
  "$@" \
  --allow-tools Write Edit Bash
