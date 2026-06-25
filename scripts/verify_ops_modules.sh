#!/usr/bin/env bash
# Smoke test for Phase 2 operational modules (cases, tickets, work orders, outages, regulatory).
set -euo pipefail

BASE="${SYNC_BASE_URL:-http://127.0.0.1:5000}"
API="${BASE}/api/v1"

echo "== GIOP ops modules smoke test =="
echo "API: $API"

_cases_probe() {
  curl -sS -w "\n%{http_code}" --max-time 5 "${API}/cases" 2>/dev/null || echo -e "\n000"
}

CASES_BODY="$(_cases_probe)"
CASES_HTTP="${CASES_BODY##*$'\n'}"
CASES_JSON="${CASES_BODY%$'\n'*}"

if [[ "$CASES_HTTP" != "200" ]]; then
  echo "FAIL: GET /cases (HTTP $CASES_HTTP)"
  if [[ -n "$CASES_JSON" && "$CASES_JSON" != "000" ]]; then
    echo "Response: $CASES_JSON"
  fi
  if [[ "$CASES_HTTP" == "404" ]]; then
    echo ""
    echo "sync-service is running old code without Phase 2 routes."
    echo "Fix: ./scripts/start_giop_stack.sh   (auto-restarts stale sync-service)"
    echo "  or: cd sync-service && uvicorn main:app --host 0.0.0.0 --port 5000 --reload"
  elif [[ "$CASES_HTTP" == "500" ]]; then
    echo ""
    echo "Database may be missing migration 00016 (contact_cases table)."
    echo "Fix: npx supabase db reset   # applies migrations 00001–00016"
  elif [[ "$CASES_HTTP" == "000" ]]; then
    echo ""
    echo "sync-service is not reachable on ${BASE}"
    echo "Fix: ./scripts/start_giop_stack.sh"
  fi
  exit 1
fi

echo "$CASES_JSON" | grep -q '"cases"' || { echo "FAIL: GET /cases (unexpected body)"; exit 1; }
echo "OK  GET /cases"

CASE_JSON=$(curl -sf -X POST "${API}/cases" \
  -H "Content-Type: application/json" \
  -d '{"channel":"WEB","summary":"Smoke test case","classification":"GENERAL"}')
CASE_ID=$(echo "$CASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "OK  POST /cases -> $CASE_ID"

TICKET_JSON=$(curl -sf -X POST "${API}/cases/${CASE_ID}/convert-ticket" \
  -H "Content-Type: application/json" \
  -d '{}')
TICKET_ID=$(echo "$TICKET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "OK  POST /cases/.../convert-ticket -> $TICKET_ID"

WO_JSON=$(curl -sf -X POST "${API}/cases/${CASE_ID}/convert-work-order" \
  -H "Content-Type: application/json" \
  -d '{"assigned_user":"tech.demo","assigned_crew":"CREW-SMOKE"}')
WO_ID=$(echo "$WO_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "OK  POST /cases/.../convert-work-order -> $WO_ID"

ASSIGNED=$(curl -sf "${API}/work-orders/assigned?user=tech.demo")
echo "$ASSIGNED" | grep -q "$WO_ID" || echo "WARN: assigned WO not in list (may be filtered by status)"

curl -sf -X PATCH "${API}/work-orders/${WO_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACCEPTED"}' > /dev/null
echo "OK  PATCH /work-orders/..."

OUTAGE_JSON=$(curl -sf -X POST "${API}/outages" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Smoke test outage","customers_affected":10,"is_published":true}')
OUTAGE_ID=$(echo "$OUTAGE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "OK  POST /outages -> $OUTAGE_ID"

curl -sf -X POST "${API}/outages/${OUTAGE_ID}/restore" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null
echo "OK  POST /outages/.../restore"

FROM=$(date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -v-30d +%Y-%m-%dT00:00:00Z)
TO=$(date -u +%Y-%m-%dT23:59:59Z)
curl -sf "${API}/regulatory/metrics?period_start=${FROM}&period_end=${TO}" | grep -q saidi_minutes
echo "OK  GET /regulatory/metrics"

REPORT=$(curl -sf -X POST "${API}/regulatory/reports/generate" \
  -H "Content-Type: application/json" \
  -d "{\"period_start\":\"${FROM}\",\"period_end\":\"${TO}\"}")
echo "$REPORT" | grep -q '"metrics"'
echo "OK  POST /regulatory/reports/generate"

echo ""
echo "All ops module checks passed."
