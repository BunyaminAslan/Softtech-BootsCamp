#!/bin/sh
# guard.sh — agent-guard.js için fail-closed sarmalayıcı.
# Plugin hooks.json: sh "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh"
#
# node yoksa veya guard beklenmeyen bir kodla çıkarsa:
#   - çağrı bir agent'tan geliyorsa (girdide agent_id / agent_type var) → ENGELLE (exit 2)
#   - ana oturumdan geliyorsa → geçir (kullanıcının kendi oturumunu kilitlememek için)
# Yalnızca kabuk yerleşikleri kullanılır (cat/grep/dirname gerekmez), böylece PATH bozuk
# olsa bile karar verilebilir.

input=""
while IFS= read -r line || [ -n "$line" ]; do
  input="$input$line
"
done

is_agent_call() {
  case "$input" in
    *'"agent_id"'*|*'"agent_type"'*) return 0 ;;
  esac
  return 1
}

# Betiğin klasörü: hem / hem \ ayırıcısını destekle (Windows yolları)
here="${0%/*}"
[ "$here" = "$0" ] && here="${0%\\*}"
[ "$here" = "$0" ] && here="."

if ! command -v node >/dev/null 2>&1; then
  if is_agent_call; then
    echo "⛔ agent-guard: node bulunamadı, yetki kontrolü yapılamıyor; agent çağrısı engellendi. 'which node' ile kontrol edin (PLUGIN.md > Gereksinimler)." >&2
    exit 2
  fi
  exit 0
fi

printf '%s' "$input" | node "$here/agent-guard.js"
rc=$?
[ "$rc" -eq 0 ] && exit 0
[ "$rc" -eq 2 ] && exit 2
if is_agent_call; then
  echo "⛔ agent-guard: guard beklenmeyen bir kodla çıktı (exit $rc); agent çağrısı engellendi." >&2
  exit 2
fi
exit 0
