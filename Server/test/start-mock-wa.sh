#!/usr/bin/env bash
# Starts the mock WhatsApp API on :3001 (see CLAUDE.md's 4-terminal test workflow).
#
# Reads the test server's port from test/.test-port (written by start-test-server.sh)
# and points REAL_SERVER_URL at it. Without this, mock-wa's simulate-reply forwarding
# defaults REAL_SERVER_URL to http://localhost:8080 — the real dev server's default
# port — which previously caused simulated test replies to be POSTed to the real,
# production-connected server instead of the test one.
set -e
cd "$(dirname "$0")/.."

PORT_FILE="test/.test-port"

if [ ! -f "$PORT_FILE" ]; then
  echo "No test server port recorded at $PORT_FILE — run 'npm run test:server' first." >&2
  exit 1
fi

PORT="$(cat "$PORT_FILE")"
echo "▶ Mock WhatsApp server forwarding replies to http://localhost:$PORT"

REAL_SERVER_URL="http://localhost:$PORT" \
ts-node --transpile-only --project test/tsconfig.json test/mock-whatsapp/server.ts
