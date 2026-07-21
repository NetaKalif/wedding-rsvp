#!/usr/bin/env bash
# Starts the API against the test DB for the 4-terminal test workflow (see CLAUDE.md).
#
# Picks its own port instead of defaulting to 8080: 8080 is also the default port
# for the real dev server (`npm run dev` / `npm start`), so if you ever have both
# running at once, the test server would either fail to bind or silently collide
# with a real, production-connected process. Tries 8090 first, falls back to 8081.
# The chosen port is written to test/.test-port so `npm run mock-wa` and `npm test`
# can pick it up automatically — no manual REAL_SERVER_URL needed.
set -e
cd "$(dirname "$0")/.."

PORT_FILE="test/.test-port"

pick_port() {
  for p in 8090 8081; do
    if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
  done
  echo "Both fallback ports (8090, 8081) are already in use — free one up or edit start-test-server.sh to add another." >&2
  exit 1
}

PORT="$(pick_port)"
echo "$PORT" > "$PORT_FILE"
echo "▶ Test server starting on port $PORT (recorded in $PORT_FILE)"

# EMAIL_USER/EMAIL_APP_PASSWORD are explicitly blanked (not just omitted): omitting
# them lets dotenv fill them in from .server.env with real Gmail credentials, which
# has previously caused test runs to send real emails to fake @test.com addresses.
NODE_ENV=test \
DATABASE_URL=postgres://postgres:test@localhost:5433/wedding_test \
WHATSAPP_API_BASE_URL=http://localhost:3001 \
WHATSAPP_ACCESS_TOKEN=mock-access-token \
JWT_SECRET=test-jwt-secret-do-not-use-in-prod \
JWT_EXPIRES_IN=24h \
MEDIA_TOKEN_SECRET=test-media-token-secret-do-not-use-in-prod \
CLIENT_URL=http://localhost:3000 \
EMAIL_USER= \
EMAIL_APP_PASSWORD= \
PORT="$PORT" \
ts-node-dev --respawn --transpile-only --project tsconfig.server-test.json ./src/app.ts
