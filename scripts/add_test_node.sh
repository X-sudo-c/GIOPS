#!/usr/bin/env bash
# Add a test connectivity node (fires webhooks + live dashboard update).
#
# Usage:
#   ./scripts/add_test_node.sh "My Test Node"
#   ./scripts/add_test_node.sh "My Test Node" -0.285 5.640
#   ./scripts/add_test_node.sh "My Test Node" -0.285 5.640 a0000000-0000-0000-0000-000000000002
#
# Args:
#   1 - Node name (required)
#   2 - Longitude (default: -0.2850)
#   3 - Latitude  (default: 5.6400)
#   4 - Optional: connect FROM this existing node MRID (adds 11kV line segment)

set -euo pipefail

NAME="${1:?Usage: $0 \"Node Name\" [lon] [lat] [connect_from_mrid]}"
LON="${2:--0.2850}"
LAT="${3:-5.6400}"
CONNECT_FROM="${4:-}"

DB_URI="${SUPABASE_DB_URI:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${SCRIPT_DIR}/.last_test_node"

SUFFIX=$(printf '%012x' $((RANDOM * 65536 + RANDOM)))
MRID="b0000000-0000-0000-0000-${SUFFIX}"
FEEDER_ID="FEEDER-TEST-${SUFFIX:0:8}"
SEG_MRID="e0000000-0000-0000-0000-${SUFFIX}"

echo "Adding test node..."
echo "  MRID:  ${MRID}"
echo "  Name:  ${NAME}"
echo "  GPS:   (${LON}, ${LAT})"

export PGPASSWORD="${PGPASSWORD:-postgres}"

psql "${DB_URI}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

INSERT INTO identified_objects (mrid, name, lifecycle_state, validation)
VALUES ('${MRID}', '${NAME//\'/\'\'}', 'IN_SERVICE', 'APPROVED');

INSERT INTO connectivity_nodes (mrid, boundary_feeder_id, geom)
VALUES (
  '${MRID}',
  '${FEEDER_ID}',
  ST_SetSRID(ST_MakePoint(${LON}, ${LAT}), 4326)
);

INSERT INTO ghana_grid_assets (mrid, operating_utility, substation_name)
VALUES ('${MRID}', 'ECG_SOUTHERN', '${NAME//\'/\'\'}');

COMMIT;
SQL

if [[ -n "${CONNECT_FROM}" ]]; then
  echo "  Line:  ${CONNECT_FROM} -> ${MRID} (11kV)"
  psql "${DB_URI}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

INSERT INTO identified_objects (mrid, name, lifecycle_state, validation)
VALUES ('${SEG_MRID}', '${NAME//\'/\'\'} Feeder Tap', 'IN_SERVICE', 'APPROVED');

INSERT INTO conducting_equipment (mrid, phases, nominal_voltage, serial_number)
VALUES ('${SEG_MRID}', 'ABC', 'MV_11KV', 'TEST-WIRE-${SUFFIX:0:6}');

INSERT INTO ac_line_segments (mrid, source_node_id, target_node_id, direction_downstream, geom)
VALUES (
  '${SEG_MRID}',
  '${CONNECT_FROM}',
  '${MRID}',
  true,
  ST_SetSRID(
    ST_MakeLine(
      (SELECT geom FROM connectivity_nodes WHERE mrid = '${CONNECT_FROM}'),
      (SELECT geom FROM connectivity_nodes WHERE mrid = '${MRID}')
    ),
    4326
  )
);

COMMIT;
SQL
fi

echo "${MRID}" > "${STATE_FILE}"

echo ""
echo "Done. MRID saved to ${STATE_FILE}"
echo ""
echo "Delete with:"
echo "  ./scripts/delete_test_node.sh ${MRID}"
echo "  ./scripts/delete_test_node.sh   # uses last added MRID"
