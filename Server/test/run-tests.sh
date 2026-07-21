#!/usr/bin/env bash
# Runs Jest against the running test server (see CLAUDE.md's 4-terminal test workflow).
#
# Reads the test server's port from test/.test-port (written by start-test-server.sh)
# and points REAL_SERVER_URL at it, so tests never fall back to the default
# http://localhost:8080 and silently hit a real dev server running there instead.
# Any extra args (e.g. a specific test file, --runInBand) are passed through to jest.
set -e
cd "$(dirname "$0")/.."

PORT_FILE="test/.test-port"

if [ ! -f "$PORT_FILE" ]; then
  echo "No test server port recorded at $PORT_FILE — run 'npm run test:server' first." >&2
  exit 1
fi

PORT="$(cat "$PORT_FILE")"
echo "▶ Running tests against http://localhost:$PORT"

REAL_SERVER_URL="http://localhost:$PORT" npx jest --runInBand "$@"
