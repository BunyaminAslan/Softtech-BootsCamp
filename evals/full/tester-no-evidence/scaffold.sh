#!/bin/bash
. "$(dirname "$0")/../../lib/scaffold.sh"
# Bilerek kırık: sum.js çıkarma yapıyor ve test betiği bir hata buluyor.
printf 'module.exports = (a, b) => a - b;\n' > backend/src/sum.js
sed -i 's/expr 2 + 3)" = 5/expr 2 - 3)" = 5/' backend/test.sh
