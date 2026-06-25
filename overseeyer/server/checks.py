"""Read-only observability probes for OVERSEEYER."""

from __future__ import annotations

import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

import overseer

SYNC_METRICS_URL = os.getenv(
    "SYNC_METRICS_URL",
    "http://127.0.0.1:5000/api/v1/health/metrics",
)
SYNC_DLQ_URL = os.getenv(
    "SYNC_DLQ_URL",
    "http://127.0.0.1:5000/api/v1/dlq?status=OPEN",
)
SUPABASE_DB_URI = os.getenv(
    "SUPABASE_DB_URI",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)
TIMESCALE_URI = os.getenv(
    "TIMESCALE_URI",
    "postgresql://postgres:postgres@127.0.0.1:5433/telemetry",
)
MIN_EDGE_RATIO = float(os.getenv("GIOP_MIN_EDGE_RATIO", "0.0001"))
MIN_EDGES = int(os.getenv("GIOP_MIN_EDGES", "10"))

LOG_NAME_TO_SERVICE: dict[str, str] = {
    s.log_name: s.id for s in overseer.SERVICES if s.log_name
}


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


def _fetch_json(url: str, timeout: float = 3.0) -> dict[str, Any] | None:
    try:
        req = Request(url, method="GET")
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, OSError, ValueError, json.JSONDecodeError):
        return None


def _unavailable(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "reason": reason}


def check_sync_metrics() -> dict[str, Any]:
    if not _port_open("127.0.0.1", 5000):
        return _unavailable("sync-service port :5000 closed")
    data = _fetch_json(SYNC_METRICS_URL)
    if not data:
        return _unavailable("could not fetch /api/v1/health/metrics")
    return {
        "status": "ok",
        "apm_status": data.get("status"),
        "request_count": data.get("request_count"),
        "error_count": data.get("error_count"),
        "error_rate_pct": data.get("error_rate_pct"),
        "latency_p50_ms": data.get("latency_p50_ms"),
        "latency_p95_ms": data.get("latency_p95_ms"),
        "last_kafka_ingest_at": data.get("last_kafka_ingest_at"),
    }


def check_dlq() -> dict[str, Any]:
    if _port_open("127.0.0.1", 5000):
        data = _fetch_json(SYNC_DLQ_URL)
        if data and "items" in data:
            items = data["items"]
            return {
                "status": "ok",
                "source": "sync-service",
                "open_count": len(items),
            }

    if not _port_open("127.0.0.1", 54322):
        return _unavailable("sync-service down and Postgres :54322 closed")

    try:
        import psycopg2

        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM public.integration_dlq WHERE status = 'OPEN'"
                )
                count = cur.fetchone()[0]
        finally:
            conn.close()
        return {"status": "ok", "source": "postgres", "open_count": int(count)}
    except Exception as exc:
        return _unavailable(str(exc))


def check_topology() -> dict[str, Any]:
    if not _port_open("127.0.0.1", 54322):
        return _unavailable("Postgres :54322 closed")

    try:
        import psycopg2

        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM public.connectivity_nodes")
                node_count = int(cur.fetchone()[0])
                cur.execute("SELECT COUNT(*) FROM public.ac_line_segments")
                edge_count = int(cur.fetchone()[0])
        finally:
            conn.close()
    except Exception as exc:
        return _unavailable(str(exc))

    if node_count == 0:
        return {
            "status": "warn",
            "node_count": node_count,
            "edge_count": edge_count,
            "edge_ratio": 0.0,
            "hint": "No connectivity_nodes — run GPKG import or seed data",
        }

    ratio = edge_count / node_count if node_count else 0.0
    if edge_count < MIN_EDGES:
        return {
            "status": "fail",
            "node_count": node_count,
            "edge_count": edge_count,
            "edge_ratio": round(ratio, 6),
            "hint": f"Only {edge_count} edges (min {MIN_EDGES}) — run ./scripts/promote_topology.sh",
        }

    if ratio < MIN_EDGE_RATIO:
        return {
            "status": "fail",
            "node_count": node_count,
            "edge_count": edge_count,
            "edge_ratio": round(ratio, 6),
            "hint": "Edge/node ratio too low — use OVERSEEYER “Sync Memgraph” or run .venv/bin/python memgraph/bootstrap.py",
        }

    return {
        "status": "ok",
        "node_count": node_count,
        "edge_count": edge_count,
        "edge_ratio": round(ratio, 6),
        "hint": None,
    }


def check_data_plane() -> dict[str, Any]:
    result: dict[str, Any] = {"status": "ok", "staging_count": None, "open_conflicts": None, "timescale": None}

    if _port_open("127.0.0.1", 54322):
        try:
            import psycopg2

            conn = psycopg2.connect(SUPABASE_DB_URI)
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM staging.identified_objects")
                    result["staging_count"] = int(cur.fetchone()[0])
                    cur.execute(
                        "SELECT COUNT(*) FROM public.conflict_proposals WHERE status = 'OPEN'"
                    )
                    result["open_conflicts"] = int(cur.fetchone()[0])
            finally:
                conn.close()
        except Exception as exc:
            result["status"] = "partial"
            result["postgres_error"] = str(exc)
    else:
        result["status"] = "unavailable"
        result["postgres_error"] = "Postgres :54322 closed"

    if _port_open("127.0.0.1", 5433):
        try:
            import psycopg2

            conn = psycopg2.connect(TIMESCALE_URI)
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT EXISTS (
                          SELECT 1 FROM information_schema.tables
                          WHERE table_schema = 'public' AND table_name = 'meter_readings'
                        )
                        """
                    )
                    result["timescale"] = {
                        "reachable": True,
                        "meter_readings_table": bool(cur.fetchone()[0]),
                    }
            finally:
                conn.close()
        except Exception as exc:
            result["timescale"] = {"reachable": False, "error": str(exc)}
    else:
        result["timescale"] = {"reachable": False, "error": "port :5433 closed"}

    return result


def list_log_files() -> list[dict[str, Any]]:
    overseer.LOG_DIR.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, Any]] = []
    for path in sorted(overseer.LOG_DIR.glob("*.log")):
        stat = path.stat()
        name = path.name
        service_id = LOG_NAME_TO_SERVICE.get(name.removesuffix(".log"), None)
        files.append(
            {
                "name": name,
                "service_id": service_id,
                "path": str(path),
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return files


def tail_log_file(name: str, tail: int = 200) -> dict[str, Any]:
    safe = Path(name).name
    if not safe.endswith(".log") or safe != name:
        raise ValueError("Invalid log filename")

    path = overseer.LOG_DIR / safe
    if not path.is_file():
        raise FileNotFoundError(f"Log not found: {safe}")

    tail = max(1, min(tail, 2000))
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
    except OSError as exc:
        raise ValueError(str(exc)) from exc

    return {
        "name": safe,
        "path": str(path),
        "service_id": LOG_NAME_TO_SERVICE.get(safe.removesuffix(".log")),
        "tail": tail,
        "total_lines": len(lines),
        "lines": [line.rstrip("\n") for line in lines[-tail:]],
    }


def observability_snapshot() -> dict[str, Any]:
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "stack": overseer.stack_status(),
        "sync_metrics": check_sync_metrics(),
        "dlq": check_dlq(),
        "topology": check_topology(),
        "data_plane": check_data_plane(),
        "logs": list_log_files(),
        "migrations": overseer.list_migrations(),
    }
