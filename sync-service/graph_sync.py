"""Postgres → Memgraph sync. Postgres is always the source of truth."""

from __future__ import annotations

import os
import time
from typing import Any, Optional

import psycopg2
from neo4j import GraphDatabase

GRAPH_URI = os.getenv("GRAPH_DB_URI") or os.getenv("MEMGRAPH_URI", "bolt://127.0.0.1:7687")
SUPABASE_DB_URI = os.getenv("SUPABASE_DB_URI")
SYNC_BATCH_SIZE = int(os.getenv("MEMGRAPH_SYNC_BATCH", "5000"))
SYNC_MAX_RETRIES = int(os.getenv("MEMGRAPH_SYNC_RETRIES", "5"))
SYNC_RETRY_DELAY_SEC = float(os.getenv("MEMGRAPH_SYNC_RETRY_DELAY", "2"))


def _pg_connect():
    if not SUPABASE_DB_URI:
        raise RuntimeError("SUPABASE_DB_URI not configured")
    return psycopg2.connect(SUPABASE_DB_URI)


def fetch_topology_from_postgres() -> tuple[list[tuple[str, str]], list[tuple[str, str, str, str, str, bool]]]:
    conn = _pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cn.mrid::text, io.name
                FROM connectivity_nodes cn
                JOIN identified_objects io ON cn.mrid = io.mrid
                """
            )
            nodes = cur.fetchall()
            cur.execute(
                """
                SELECT
                  als.mrid::text,
                  als.source_node_id::text,
                  als.target_node_id::text,
                  ce.phases,
                  ce.nominal_voltage::text,
                  als.direction_downstream
                FROM ac_line_segments als
                JOIN conducting_equipment ce ON als.mrid = ce.mrid
                """
            )
            edges = cur.fetchall()
        return nodes, edges
    finally:
        conn.close()


def _is_transient_memgraph_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "defunct connection",
            "database shutdown",
            "transient",
            "connection reset",
            "broken pipe",
            "timeout",
            "service unavailable",
        )
    )


def _run_write(driver, query: str, **params) -> None:
    """Execute one Memgraph write in its own session/transaction with retries."""
    last_exc: BaseException | None = None
    for attempt in range(SYNC_MAX_RETRIES):
        try:
            with driver.session() as session:
                result = session.run(query, **params)
                result.consume()
            return
        except Exception as exc:
            last_exc = exc
            if attempt + 1 >= SYNC_MAX_RETRIES or not _is_transient_memgraph_error(exc):
                raise
            delay = SYNC_RETRY_DELAY_SEC * (attempt + 1)
            print(
                f"  Memgraph write retry {attempt + 1}/{SYNC_MAX_RETRIES} "
                f"after {delay:.0f}s ({exc})",
                flush=True,
            )
            time.sleep(delay)
    if last_exc:
        raise last_exc


def _log_progress(phase: str, done: int, total: int, offset: int) -> None:
    if total <= SYNC_BATCH_SIZE or offset % (SYNC_BATCH_SIZE * 5) == 0 or done == total:
        print(f"  {phase} {done}/{total}", flush=True)


def _upsert_nodes(driver, nodes: list[tuple[str, str]], sync_epoch: int) -> None:
    total = len(nodes)
    for offset in range(0, total, SYNC_BATCH_SIZE):
        batch = [
            {"mrid": mrid, "name": name}
            for mrid, name in nodes[offset : offset + SYNC_BATCH_SIZE]
        ]
        _run_write(
            driver,
            """
            UNWIND $batch AS row
            MERGE (c:ConnectivityNode {mrid: row.mrid})
            SET c.name = row.name, c.sync_epoch = $sync_epoch
            """,
            batch=batch,
            sync_epoch=sync_epoch,
        )
        _log_progress("nodes", min(offset + len(batch), total), total, offset)


def _upsert_edges(
    driver,
    edges: list[tuple[str, str, str, str, str, bool]],
    sync_epoch: int,
) -> None:
    total = len(edges)
    for offset in range(0, total, SYNC_BATCH_SIZE):
        batch = [
            {
                "mrid": mrid,
                "source_mrid": source_id,
                "target_mrid": target_id,
                "phases": phases,
                "voltage": voltage,
                "direction": direction,
            }
            for mrid, source_id, target_id, phases, voltage, direction in edges[
                offset : offset + SYNC_BATCH_SIZE
            ]
        ]
        _run_write(
            driver,
            """
            UNWIND $batch AS row
            MATCH (src:ConnectivityNode {mrid: row.source_mrid})
            MATCH (tgt:ConnectivityNode {mrid: row.target_mrid})
            MERGE (src)-[r:AC_LINE_SEGMENT {mrid: row.mrid}]->(tgt)
            SET r.phases = row.phases,
                r.voltage = row.voltage,
                r.direction_downstream = row.direction,
                r.sync_epoch = $sync_epoch
            """,
            batch=batch,
            sync_epoch=sync_epoch,
        )
        _log_progress("edges", min(offset + len(batch), total), total, offset)


def _delete_in_batches(
    driver,
    query: str,
    *,
    label: str,
    sync_epoch: int | None = None,
) -> int:
    removed = 0
    while True:
        params: dict[str, Any] = {"batch_size": SYNC_BATCH_SIZE}
        if sync_epoch is not None:
            params["sync_epoch"] = sync_epoch
        with driver.session() as session:
            result = session.run(query, **params)
            summary = result.consume()
            deleted = summary.counters.nodes_deleted + summary.counters.relationships_deleted
        if deleted == 0:
            break
        removed += deleted
        print(f"  removed {removed} stale {label}...", flush=True)
    return removed


def _remove_stale_edges(driver, sync_epoch: int, *, has_edges: bool) -> int:
    if not has_edges:
        return _delete_in_batches(
            driver,
            """
            MATCH ()-[r:AC_LINE_SEGMENT]->()
            WITH r LIMIT $batch_size
            DELETE r
            """,
            label="edges",
        )
    return _delete_in_batches(
        driver,
        """
        MATCH ()-[r:AC_LINE_SEGMENT]->()
        WHERE r.sync_epoch IS NULL OR r.sync_epoch <> $sync_epoch
        WITH r LIMIT $batch_size
        DELETE r
        """,
        label="edges",
        sync_epoch=sync_epoch,
    )


def _remove_stale_nodes(driver, sync_epoch: int, *, has_nodes: bool) -> int:
    if not has_nodes:
        return _delete_in_batches(
            driver,
            """
            MATCH (c:ConnectivityNode)
            WITH c LIMIT $batch_size
            DETACH DELETE c
            """,
            label="nodes",
        )
    return _delete_in_batches(
        driver,
        """
        MATCH (c:ConnectivityNode)
        WHERE c.sync_epoch IS NULL OR c.sync_epoch <> $sync_epoch
        WITH c LIMIT $batch_size
        DETACH DELETE c
        """,
        label="nodes",
        sync_epoch=sync_epoch,
    )


def reconcile_memgraph(driver: GraphDatabase.driver | None = None) -> dict[str, Any]:
    """Upsert all Postgres rows and remove Memgraph nodes/edges not in Postgres."""
    own_driver = driver is None
    if own_driver:
        driver = GraphDatabase.driver(GRAPH_URI, auth=None)

    nodes, edges = fetch_topology_from_postgres()
    sync_epoch = int(time.time())
    if nodes or edges:
        print(
            f"Syncing {len(nodes)} nodes and {len(edges)} edges to Memgraph "
            f"(batch size {SYNC_BATCH_SIZE})...",
            flush=True,
        )

    removed_nodes = 0
    removed_edges = 0

    try:
        _upsert_nodes(driver, nodes, sync_epoch)
        _upsert_edges(driver, edges, sync_epoch)

        print("  cleaning stale edges...", flush=True)
        removed_edges = _remove_stale_edges(driver, sync_epoch, has_edges=bool(edges))

        print("  cleaning stale nodes...", flush=True)
        removed_nodes = _remove_stale_nodes(driver, sync_epoch, has_nodes=bool(nodes))
    finally:
        if own_driver:
            driver.close()

    return {
        "nodes_synced": len(nodes),
        "edges_synced": len(edges),
        "orphan_nodes_removed": removed_nodes,
        "orphan_edges_removed": removed_edges,
    }


def apply_webhook_event(
    driver: GraphDatabase.driver,
    table: str,
    action: str,
    record: Optional[dict[str, Any]],
    old_record: Optional[dict[str, Any]],
    lookup_node_name,
    lookup_equipment,
) -> None:
    """Apply a single INSERT/UPDATE/DELETE, then reconcile so Postgres remains authoritative."""
    rec = record if action in ("INSERT", "UPDATE") else old_record
    if not rec or "mrid" not in rec:
        reconcile_memgraph(driver)
        return

    mrid = str(rec["mrid"])

    with driver.session() as session:
        if table == "connectivity_nodes":
            if action in ("INSERT", "UPDATE"):
                name = rec.get("name") or lookup_node_name(mrid) or mrid
                session.run(
                    "MERGE (c:ConnectivityNode {mrid: $mrid}) SET c.name = $name",
                    mrid=mrid,
                    name=name,
                )
            elif action == "DELETE":
                session.run(
                    "MATCH (c:ConnectivityNode {mrid: $mrid}) DETACH DELETE c",
                    mrid=mrid,
                )

        elif table == "ac_line_segments":
            if action in ("INSERT", "UPDATE"):
                phases = rec.get("phases")
                voltage = rec.get("nominal_voltage")
                if not phases or not voltage:
                    db_phases, db_voltage = lookup_equipment(mrid)
                    phases = phases or db_phases
                    voltage = voltage or db_voltage
                session.run(
                    """
                    MATCH (s:ConnectivityNode {mrid: $source_id})
                    MATCH (t:ConnectivityNode {mrid: $target_id})
                    MERGE (s)-[r:AC_LINE_SEGMENT {mrid: $mrid}]->(t)
                    SET r.direction_downstream = $direction,
                        r.phases = $phases,
                        r.voltage = $voltage
                    """,
                    mrid=mrid,
                    source_id=str(rec["source_node_id"]),
                    target_id=str(rec["target_node_id"]),
                    direction=rec.get("direction_downstream", True),
                    phases=phases,
                    voltage=voltage,
                )
            elif action == "DELETE":
                session.run(
                    "MATCH ()-[r:AC_LINE_SEGMENT {mrid: $mrid}]->() DELETE r",
                    mrid=mrid,
                )

    reconcile_memgraph(driver)
