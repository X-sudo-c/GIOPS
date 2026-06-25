"""GIOP unified sync gateway — graph webhooks, telemetry, and network trace."""

import asyncio
import os
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Literal, Optional

import psycopg2
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from neo4j import GraphDatabase
from pydantic import BaseModel, Field

from dlq import list_dlq, mark_retrying, patch_dlq
from energy_accounting import compute_balance
from graph_sync import apply_webhook_event, reconcile_memgraph
from lineage import (
    fetch_asset_updated_at,
    fetch_lineage,
    insert_conflict_proposal,
    list_open_conflicts,
    log_lineage,
    resolve_conflict,
)
from metrics import record_request, snapshot as metrics_snapshot
from schematic import generate_svg
from contact_cases import (
    convert_case_to_ticket,
    convert_case_to_work_order,
    create_case,
    get_case,
    list_cases,
    patch_case,
)
from outages import create_outage, get_outage, list_outages, patch_outage, restore_outage
from regulatory import compute_metrics, generate_report, list_reports
from trouble_tickets import create_ticket, get_ticket, link_ticket, list_tickets, patch_ticket
from work_orders import create_work_order, get_work_order, list_work_orders, patch_work_order

load_dotenv()

GRAPH_URI = os.getenv("GRAPH_DB_URI") or os.getenv("MEMGRAPH_URI", "bolt://localhost:7687")
SUPABASE_DB_URI = os.getenv("SUPABASE_DB_URI")
TIMESCALE_URI = os.getenv("TIMESCALE_URI")
OCR_SERVICE_URL = os.getenv("OCR_SERVICE_URL", "http://127.0.0.1:5002")

app = FastAPI(title="GIOP Dev Sync Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)
except ImportError:
    pass


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    is_error = False
    try:
        response = await call_next(request)
        is_error = response.status_code >= 500
        return response
    except Exception:
        is_error = True
        raise
    finally:
        duration_ms = (time.perf_counter() - start) * 1000
        record_request(duration_ms, is_error=is_error)

graph_driver = GraphDatabase.driver(
    GRAPH_URI,
    auth=None,
    connection_acquisition_timeout=float(os.getenv("MEMGRAPH_CONNECT_TIMEOUT", "10")),
)

TRACE_QUERY = """
MATCH (s {mrid: $mrid})
MATCH p = (s)-[:AC_LINE_SEGMENT*1..10]->(c)
RETURN p
"""

EDGE_FETCH_QUERY = """
MATCH (s:ConnectivityNode)-[r:AC_LINE_SEGMENT]->(t:ConnectivityNode)
RETURN r.mrid AS mrid,
       s.mrid AS source,
       t.mrid AS target,
       coalesce(r.phases, 'ABC') AS phases,
       coalesce(r.voltage, 'MV_11KV') AS voltage
"""

TraceScope = Literal["traced", "full"]


def _graph_totals(session) -> tuple[int, int]:
    node_count = session.run("MATCH (c:ConnectivityNode) RETURN count(c) AS n").single()["n"]
    edge_count = session.run("MATCH ()-[r:AC_LINE_SEGMENT]->() RETURN count(r) AS n").single()["n"]
    return int(node_count), int(edge_count)


def _collect_traced_mrids(session, start_mrid: str) -> set[str]:
    traced: set[str] = {start_mrid}
    for record in session.run(TRACE_QUERY, mrid=start_mrid):
        path = record["p"]
        for node in path.nodes:
            mrid = node.get("mrid")
            if mrid:
                traced.add(mrid)
    return traced


def _trace_payload_blocking(start_mrid: str, scope: TraceScope) -> dict[str, Any]:
    with graph_driver.session() as session:
        return _build_trace_payload(session, start_mrid, scope)


def _graph_chunk_traced_mrids_blocking(start_mrid: str) -> set[str]:
    with graph_driver.session() as session:
        return _collect_traced_mrids(session, start_mrid)


def _edge_dict(row) -> dict[str, Any]:
    return {
        "mrid": row["mrid"],
        "source": row["source"],
        "target": row["target"],
        "phases": row["phases"],
        "voltage": row["voltage"],
    }


def _build_trace_payload(session, start_mrid: str, scope: TraceScope) -> dict[str, Any]:
    traced_mrids = _collect_traced_mrids(session, start_mrid)
    total_nodes, total_edges = _graph_totals(session)
    all_edge_rows = list(session.run(EDGE_FETCH_QUERY))

    connected_mrids: set[str] = set()
    for row in all_edge_rows:
        connected_mrids.add(row["source"])
        connected_mrids.add(row["target"])

    if scope == "full":
        included_mrids = {row["mrid"] for row in session.run(
            "MATCH (c:ConnectivityNode) RETURN c.mrid AS mrid"
        )}
        edge_rows = all_edge_rows
    else:
        included_mrids = set(traced_mrids)
        for row in all_edge_rows:
            if row["source"] in traced_mrids or row["target"] in traced_mrids:
                included_mrids.add(row["source"])
                included_mrids.add(row["target"])

        edge_rows = [
            row
            for row in all_edge_rows
            if row["source"] in included_mrids and row["target"] in included_mrids
        ]

    node_rows = list(
        session.run(
            """
            MATCH (c:ConnectivityNode)
            WHERE c.mrid IN $mrids
            RETURN c.mrid AS mrid, c.name AS name
            """,
            mrids=list(included_mrids),
        )
    )

    nodes: dict[str, dict[str, Any]] = {}
    for row in node_rows:
        mrid = row["mrid"]
        nodes[mrid] = {
            "mrid": mrid,
            "name": row["name"] or mrid,
            "type": ["ConnectivityNode"],
            "connected": mrid in connected_mrids,
            "traced": mrid in traced_mrids,
        }

    edges: dict[str, dict[str, Any]] = {}
    for row in edge_rows:
        key = row["mrid"] or f"{row['source']}->{row['target']}"
        edges[key] = _edge_dict(row)

    return {
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "start_mrid": start_mrid,
        "scope": scope,
        "graph_totals": {"nodes": total_nodes, "edges": total_edges},
    }


def _fetch_graph_chunk_from_postgres(
    west: float,
    south: float,
    east: float,
    north: float,
    limit: int,
    traced_mrids: set[str] | None = None,
    edge_limit: int = 5000,
) -> dict[str, Any]:
    conn = _pg_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")

    traced_mrids = traced_mrids or set()
    envelope = (west, south, east, north)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  cn.mrid::text,
                  io.name,
                  ST_X(cn.geom) AS lon,
                  ST_Y(cn.geom) AS lat,
                  io.validation
                FROM connectivity_nodes cn
                JOIN identified_objects io ON io.mrid = cn.mrid
                WHERE cn.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
                ORDER BY cn.mrid
                LIMIT %s
                """,
                (*envelope, limit),
            )
            node_rows = cur.fetchall()

            cur.execute(
                """
                SELECT
                  als.mrid::text,
                  als.source_node_id::text,
                  als.target_node_id::text,
                  coalesce(ce.phases, 'ABC'),
                  coalesce(ce.nominal_voltage::text, 'MV_11KV'),
                  ST_X(src.geom) AS src_lon,
                  ST_Y(src.geom) AS src_lat,
                  ST_X(tgt.geom) AS tgt_lon,
                  ST_Y(tgt.geom) AS tgt_lat
                FROM ac_line_segments als
                JOIN conducting_equipment ce ON als.mrid = ce.mrid
                JOIN connectivity_nodes src ON src.mrid = als.source_node_id
                JOIN connectivity_nodes tgt ON tgt.mrid = als.target_node_id
                WHERE als.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
                ORDER BY als.mrid
                LIMIT %s
                """,
                (*envelope, edge_limit + 1),
            )
            edge_rows = cur.fetchall()
            edges_truncated = len(edge_rows) > edge_limit
            if edges_truncated:
                edge_rows = edge_rows[:edge_limit]

            if not node_rows and not edge_rows:
                return {
                    "nodes": [],
                    "edges": [],
                    "bbox": {"west": west, "south": south, "east": east, "north": north},
                    "truncated": False,
                    "edges_truncated": False,
                    "limit": limit,
                    "edge_limit": edge_limit,
                }

            connected_mrids: set[str] = set()
            for _, source, target, _, _, _, _, _, _ in edge_rows:
                connected_mrids.add(source)
                connected_mrids.add(target)

            nodes = [
                {
                    "mrid": mrid,
                    "name": name or mrid,
                    "lon": float(lon),
                    "lat": float(lat),
                    "validation": validation,
                    "connected": mrid in connected_mrids,
                    "traced": mrid in traced_mrids,
                }
                for mrid, name, lon, lat, validation in node_rows
            ]
            edges = [
                {
                    "mrid": mrid,
                    "source": source,
                    "target": target,
                    "phases": phases,
                    "voltage": voltage,
                    "source_lon": float(src_lon),
                    "source_lat": float(src_lat),
                    "target_lon": float(tgt_lon),
                    "target_lat": float(tgt_lat),
                }
                for mrid, source, target, phases, voltage, src_lon, src_lat, tgt_lon, tgt_lat in edge_rows
            ]

            truncated = len(node_rows) >= limit
            return {
                "nodes": nodes,
                "edges": edges,
                "bbox": {"west": west, "south": south, "east": east, "north": north},
                "truncated": truncated,
                "edges_truncated": edges_truncated,
                "limit": limit,
                "edge_limit": edge_limit,
            }
    finally:
        conn.close()


class WebhookPayload(BaseModel):
    model_config = {"extra": "ignore"}

    type: str
    table: str
    record: Optional[dict[str, Any]] = None
    old_record: Optional[dict[str, Any]] = None
    schema: Optional[str] = None


class TelemetryPayload(BaseModel):
    meter_mrid: str
    active_energy_kwh: float = Field(gt=0)


GhanaUtility = Literal["ECG_SOUTHERN", "NEDCO_NORTHERN", "GRIDCO_TRANSMISSION"]


class FieldNodePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-90, le=90)
    operating_utility: GhanaUtility = "ECG_SOUTHERN"
    substation_name: str | None = Field(default=None, max_length=100)
    boundary_feeder_id: str | None = Field(default=None, max_length=50)
    mrid: str | None = None
    offline_session_started_at: str | None = None


class AssetUpdatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    offline_session_started_at: str | None = None


class ConflictResolvePayload(BaseModel):
    resolution: Literal["master", "field", "discard"]


class EnergyBalancePayload(BaseModel):
    zone_key: str = Field(min_length=1, max_length=100)
    period_start: datetime
    period_end: datetime
    nominal_injection_kwh: float | None = Field(default=None, ge=0)


class DlqPatchPayload(BaseModel):
    status: Literal["OPEN", "RETRYING", "RESOLVED", "DISCARDED"]
    payload: dict[str, Any] | None = None


class TopologyRepairPayload(BaseModel):
    target_mrid: str
    radius_meters: float = Field(default=50, gt=0, le=5000)


class ValidationActionPayload(BaseModel):
    validation: Literal["APPROVED", "IN_CONFLICT", "STAGED", "PENDING_FIELD"]


class EquipmentUpdatePayload(BaseModel):
    nominal_voltage: Literal[
        "LV_230V", "LV_400V", "MV_11KV", "MV_33KV", "HV_161KV", "HV_330KV"
    ]


class InspectionCreatePayload(BaseModel):
    asset_mrid: str
    evidence_photo_url: str | None = None
    nameplate_photo_url: str | None = None
    inspector_notes: str | None = None


class SpotBillPayload(BaseModel):
    account_mrid: str
    meter_mrid: str | None = None
    previous_reading_kwh: float = Field(ge=0)
    current_reading_kwh: float = Field(gt=0)
    tariff_rate_ghs: float = Field(default=1.25, gt=0)
    field_technician: str | None = None
    evidence_photo_url: str | None = None


def _pg_connect():
    if not SUPABASE_DB_URI:
        return None
    return psycopg2.connect(SUPABASE_DB_URI)


def _lookup_node_name(mrid: str) -> Optional[str]:
    conn = _pg_connect()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM identified_objects WHERE mrid = %s", (mrid,))
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


def _lookup_equipment(mrid: str) -> tuple[str, str]:
    conn = _pg_connect()
    if not conn:
        return "ABC", "MV_11KV"
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT phases, nominal_voltage::text FROM conducting_equipment WHERE mrid = %s",
                (mrid,),
            )
            row = cur.fetchone()
            if row:
                return row[0], row[1]
            return "ABC", "MV_11KV"
    finally:
        conn.close()


def _post_image_to_ocr(image_bytes: bytes, filename: str = "evidence.jpg") -> dict[str, Any]:
    import requests

    response = requests.post(
        f"{OCR_SERVICE_URL}/api/v1/meter/ocr",
        files={"file": (filename, image_bytes, "image/jpeg")},
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def _validation_status_from_ocr(ocr: dict[str, Any]) -> str:
    if ocr.get("registry_match"):
        return "PASSED"
    if ocr.get("extracted_serial") or ocr.get("extracted_kwh") is not None:
        return "NEEDS_REVIEW"
    return "FAILED"


def _set_inspection_status(inspection_id: str, status: str, notes: str | None = None) -> None:
    conn = _pg_connect()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE field_inspections
                SET ai_validation_status = %s,
                    inspector_notes = COALESCE(%s, inspector_notes)
                WHERE id = %s::uuid
                """,
                (status, notes, inspection_id),
            )
            conn.commit()
    finally:
        conn.close()


def _validate_inspection_background(inspection_id: str, photo_url: str | None) -> None:
    try:
        if not photo_url:
            _set_inspection_status(inspection_id, "NEEDS_REVIEW", "No evidence photo URL")
            return

        import requests

        if photo_url.startswith("http://") or photo_url.startswith("https://"):
            image_bytes = requests.get(photo_url, timeout=30).content
        elif os.path.isfile(photo_url):
            with open(photo_url, "rb") as handle:
                image_bytes = handle.read()
        else:
            _set_inspection_status(inspection_id, "NEEDS_REVIEW", "Unsupported photo reference")
            return

        ocr = _post_image_to_ocr(image_bytes)
        status = _validation_status_from_ocr(ocr)
        note = f"OCR serial={ocr.get('extracted_serial')} kwh={ocr.get('extracted_kwh')}"
        _set_inspection_status(inspection_id, status, note)
    except Exception as exc:
        _set_inspection_status(inspection_id, "FAILED", str(exc))


def sync_to_graph_store(payload: WebhookPayload) -> None:
    # Master (public) changes only — staging rows must not reach Memgraph until promoted.
    if payload.schema and payload.schema != "public":
        return
    if payload.table in ("connectivity_nodes", "ac_line_segments") and payload.type:
        apply_webhook_event(
            graph_driver,
            payload.table,
            payload.type,
            payload.record,
            payload.old_record,
            _lookup_node_name,
            _lookup_equipment,
        )
    else:
        reconcile_memgraph(graph_driver)


@app.post("/webhook/supabase-sync")
async def handle_supabase_sync(
    payload: WebhookPayload,
    background_tasks: BackgroundTasks,
):
    background_tasks.add_task(sync_to_graph_store, payload)
    return {"status": "queued"}


@app.post("/api/v1/graph/reconcile")
async def graph_reconcile():
    """Force full Postgres → Memgraph reconcile (removes orphan graph nodes/edges)."""
    try:
        stats = reconcile_memgraph(graph_driver)
        return {"status": "reconciled", **stats}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/telemetry/submit")
async def log_meter_interval(payload: TelemetryPayload):
    if not TIMESCALE_URI:
        raise HTTPException(status_code=500, detail="TIMESCALE_URI not configured")

    try:
        conn = psycopg2.connect(TIMESCALE_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.meter_readings
                      (meter_mrid, reading_timestamp, active_energy_kwh)
                    VALUES (%s, NOW(), %s)
                    """,
                    (payload.meter_mrid, payload.active_energy_kwh),
                )
                conn.commit()
        finally:
            conn.close()
        return {"status": "ingested"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _asset_tier(cur, mrid: str) -> str | None:
    cur.execute("SELECT 1 FROM staging.identified_objects WHERE mrid = %s", (mrid,))
    if cur.fetchone():
        return "staging"
    cur.execute("SELECT 1 FROM public.identified_objects WHERE mrid = %s", (mrid,))
    if cur.fetchone():
        return "master"
    return None


@app.get("/api/v1/assets/staging")
async def list_staging_assets():
    """Pending field assets awaiting backoffice approval."""
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      cn.mrid::text,
                      io.name,
                      io.validation::text,
                      ST_AsGeoJSON(cn.geom)::json AS geom,
                      cn.boundary_feeder_id,
                      ga.operating_utility::text,
                      ga.substation_name,
                      NULL::text AS nominal_voltage
                    FROM staging.connectivity_nodes cn
                    JOIN staging.identified_objects io ON cn.mrid = io.mrid
                    LEFT JOIN staging.ghana_grid_assets ga ON cn.mrid = ga.mrid
                    ORDER BY io.updated_at DESC
                    """
                )
                rows = cur.fetchall()
        finally:
            conn.close()
        return {
            "assets": [
                {
                    "mrid": r[0],
                    "name": r[1],
                    "validation": r[2],
                    "geom": r[3],
                    "boundary_feeder_id": r[4],
                    "operating_utility": r[5],
                    "substation_name": r[6],
                    "nominal_voltage": r[7],
                    "tier": "staging",
                }
                for r in rows
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/field/nodes")
async def submit_field_node(payload: FieldNodePayload):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")

    proposed = payload.model_dump()
    conn = psycopg2.connect(SUPABASE_DB_URI)
    try:
        if payload.mrid and payload.offline_session_started_at:
            with conn.cursor() as cur:
                tier = _asset_tier(cur, payload.mrid)
                if tier:
                    server_updated = fetch_asset_updated_at(conn, payload.mrid, tier)
                    session_start = datetime.fromisoformat(
                        payload.offline_session_started_at.replace("Z", "+00:00")
                    )
                    if server_updated and server_updated > session_start:
                        conflict_id = insert_conflict_proposal(
                            conn,
                            asset_mrid=payload.mrid,
                            offline_session_started_at=payload.offline_session_started_at,
                            server_updated_at=server_updated,
                            proposed_payload=proposed,
                        )
                        conn.commit()
                        return JSONResponse(
                            status_code=409,
                            content={
                                "detail": "Server record newer than offline session",
                                "conflict_id": conflict_id,
                                "asset_mrid": payload.mrid,
                                "validation": "IN_CONFLICT",
                            },
                        )

        suffix = secrets.token_hex(6)
        mrid = payload.mrid or f"b0000000-0000-0000-0000-{suffix}"
        feeder_id = payload.boundary_feeder_id or f"FEEDER-FIELD-{suffix[:8]}"
        substation = payload.substation_name or payload.name

        with conn.cursor() as cur:
            if payload.mrid:
                tier = _asset_tier(cur, mrid)
                if tier:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Asset {mrid} already exists; use conflict flow if updating",
                    )

            cur.execute(
                """
                INSERT INTO staging.identified_objects (mrid, name, lifecycle_state, validation)
                VALUES (%s, %s, 'IN_SERVICE', 'PENDING_FIELD')
                """,
                (mrid, payload.name),
            )
            cur.execute(
                """
                INSERT INTO staging.connectivity_nodes (mrid, boundary_feeder_id, geom)
                VALUES (
                  %s, %s,
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                )
                """,
                (mrid, feeder_id, payload.longitude, payload.latitude),
            )
            cur.execute(
                """
                INSERT INTO staging.ghana_grid_assets (mrid, operating_utility, substation_name)
                VALUES (%s, %s::ghana_utility_enum, %s)
                """,
                (mrid, payload.operating_utility, substation),
            )
            log_lineage(
                conn,
                target_mrid=mrid,
                source_type="FIELD_SYNC",
                action_type="FIELD_CAPTURE",
                provenance_ref="POST /api/v1/field/nodes",
                after_state=proposed,
            )
            conn.commit()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        conn.close()

    return {
        "mrid": mrid,
        "validation": "PENDING_FIELD",
        "tier": "staging",
        "name": payload.name,
        "longitude": payload.longitude,
        "latitude": payload.latitude,
        "boundary_feeder_id": feeder_id,
    }


@app.post("/api/v1/topology/repair")
async def repair_topology(payload: TopologyRepairPayload, background_tasks: BackgroundTasks):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")

    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                tier = _asset_tier(cur, payload.target_mrid)
                if tier == "staging":
                    cur.execute(
                        "SELECT repair_staging_asset_topology_and_attributes(%s::uuid, %s)",
                        (payload.target_mrid, payload.radius_meters),
                    )
                elif tier == "master":
                    cur.execute(
                        "SELECT repair_asset_topology_and_attributes(%s::uuid, %s)",
                        (payload.target_mrid, payload.radius_meters),
                    )
                else:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Asset {payload.target_mrid} not found in staging or master",
                    )
                result = cur.fetchone()[0]
                log_lineage(
                    conn,
                    target_mrid=payload.target_mrid,
                    source_type="REPAIR",
                    action_type="TOPOLOGY_REPAIR",
                    provenance_ref="POST /api/v1/topology/repair",
                    after_state={"result": result},
                )
                conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        msg = str(exc)
        if "repair_asset_topology_and_attributes" in msg and "does not exist" in msg:
            raise HTTPException(
                status_code=503,
                detail="Migration 00007 not applied. Run: npx supabase db reset",
            ) from exc
        raise HTTPException(status_code=500, detail=msg) from exc

    background_tasks.add_task(reconcile_memgraph, graph_driver)
    return {"status": "repaired", "result": result}


@app.patch("/api/v1/assets/{mrid}/validation")
async def update_asset_validation(
    mrid: str,
    payload: ValidationActionPayload,
    background_tasks: BackgroundTasks,
):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")

    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                tier = _asset_tier(cur, mrid)
                if tier is None:
                    raise HTTPException(status_code=404, detail=f"Asset {mrid} not found")

                if tier == "staging" and payload.validation == "APPROVED":
                    cur.execute("SELECT promote_staged_asset(%s::uuid)", (mrid,))
                    result = cur.fetchone()[0]
                    conn.commit()
                    reconcile_memgraph(graph_driver)
                    return {
                        "mrid": result["mrid"],
                        "validation": result["validation"],
                        "promoted": result.get("promoted", True),
                        "tier": "master",
                    }

                table = "staging.identified_objects" if tier == "staging" else "public.identified_objects"
                cur.execute(
                    f"""
                    UPDATE {table}
                    SET validation = %s::staging_validation_state, updated_at = NOW()
                    WHERE mrid = %s
                    RETURNING mrid, name, validation::text
                    """,
                    (payload.validation, mrid),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail=f"Asset {mrid} not found")
                conn.commit()
        finally:
            conn.close()
        return {"mrid": row[0], "name": row[1], "validation": row[2], "tier": tier}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/assets/{mrid}")
async def update_asset(mrid: str, payload: AssetUpdatePayload):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                tier = _asset_tier(cur, mrid)
                if tier is None:
                    raise HTTPException(status_code=404, detail=f"Asset {mrid} not found")

                if payload.offline_session_started_at:
                    server_updated = fetch_asset_updated_at(conn, mrid, tier)
                    session_start = datetime.fromisoformat(
                        payload.offline_session_started_at.replace("Z", "+00:00")
                    )
                    if server_updated and server_updated > session_start:
                        conflict_id = insert_conflict_proposal(
                            conn,
                            asset_mrid=mrid,
                            offline_session_started_at=payload.offline_session_started_at,
                            server_updated_at=server_updated,
                            proposed_payload=payload.model_dump(),
                        )
                        conn.commit()
                        return JSONResponse(
                            status_code=409,
                            content={
                                "detail": "Server record newer than offline session",
                                "conflict_id": conflict_id,
                                "asset_mrid": mrid,
                            },
                        )

                table = "staging.identified_objects" if tier == "staging" else "public.identified_objects"
                cur.execute(f"SELECT row_to_json(t)::jsonb FROM {table} t WHERE mrid = %s", (mrid,))
                before_row = cur.fetchone()
                cur.execute(
                    f"UPDATE {table} SET name = %s, updated_at = NOW() WHERE mrid = %s RETURNING mrid, name",
                    (payload.name, mrid),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail=f"Asset {mrid} not found")
                log_lineage(
                    conn,
                    target_mrid=mrid,
                    source_type="MANUAL_EDIT",
                    action_type="NAME_UPDATE",
                    provenance_ref="PATCH /api/v1/assets",
                    before_state=before_row[0] if before_row else None,
                    after_state={"name": payload.name},
                )
                conn.commit()
        finally:
            conn.close()
        return {"mrid": row[0], "name": row[1], "tier": tier}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/assets/{mrid}/equipment")
async def update_asset_equipment(mrid: str, payload: EquipmentUpdatePayload):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                tier = _asset_tier(cur, mrid)
                if tier is None:
                    raise HTTPException(status_code=404, detail=f"Asset {mrid} not found")
                schema = "staging" if tier == "staging" else "public"
                cur.execute(
                    f"""
                    UPDATE {schema}.conducting_equipment
                    SET nominal_voltage = %s
                    WHERE mrid = %s
                    RETURNING mrid, nominal_voltage::text
                    """,
                    (payload.nominal_voltage, mrid),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(
                        status_code=404,
                        detail=f"No conducting equipment for asset {mrid}",
                    )
                conn.commit()
        finally:
            conn.close()
        return {"mrid": row[0], "nominal_voltage": row[1], "tier": tier}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/m2c/spot-bill-sync")
async def sync_spot_bill(payload: SpotBillPayload, background_tasks: BackgroundTasks):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")

    if payload.current_reading_kwh <= payload.previous_reading_kwh:
        raise HTTPException(status_code=400, detail="current_reading_kwh must exceed previous_reading_kwh")

    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO spot_billing_records (
                      account_mrid, meter_mrid, previous_reading_kwh,
                      current_reading_kwh, tariff_rate_ghs, field_technician, evidence_photo_url
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, net_consumption_kwh, amount_ghs
                    """,
                    (
                        payload.account_mrid,
                        payload.meter_mrid,
                        payload.previous_reading_kwh,
                        payload.current_reading_kwh,
                        payload.tariff_rate_ghs,
                        payload.field_technician,
                        payload.evidence_photo_url,
                    ),
                )
                bill = cur.fetchone()
                cur.execute(
                    "SELECT balance_ghs FROM customer_accounts WHERE account_mrid = %s",
                    (payload.account_mrid,),
                )
                balance = cur.fetchone()
                inspection_id = None
                if payload.evidence_photo_url and payload.meter_mrid:
                    cur.execute(
                        """
                        INSERT INTO field_inspections (
                          asset_mrid, evidence_photo_url, ai_validation_status
                        ) VALUES (%s::uuid, %s, 'PENDING')
                        RETURNING id::text
                        """,
                        (payload.meter_mrid, payload.evidence_photo_url),
                    )
                    inspection_row = cur.fetchone()
                    inspection_id = inspection_row[0] if inspection_row else None
                conn.commit()
        finally:
            conn.close()

        ai_status = "QUEUED"
        if inspection_id:
            background_tasks.add_task(
                _validate_inspection_background,
                inspection_id,
                payload.evidence_photo_url,
            )
            ai_status = "PENDING"

        return {
            "status": "synced",
            "bill_id": str(bill[0]),
            "net_consumption_kwh": float(bill[1]),
            "amount_ghs": float(bill[2]),
            "account_balance_ghs": float(balance[0]) if balance else None,
            "ai_validation_status": ai_status,
            "inspection_id": inspection_id,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/inspections")
async def create_inspection(payload: InspectionCreatePayload, background_tasks: BackgroundTasks):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO field_inspections (
                      asset_mrid, evidence_photo_url, nameplate_photo_url,
                      inspector_notes, ai_validation_status
                    ) VALUES (%s::uuid, %s, %s, %s, 'PENDING')
                    RETURNING id::text, ai_validation_status
                    """,
                    (
                        payload.asset_mrid,
                        payload.evidence_photo_url,
                        payload.nameplate_photo_url,
                        payload.inspector_notes,
                    ),
                )
                row = cur.fetchone()
                conn.commit()
        finally:
            conn.close()
        inspection_id = row[0]
        photo = payload.evidence_photo_url or payload.nameplate_photo_url
        if photo:
            background_tasks.add_task(_validate_inspection_background, inspection_id, photo)
        return {"id": inspection_id, "ai_validation_status": row[1]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/inspections")
async def list_inspections(asset_mrid: str | None = Query(default=None)):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                if asset_mrid:
                    cur.execute(
                        """
                        SELECT id::text, asset_mrid::text, ai_validation_status,
                               evidence_photo_url, inspected_at
                        FROM field_inspections
                        WHERE asset_mrid = %s::uuid
                        ORDER BY inspected_at DESC
                        LIMIT 50
                        """,
                        (asset_mrid,),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id::text, asset_mrid::text, ai_validation_status,
                               evidence_photo_url, inspected_at
                        FROM field_inspections
                        ORDER BY inspected_at DESC
                        LIMIT 100
                        """
                    )
                rows = cur.fetchall()
        finally:
            conn.close()
        return {
            "inspections": [
                {
                    "id": r[0],
                    "asset_mrid": r[1],
                    "ai_validation_status": r[2],
                    "evidence_photo_url": r[3],
                    "inspected_at": r[4].isoformat() if r[4] else None,
                }
                for r in rows
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/inspections/{inspection_id}/validate")
async def validate_inspection(inspection_id: str, background_tasks: BackgroundTasks):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT evidence_photo_url, nameplate_photo_url
                    FROM field_inspections WHERE id = %s::uuid
                    """,
                    (inspection_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Inspection not found")
                cur.execute(
                    "UPDATE field_inspections SET ai_validation_status = 'PENDING' WHERE id = %s::uuid",
                    (inspection_id,),
                )
                conn.commit()
        finally:
            conn.close()
        photo = row[0] or row[1]
        background_tasks.add_task(_validate_inspection_background, inspection_id, photo)
        return {"id": inspection_id, "ai_validation_status": "PENDING"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/assets/master")
async def list_master_assets_bbox(
    west: float = Query(..., ge=-180, le=180),
    south: float = Query(..., ge=-90, le=90),
    east: float = Query(..., ge=-180, le=180),
    north: float = Query(..., ge=-90, le=90),
    limit: int = Query(default=500, ge=1, le=5000),
):
    if west >= east or south >= north:
        raise HTTPException(status_code=400, detail="Invalid bbox")
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT cn.mrid::text, io.name, io.validation::text,
                           ST_AsGeoJSON(cn.geom)::json
                    FROM public.connectivity_nodes cn
                    JOIN public.identified_objects io ON cn.mrid = io.mrid
                    WHERE cn.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
                    ORDER BY io.name
                    LIMIT %s
                    """,
                    (west, south, east, north, limit),
                )
                rows = cur.fetchall()
        finally:
            conn.close()
        return {
            "assets": [
                {"mrid": r[0], "name": r[1], "validation": r[2], "geom": r[3]}
                for r in rows
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/trace")
async def execute_trace(
    start_mrid: str | None = Query(default=None),
    scope: TraceScope = Query(default="traced"),
):
    if not start_mrid:
        raise HTTPException(status_code=400, detail="start_mrid query parameter is required")

    try:
        payload = await asyncio.to_thread(_trace_payload_blocking, start_mrid, scope)

        if not payload["nodes"]:
            raise HTTPException(
                status_code=404,
                detail=f"No connectivity nodes in graph (start_mrid={start_mrid})",
            )

        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/graph/chunk")
async def graph_chunk(
    west: float = Query(..., ge=-180, le=180),
    south: float = Query(..., ge=-90, le=90),
    east: float = Query(..., ge=-180, le=180),
    north: float = Query(..., ge=-90, le=90),
    limit: int = Query(default=2000, ge=1, le=5000),
    edge_limit: int = Query(default=5000, ge=1, le=10000),
    start_mrid: str | None = Query(default=None),
):
    if west >= east or south >= north:
        raise HTTPException(status_code=400, detail="Invalid bbox: west < east and south < north required")

    traced_mrids: set[str] = set()
    if start_mrid:
        try:
            traced_mrids = await asyncio.to_thread(_graph_chunk_traced_mrids_blocking, start_mrid)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        return await asyncio.to_thread(
            _fetch_graph_chunk_from_postgres,
            west,
            south,
            east,
            north,
            limit,
            traced_mrids,
            edge_limit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/lineage")
async def get_lineage(
    asset_mrid: str = Query(...),
    limit: int = Query(default=50, ge=1, le=200),
):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            events = fetch_lineage(conn, asset_mrid, limit)
        finally:
            conn.close()
        return {"asset_mrid": asset_mrid, "events": events}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/conflicts")
async def get_conflicts(limit: int = Query(default=100, ge=1, le=500)):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            conflicts = list_open_conflicts(conn, limit)
        finally:
            conn.close()
        return {"conflicts": conflicts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/conflicts/{conflict_id}/resolve")
async def resolve_conflict_endpoint(conflict_id: str, payload: ConflictResolvePayload):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            result = resolve_conflict(conn, conflict_id, payload.resolution)
            conn.commit()
        finally:
            conn.close()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/schematic/generate")
async def schematic_generate(
    mrid: str = Query(...),
    depth: int = Query(default=10, ge=1, le=20),
):
    try:
        with graph_driver.session() as session:
            payload = _build_trace_payload(session, mrid, "traced")
        svg = generate_svg(payload, mrid)
        return Response(content=svg, media_type="image/svg+xml")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/analytics/energy-accounting/balance")
async def energy_accounting_balance(payload: EnergyBalancePayload):
    try:
        return compute_balance(
            zone_key=payload.zone_key,
            period_start=payload.period_start,
            period_end=payload.period_end,
            nominal_injection_kwh=payload.nominal_injection_kwh,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/dlq")
async def get_dlq(status: str | None = Query(default="OPEN")):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            items = list_dlq(conn, status=status)
        finally:
            conn.close()
        return {"items": items}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/dlq/{dlq_id}")
async def patch_dlq_endpoint(dlq_id: str, payload: DlqPatchPayload):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            result = patch_dlq(conn, dlq_id, payload.status, payload.payload)
            conn.commit()
        finally:
            conn.close()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/dlq/{dlq_id}/retry")
async def retry_dlq(dlq_id: str):
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            item = mark_retrying(conn, dlq_id)
            if item["source"] == "KAFKA" and TIMESCALE_URI:
                import psycopg2 as pg

                payload = item["payload"] or {}
                meter_mrid = payload.get("meter_mrid")
                ts = payload.get("reading_timestamp")
                kwh = payload.get("active_energy_kwh")
                if meter_mrid and ts is not None and kwh is not None:
                    ts_conn = pg.connect(TIMESCALE_URI)
                    try:
                        with ts_conn.cursor() as cur:
                            cur.execute(
                                """
                                INSERT INTO public.meter_readings
                                  (meter_mrid, reading_timestamp, active_energy_kwh)
                                VALUES (%s, to_timestamp(%s / 1000.0), %s)
                                ON CONFLICT DO NOTHING
                                """,
                                (meter_mrid, ts, kwh),
                            )
                            ts_conn.commit()
                    finally:
                        ts_conn.close()
                    patch_dlq(conn, dlq_id, "RESOLVED")
                else:
                    patch_dlq(conn, dlq_id, "OPEN")
            else:
                patch_dlq(conn, dlq_id, "RESOLVED")
            conn.commit()
        finally:
            conn.close()
        return {"status": "retried", "id": dlq_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/health/metrics")
async def health_metrics():
    return metrics_snapshot()


# --- Operational modules (Phase 2 MVP) ---


class CaseCreatePayload(BaseModel):
    channel: str
    summary: str
    account_mrid: Optional[str] = None
    meter_mrid: Optional[str] = None
    asset_mrid: Optional[str] = None
    classification: str = "GENERAL"
    priority: int = 3
    assigned_to: Optional[str] = None
    due_at: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None


class CasePatchPayload(BaseModel):
    classification: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    due_at: Optional[str] = None
    summary: Optional[str] = None
    notes: Optional[str] = None
    operator_id: Optional[str] = None


class ConvertTicketPayload(BaseModel):
    ticket_type: Optional[str] = None
    severity: str = "MEDIUM"
    priority: Optional[int] = None
    summary: Optional[str] = None
    assigned_to: Optional[str] = None
    created_by: Optional[str] = None


class ConvertWorkOrderPayload(BaseModel):
    work_type: Optional[str] = None
    priority: Optional[int] = None
    assigned_crew: Optional[str] = None
    assigned_user: Optional[str] = None
    asset_mrid: Optional[str] = None
    summary: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None


class TicketCreatePayload(BaseModel):
    summary: str
    source: str = "MANUAL"
    source_case_id: Optional[str] = None
    account_mrid: Optional[str] = None
    meter_mrid: Optional[str] = None
    asset_mrid: Optional[str] = None
    ticket_type: str = "CUSTOMER"
    category: Optional[str] = None
    severity: str = "MEDIUM"
    priority: int = 3
    assigned_to: Optional[str] = None
    due_at: Optional[str] = None
    created_by: Optional[str] = None


class TicketPatchPayload(BaseModel):
    ticket_type: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    due_at: Optional[str] = None
    summary: Optional[str] = None
    resolution_code: Optional[str] = None
    resolution_summary: Optional[str] = None
    operator_id: Optional[str] = None


class TicketLinkPayload(BaseModel):
    target_type: str
    target_id: str
    link_reason: Optional[str] = None
    operator_id: Optional[str] = None


class WorkOrderCreatePayload(BaseModel):
    summary: str
    work_type: str = "OTHER"
    priority: int = 3
    assigned_crew: Optional[str] = None
    assigned_user: Optional[str] = None
    due_at: Optional[str] = None
    account_mrid: Optional[str] = None
    asset_mrid: Optional[str] = None
    feeder_mrid: Optional[str] = None
    source_ticket_id: Optional[str] = None
    source_case_id: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None


class WorkOrderPatchPayload(BaseModel):
    work_type: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    assigned_crew: Optional[str] = None
    assigned_user: Optional[str] = None
    due_at: Optional[str] = None
    summary: Optional[str] = None
    notes: Optional[str] = None
    operator_id: Optional[str] = None


class OutageCreatePayload(BaseModel):
    summary: str
    outage_type: str = "UNPLANNED"
    status: str = "ACTIVE"
    started_at: Optional[str] = None
    estimated_restoration_at: Optional[str] = None
    affected_area: Optional[str] = None
    feeder_id: Optional[str] = None
    district: Optional[str] = None
    customers_affected: int = 0
    is_published: bool = False
    create_ticket: bool = False
    created_by: Optional[str] = None


class OutagePatchPayload(BaseModel):
    outage_type: Optional[str] = None
    status: Optional[str] = None
    estimated_restoration_at: Optional[str] = None
    restored_at: Optional[str] = None
    affected_area: Optional[str] = None
    feeder_id: Optional[str] = None
    district: Optional[str] = None
    customers_affected: Optional[int] = None
    is_published: Optional[bool] = None
    summary: Optional[str] = None
    operator_id: Optional[str] = None


class OutageRestorePayload(BaseModel):
    restored_at: Optional[str] = None
    operator_id: Optional[str] = None


class RegulatoryGeneratePayload(BaseModel):
    period_start: str
    period_end: str
    customer_base: int = 10000
    generated_by: Optional[str] = None


def _ops_conn():
    if not SUPABASE_DB_URI:
        raise HTTPException(status_code=500, detail="SUPABASE_DB_URI not configured")
    return psycopg2.connect(SUPABASE_DB_URI)


@app.get("/api/v1/cases")
async def api_list_cases(status: str | None = Query(default=None)):
    try:
        conn = _ops_conn()
        try:
            return {"cases": list_cases(conn, status=status)}
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/cases")
async def api_create_case(payload: CaseCreatePayload):
    try:
        conn = _ops_conn()
        try:
            case = create_case(conn, payload.model_dump())
            conn.commit()
        finally:
            conn.close()
        return case
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/cases/{case_id}")
async def api_get_case(case_id: str):
    try:
        conn = _ops_conn()
        try:
            return get_case(conn, case_id)
        finally:
            conn.close()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/cases/{case_id}")
async def api_patch_case(case_id: str, payload: CasePatchPayload):
    try:
        conn = _ops_conn()
        try:
            case = patch_case(conn, case_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return case
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/cases/{case_id}/convert-ticket")
async def api_convert_case_ticket(case_id: str, payload: ConvertTicketPayload):
    try:
        conn = _ops_conn()
        try:
            ticket = convert_case_to_ticket(conn, case_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return ticket
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/cases/{case_id}/convert-work-order")
async def api_convert_case_work_order(case_id: str, payload: ConvertWorkOrderPayload):
    try:
        conn = _ops_conn()
        try:
            wo = convert_case_to_work_order(conn, case_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return wo
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/tickets")
async def api_list_tickets(status: str | None = Query(default=None)):
    try:
        conn = _ops_conn()
        try:
            return {"tickets": list_tickets(conn, status=status)}
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/tickets")
async def api_create_ticket(payload: TicketCreatePayload):
    try:
        conn = _ops_conn()
        try:
            ticket = create_ticket(conn, payload.model_dump())
            conn.commit()
        finally:
            conn.close()
        return ticket
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/tickets/{ticket_id}")
async def api_get_ticket(ticket_id: str):
    try:
        conn = _ops_conn()
        try:
            return get_ticket(conn, ticket_id)
        finally:
            conn.close()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/tickets/{ticket_id}")
async def api_patch_ticket(ticket_id: str, payload: TicketPatchPayload):
    try:
        conn = _ops_conn()
        try:
            ticket = patch_ticket(conn, ticket_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return ticket
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/tickets/{ticket_id}/link")
async def api_link_ticket(ticket_id: str, payload: TicketLinkPayload):
    try:
        conn = _ops_conn()
        try:
            ticket = link_ticket(
                conn,
                ticket_id,
                target_type=payload.target_type,
                target_id=payload.target_id,
                link_reason=payload.link_reason,
                operator_id=payload.operator_id,
            )
            conn.commit()
        finally:
            conn.close()
        return ticket
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/work-orders")
async def api_list_work_orders(
    status: str | None = Query(default=None),
    assigned_user: str | None = Query(default=None),
    assigned_crew: str | None = Query(default=None),
):
    try:
        conn = _ops_conn()
        try:
            return {
                "work_orders": list_work_orders(
                    conn,
                    status=status,
                    assigned_user=assigned_user,
                    assigned_crew=assigned_crew,
                )
            }
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/work-orders/assigned")
async def api_assigned_work_orders(
    user: str | None = Query(default=None),
    crew: str | None = Query(default=None),
):
    if not user and not crew:
        raise HTTPException(status_code=400, detail="user or crew query param required")
    try:
        conn = _ops_conn()
        try:
            return {
                "work_orders": list_work_orders(
                    conn,
                    assigned_user=user,
                    assigned_crew=crew,
                )
            }
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/work-orders")
async def api_create_work_order(payload: WorkOrderCreatePayload):
    try:
        conn = _ops_conn()
        try:
            wo = create_work_order(conn, payload.model_dump())
            conn.commit()
        finally:
            conn.close()
        return wo
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/work-orders/{work_order_id}")
async def api_get_work_order(work_order_id: str):
    try:
        conn = _ops_conn()
        try:
            return get_work_order(conn, work_order_id)
        finally:
            conn.close()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/work-orders/{work_order_id}")
async def api_patch_work_order(work_order_id: str, payload: WorkOrderPatchPayload):
    try:
        conn = _ops_conn()
        try:
            wo = patch_work_order(conn, work_order_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return wo
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/outages")
async def api_list_outages(
    status: str | None = Query(default=None),
    published_only: bool = Query(default=False),
):
    try:
        conn = _ops_conn()
        try:
            return {"outages": list_outages(conn, status=status, published_only=published_only)}
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/outages")
async def api_create_outage(payload: OutageCreatePayload):
    try:
        conn = _ops_conn()
        try:
            outage = create_outage(conn, payload.model_dump())
            conn.commit()
        finally:
            conn.close()
        return outage
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/outages/{outage_id}")
async def api_get_outage(outage_id: str):
    try:
        conn = _ops_conn()
        try:
            return get_outage(conn, outage_id)
        finally:
            conn.close()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/outages/{outage_id}")
async def api_patch_outage(outage_id: str, payload: OutagePatchPayload):
    try:
        conn = _ops_conn()
        try:
            outage = patch_outage(conn, outage_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return outage
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/outages/{outage_id}/restore")
async def api_restore_outage(outage_id: str, payload: OutageRestorePayload):
    try:
        conn = _ops_conn()
        try:
            outage = restore_outage(conn, outage_id, payload.model_dump(exclude_none=True))
            conn.commit()
        finally:
            conn.close()
        return outage
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/regulatory/metrics")
async def api_regulatory_metrics(
    period_start: str = Query(...),
    period_end: str = Query(...),
    customer_base: int = Query(default=10000),
):
    try:
        conn = _ops_conn()
        try:
            return compute_metrics(
                conn,
                period_start=period_start,
                period_end=period_end,
                customer_base=customer_base,
            )
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/regulatory/reports/generate")
async def api_generate_regulatory_report(payload: RegulatoryGeneratePayload):
    try:
        conn = _ops_conn()
        try:
            report = generate_report(conn, **payload.model_dump())
            conn.commit()
        finally:
            conn.close()
        return report
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/regulatory/reports")
async def api_list_regulatory_reports():
    try:
        conn = _ops_conn()
        try:
            return {"reports": list_reports(conn)}
        finally:
            conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.on_event("shutdown")
def shutdown():
    graph_driver.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
