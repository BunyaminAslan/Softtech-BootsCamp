#!/bin/sh
# session-start.sh — SessionStart hook sarmalayıcısı.
# node yoksa kullanıcıyı uyarır (guard agent çağrılarını engelleyecektir); varsa session-start.js'i çalıştırır.

if ! command -v node >/dev/null 2>&1; then
  echo '{"systemMessage":"⚠️ agent-team: node bulunamadı. Guard çalışamaz ve takım agentlarının araç çağrıları engellenir. node kurun veya PATHe ekleyin (PLUGIN.md > Gereksinimler)."}'
  exit 0
fi
here="${0%/*}"
[ "$here" = "$0" ] && here="${0%\\*}"
[ "$here" = "$0" ] && here="."
exec node "$here/session-start.js"
