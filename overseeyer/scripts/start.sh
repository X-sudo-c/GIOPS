#!/usr/bin/env bash
# Start OVERSEEYER API (:5190) and web UI (:5191).
#
# Usage:
#   ./overseeyer/scripts/start.sh
#   ./overseeyer/scripts/start.sh --api-only
#   ./overseeyer/scripts/start.sh --web-only

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_DIR="${GIOP_RUN_DIR:-$ROOT/.giop}"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
API_PORT="${OVERSEYER_API_PORT:-5190}"
WEB_PORT="${OVERSEYER_WEB_PORT:-5191}"

API_ONLY=0
WEB_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-only) API_ONLY=1 ;;
    --web-only) WEB_ONLY=1 ;;
    -h|--help)
      sed -n '2,7p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="${GIOP_PYTHON:-$ROOT/.venv/bin/python}"
else
  PYTHON="${GIOP_PYTHON:-python3}"
fi

port_open() {
  (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}

api_ready() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${API_PORT}/api/observability" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]]
}

stop_api() {
  local pidfile="$PID_DIR/overseeyer-api.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
  if port_open "$API_PORT"; then
    local port_pid
    port_pid="$(ss -ltnp 2>/dev/null | awk -v p=":${API_PORT}" '$4 ~ p { gsub(/.*pid=/, "", $6); gsub(/,.*/, "", $6); print $6; exit }' || true)"
    if [[ -n "$port_pid" ]]; then
      kill "$port_pid" 2>/dev/null || true
      sleep 1
    fi
  fi
}

start_api() {
  if port_open "$API_PORT" && api_ready; then
    echo "OVERSEEYER API already on :$API_PORT"
    return 0
  fi

  if port_open "$API_PORT"; then
    echo "Restarting stale OVERSEEYER API on :$API_PORT (missing /api/observability)"
    stop_api
  fi

  echo "Starting OVERSEEYER API on :$API_PORT"
  (
    cd "$ROOT/overseeyer/server"
    nohup "$PYTHON" -m uvicorn main:app --host 0.0.0.0 --port "$API_PORT" \
      >>"$LOG_DIR/overseeyer-api.log" 2>&1 &
    echo $! >"$PID_DIR/overseeyer-api.pid"
  )
  sleep 2

  local i
  for i in 1 2 3 4 5; do
    if api_ready; then
      ok "OVERSEEYER API ready"
      return 0
    fi
    sleep 1
  done
  echo "WARN: API started but /api/observability not ready (see $LOG_DIR/overseeyer-api.log)" >&2
}

ok() { printf '  OK   %s\n' "$*"; }

start_web() {
  if port_open "$WEB_PORT"; then
    echo "OVERSEEYER UI already on :$WEB_PORT"
    return 0
  fi
  WEB_DIR="$ROOT/overseeyer/web"
  if [[ ! -d "$WEB_DIR/node_modules" ]]; then
    echo "Running npm install in overseeyer/web"
    (cd "$WEB_DIR" && npm install) >>"$LOG_DIR/overseeyer-web-install.log" 2>&1
  fi
  echo "Starting OVERSEEYER UI on :$WEB_PORT"
  (
    cd "$WEB_DIR"
    setsid ./node_modules/.bin/vite --host 127.0.0.1 --port "$WEB_PORT" \
      >>"$LOG_DIR/overseeyer-web.log" 2>&1 </dev/null &
  )
  sleep 2
  local vite_pid
  vite_pid="$(pgrep -f "node.*vite.*--port ${WEB_PORT}" 2>/dev/null | head -1 || true)"
  if [[ -n "$vite_pid" ]]; then
    echo "$vite_pid" >"$PID_DIR/overseeyer-web.pid"
  fi
}

if [[ "$WEB_ONLY" != "1" ]]; then
  start_api
fi

if [[ "$API_ONLY" != "1" ]]; then
  start_web
fi

echo ""
echo "OVERSEEYER"
echo "  API: http://127.0.0.1:${API_PORT}/api/observability"
echo "  UI:  http://127.0.0.1:${WEB_PORT}"
echo "  Logs: $LOG_DIR/overseeyer-*.log"
