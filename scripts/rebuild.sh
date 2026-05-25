#!/usr/bin/env bash
# Chizzle Wealth Engine — one-shot rebuild + deploy.
# Honors Low-Credit Mode: no schedulers, no polling, no auto-classification.
set -euo pipefail

# Resolve project root regardless of where this script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

PORT="${PORT:-5000}"
DIST_ENTRY="dist/index.cjs"
PID_FILE="$APP_DIR/.server.pid"
LOG_FILE="$APP_DIR/server.log"

echo "==> CHIZZLE WEALTH ENGINE — REBUILD + DEPLOY"
echo "    Project: $APP_DIR"
echo "    Port:    $PORT"
echo "----------------------------------------------"

echo "==> Step 1/6: Install dependencies"
npm install --silent

echo "==> Step 2/6: Smoke tests (tsc + discipline helper)"
if ! npm test --silent; then
  echo "✗ Smoke tests failed — aborting deploy."
  exit 1
fi

echo "==> Step 3/6: Build production bundle"
npm run build --silent
if [ ! -f "$DIST_ENTRY" ]; then
  echo "✗ Build did not produce $DIST_ENTRY — aborting."
  exit 1
fi

echo "==> Step 4/6: Stop existing server (if running)"
STOPPED=0
# Prefer pid file
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [ -n "$OLD_PID" ] && ps -p "$OLD_PID" > /dev/null 2>&1; then
    kill "$OLD_PID" || true
    echo "    Stopped server PID $OLD_PID (from pid file)"
    STOPPED=1
  fi
  rm -f "$PID_FILE"
fi
# Fallback: pgrep on the dist entry — catches manually-started servers.
PIDS_BY_NAME="$(pgrep -f "$DIST_ENTRY" || true)"
if [ -n "$PIDS_BY_NAME" ]; then
  echo "$PIDS_BY_NAME" | xargs -r kill || true
  echo "    Stopped server PID(s) $PIDS_BY_NAME (by name)"
  STOPPED=1
fi
sleep 1
if [ "$STOPPED" -eq 0 ]; then
  echo "    No running server found"
fi

echo "==> Step 5/6: Start server (scheduler-free)"
# Use nohup + setsid so the server outlives this shell.
nohup env PORT="$PORT" NODE_ENV=production node "$DIST_ENTRY" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
echo "    Started server PID $NEW_PID on port $PORT"
echo "    Log: $LOG_FILE"

echo "==> Step 6/6: Health check + scheduler verification"
# Poll /health up to 10s.
HEALTH_OK=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fs "http://localhost:$PORT/health" > /dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
done
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "✗ Health check failed after 10s. Last log lines:"
  tail -n 30 "$LOG_FILE" || true
  exit 1
fi
HEALTH_JSON="$(curl -fs "http://localhost:$PORT/health")"
echo "    /health → $HEALTH_JSON"

# Scheduler scan: log must NOT contain known scheduler/poller markers.
SCHEDULER_HITS="$(grep -E -i "scheduler started|setup detector|regime classifier auto|polling every|cron tick" "$LOG_FILE" || true)"
if [ -n "$SCHEDULER_HITS" ]; then
  echo "✗ Scheduler markers found in log — Low-Credit Mode violated:"
  echo "$SCHEDULER_HITS"
  exit 1
fi
echo "    No scheduler markers in log — Low-Credit Mode honored"

echo "----------------------------------------------"
echo "✓ DEPLOY COMPLETE"
echo "    Server PID: $NEW_PID"
echo "    URL:        http://localhost:$PORT"
echo "    Health:     http://localhost:$PORT/health"
echo "    Logs:       tail -f $LOG_FILE"
