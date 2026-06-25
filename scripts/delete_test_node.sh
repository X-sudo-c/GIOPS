#!/usr/bin/env bash
# Delete a test connectivity node (fires webhooks + live dashboard update).
#
# Usage:
#   ./scripts/delete_test_node.sh <mrid>
#   ./scripts/delete_test_node.sh              # deletes last node from add_test_node.sh
#
# Safety: only deletes nodes with MRID prefix b0000000- (test nodes).
#         Use FORCE=1 to delete any node.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${SCRIPT_DIR}/.last_test_node"
DB_URI="${SUPABASE_DB_URI:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

MRID="${1:-}"

if [[ -z "${MRID}" ]]; then
  if [[ ! -f "${STATE_FILE}" ]]; then
    echo "Error: no MRID given and ${STATE_FILE} not found." >&2
    echo "Usage: $0 <mrid>" >&2
    exit 1
  fi
  MRID=$(cat "${STATE_FILE}")
  echo "Using last test node MRID: ${MRID}"
fi

if [[ ! "${MRID}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Error: invalid UUID: ${MRID}" >&2
  exit 1
fi

if [[ "${MRID}" != b0000000-* ]] && [[ "${FORCE:-}" != "1" ]]; then
  echo "Error: only test nodes (b0000000-...) can be deleted without FORCE=1." >&2
  echo "  FORCE=1 $0 ${MRID}" >&2
  exit 1
fi

echo "Deleting node ${MRID} and any connected line segments..."

psql "${DB_URI}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

CREATE TEMP TABLE _giop_segs ON COMMIT DROP AS
SELECT mrid FROM ac_line_segments
WHERE source_node_id = '${MRID}'::uuid
   OR target_node_id = '${MRID}'::uuid;

DELETE FROM ac_line_segments WHERE mrid IN (SELECT mrid FROM _giop_segs);
DELETE FROM conducting_equipment WHERE mrid IN (SELECT mrid FROM _giop_segs);
DELETE FROM identified_objects WHERE mrid IN (SELECT mrid FROM _giop_segs);

DELETE FROM identified_objects WHERE mrid = '${MRID}'::uuid;

COMMIT;
SQL

if [[ -f "${STATE_FILE}" ]] && [[ "$(cat "${STATE_FILE}")" == "${MRID}" ]]; then
  rm -f "${STATE_FILE}"
fi

echo ""
echo "Done. Node ${MRID} removed."
