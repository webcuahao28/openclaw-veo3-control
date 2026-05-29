#!/usr/bin/env bash
# Wrapper that launches Chrome (from the SHELL, not from Node — this sandbox
# kills Node processes that spawn a browser), runs the Node test harness which
# only CONNECTS to Chrome over CDP, then tears Chrome down. Everything lives in
# one process so nothing lingers in the background.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CDP_PORT="${CDP_PORT:-9222}"
PROFILE="$(mktemp -d)"

# locate a chrome binary
CHROME="${CHROME_PATH:-}"
if [ -z "$CHROME" ]; then
  CHROME="$(find "$ROOT/.local-chrome" -name chrome-headless-shell -type f 2>/dev/null | head -1)"
fi
if [ -z "$CHROME" ]; then
  for b in google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$b" >/dev/null 2>&1 && CHROME="$b" && break
  done
fi
if [ -z "$CHROME" ]; then echo "❌ No Chrome binary found (set CHROME_PATH)"; exit 2; fi
echo "• Chrome binary : $CHROME"

# kill any stale chrome on this port
pkill -f "remote-debugging-port=$CDP_PORT" 2>/dev/null
sleep 1

# launch chrome in the background (direct child of this shell)
"$CHROME" --headless --no-sandbox --disable-gpu \
  --remote-debugging-port="$CDP_PORT" --remote-debugging-address=127.0.0.1 \
  --window-size=1280,900 --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" about:blank >/tmp/glb-chrome.log 2>&1 &
CHROME_PID=$!

cleanup() {
  kill "$CHROME_PID" 2>/dev/null
  pkill -f "remote-debugging-port=$CDP_PORT" 2>/dev/null
  rm -rf "$PROFILE"
}
trap cleanup EXIT

# wait for CDP to come up
for i in $(seq 1 40); do
  if curl -s "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

# run the harness (connects only — never spawns chrome)
CDP_PORT="$CDP_PORT" node "$ROOT/test/run-local-test.js"
RC=$?
exit $RC
