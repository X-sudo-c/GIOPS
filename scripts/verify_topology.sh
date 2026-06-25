#!/usr/bin/env bash
# Verify connectivity_nodes vs ac_line_segments ratio in Postgres.
# Exit 0 if topology looks wired; exit 1 if nodes exist but edges are too sparse.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54322}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD

MIN_EDGE_RATIO="${GIOP_MIN_EDGE_RATIO:-0.0001}"
MIN_EDGES="${GIOP_MIN_EDGES:-10}"

if ! command -v psql >/dev/null 2>&1; then
  echo "verify_topology: psql not found" >&2
  exit 2
fi

if ! nc -z "$PGHOST" "$PGPORT" 2>/dev/null; then
  echo "verify_topology: Postgres not reachable at ${PGHOST}:${PGPORT}" >&2
  exit 2
fi

read -r node_count edge_count <<<"$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atqc \
  "SELECT (SELECT COUNT(*) FROM public.connectivity_nodes), (SELECT COUNT(*) FROM public.ac_line_segments);")"

node_count="${node_count:-0}"
edge_count="${edge_count:-0}"

echo "Topology: ${node_count} nodes, ${edge_count} edges"

if [[ "$node_count" -eq 0 ]]; then
  echo "WARN: no connectivity_nodes — run GPKG import or seed data" >&2
  exit 0
fi

if [[ "$edge_count" -lt "$MIN_EDGES" ]]; then
  echo "FAIL: only ${edge_count} edges (minimum ${MIN_EDGES}) — run ./scripts/promote_topology.sh" >&2
  exit 1
fi

ratio_ok=$(python3 - <<PY
nodes = int("${node_count}")
edges = int("${edge_count}")
min_ratio = float("${MIN_EDGE_RATIO}")
ratio = edges / nodes if nodes else 0
print("yes" if ratio >= min_ratio else "no")
PY
)

if [[ "$ratio_ok" != "yes" ]]; then
  echo "FAIL: edge/node ratio too low (${edge_count}/${node_count}) — run ./scripts/promote_topology.sh" >&2
  exit 1
fi

echo "OK: topology ratio acceptable"
exit 0
