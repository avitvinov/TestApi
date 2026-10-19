#!/usr/bin/env bash
# Отправляет подписанный запрос к Shop API.
# Использование: ./signed-curl.sh METHOD PATH [JSON]
#   ./signed-curl.sh GET /api/products
#   ./signed-curl.sh POST /api/products '{"name":"Тест","category_id":1,"price":100}'
# Переменные окружения: BASE_URL (по умолчанию http://localhost:3000), SIGN_SECRET.

set -euo pipefail

SECRET="${SIGN_SECRET:-junior-qa-secret-2026}"
BASE="${BASE_URL:-http://localhost:3000}"
METHOD="${1:?Укажите метод}"
URL_PATH="${2:?Укажите путь, например /api/products}"
BODY="${3:-}"

TS="$(date +%s)"
SIG="$(printf '%s\n%s\n%s' "$TS" "$METHOD" "$URL_PATH" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')"

ARGS=(-s -w '\n[HTTP %{http_code}]\n' -X "$METHOD" -H "X-Timestamp: $TS" -H "X-Signature: $SIG")
if [ -n "$BODY" ]; then
  ARGS+=(-H 'Content-Type: application/json' --data-binary "$BODY")
fi

curl "${ARGS[@]}" "$BASE$URL_PATH"
