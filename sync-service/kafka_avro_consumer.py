"""Kafka Avro consumer — ghana-ami-telemetry-avro → TimescaleDB batch ingest."""

import json
import logging
import os
import time
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_batch

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("giop.kafka_consumer")

TIMESCALE_URI = os.getenv("TIMESCALE_URI")
SUPABASE_DB_URI = os.getenv("SUPABASE_DB_URI")
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
SCHEMA_REGISTRY_URL = os.getenv("SCHEMA_REGISTRY_URL", "http://localhost:8081")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "ghana-ami-telemetry-avro")
GROUP_ID = os.getenv("KAFKA_GROUP_ID", "giop-timescale-ingest")
AVSC_PATH = Path(__file__).resolve().parent.parent / "config" / "meter_reading.avsc"


def _load_avro_schema() -> str:
    with open(AVSC_PATH, encoding="utf-8") as f:
        return f.read()


def _register_schema_if_needed(schema_str: str) -> None:
    try:
        import urllib.request

        req = urllib.request.Request(
            f"{SCHEMA_REGISTRY_URL}/subjects/{KAFKA_TOPIC}-value/versions",
            data=json.dumps({"schema": schema_str}).encode(),
            headers={"Content-Type": "application/vnd.schemaregistry.v1+json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            log.info("Schema registered: %s", resp.read().decode())
    except Exception as exc:
        log.warning("Schema registration skipped or already exists: %s", exc)


def _insert_batch(rows: list[tuple]) -> None:
    conn = psycopg2.connect(TIMESCALE_URI)
    try:
        with conn.cursor() as cur:
            execute_batch(
                cur,
                """
                INSERT INTO public.meter_readings
                  (meter_mrid, reading_timestamp, active_energy_kwh)
                VALUES (%s, to_timestamp(%s / 1000.0), %s)
                ON CONFLICT DO NOTHING
                """,
                rows,
                page_size=100,
            )
            conn.commit()
        log.info("Inserted %d readings", len(rows))
        try:
            from metrics import record_kafka_ingest

            record_kafka_ingest()
        except ImportError:
            pass
    finally:
        conn.close()


def run_consumer() -> None:
    if not TIMESCALE_URI:
        raise RuntimeError("TIMESCALE_URI not configured")

    schema_str = _load_avro_schema()
    _register_schema_if_needed(schema_str)

    from confluent_kafka import Consumer
    from confluent_kafka.schema_registry import SchemaRegistryClient
    from confluent_kafka.schema_registry.avro import AvroDeserializer
    from confluent_kafka.serialization import SerializationContext, MessageField

    registry = SchemaRegistryClient({"url": SCHEMA_REGISTRY_URL})
    deserializer = AvroDeserializer(registry, schema_str)

    consumer = Consumer(
        {
            "bootstrap.servers": KAFKA_BOOTSTRAP,
            "group.id": GROUP_ID,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        }
    )
    consumer.subscribe([KAFKA_TOPIC])
    log.info("Listening on topic %s", KAFKA_TOPIC)

    batch: list[tuple] = []
    while True:
        try:
            msg = consumer.poll(1.0)
            if msg is None:
                if batch:
                    _insert_batch(batch)
                    batch = []
                continue
            if msg.error():
                log.error("Kafka error: %s", msg.error())
                continue

            payload = deserializer(msg.value(), SerializationContext(KAFKA_TOPIC, MessageField.VALUE))
            batch.append(
                (
                    payload["meter_mrid"],
                    payload["reading_timestamp"],
                    payload["active_energy_kwh"],
                )
            )
            if len(batch) >= 50:
                _insert_batch(batch)
                batch = []
        except KeyboardInterrupt:
            break
        except Exception as exc:
            log.exception("Consumer loop error (schema/data): %s", exc)
            if SUPABASE_DB_URI:
                try:
                    from dlq import insert_dlq

                    fail_payload: dict = {"error": str(exc)}
                    conn = psycopg2.connect(SUPABASE_DB_URI)
                    try:
                        insert_dlq(
                            conn,
                            source="KAFKA",
                            payload=fail_payload,
                            error_message=str(exc),
                        )
                        conn.commit()
                    finally:
                        conn.close()
                except Exception as dlq_exc:
                    log.warning("DLQ insert failed: %s", dlq_exc)
            time.sleep(2)

    if batch:
        _insert_batch(batch)
    consumer.close()


if __name__ == "__main__":
    run_consumer()
