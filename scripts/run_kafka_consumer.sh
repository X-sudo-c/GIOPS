#!/usr/bin/env bash
# Run Kafka Avro consumer (requires external Kafka + Schema Registry).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/sync-service"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
else
  PYTHON="${GIOP_PYTHON:-python3}"
fi

export KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
export SCHEMA_REGISTRY_URL="${SCHEMA_REGISTRY_URL:-http://localhost:8081}"
export KAFKA_TOPIC="${KAFKA_TOPIC:-ghana-ami-telemetry-avro}"
export TIMESCALE_URI="${TIMESCALE_URI:-postgresql://postgres:postgres@127.0.0.1:5433/telemetry}"

echo "Kafka consumer → Timescale"
echo "  KAFKA_BOOTSTRAP=$KAFKA_BOOTSTRAP"
echo "  SCHEMA_REGISTRY_URL=$SCHEMA_REGISTRY_URL"
echo "  KAFKA_TOPIC=$KAFKA_TOPIC"

exec "$PYTHON" kafka_avro_consumer.py
