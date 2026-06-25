"""Outage visibility and restoration (FR-016)."""

from __future__ import annotations

from typing import Any, Optional

from ops_common import OUTAGE_TRANSITIONS, create_link, list_links, next_reference, validate_transition, write_audit
from trouble_tickets import create_ticket


def _row_to_dict(cur, row) -> dict[str, Any]:
    cols = [d[0] for d in cur.description]
    out = dict(zip(cols, row))
    for k, v in list(out.items()):
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


def list_outages(
    conn,
    *,
    status: Optional[str] = None,
    published_only: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if status:
        clauses.append("status = %s::outage_status")
        params.append(status)
    if published_only:
        clauses.append("is_published = TRUE")
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id::text, reference, outage_type::text, status::text,
                   started_at, estimated_restoration_at, restored_at,
                   affected_area, feeder_id, district, customers_affected,
                   is_published, summary, created_by, created_at, updated_at
            FROM outages
            WHERE {' AND '.join(clauses)}
            ORDER BY started_at DESC
            LIMIT %s
            """,
            params,
        )
        return [_row_to_dict(cur, row) for row in cur.fetchall()]


def get_outage(conn, outage_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, reference, outage_type::text, status::text,
                   started_at, estimated_restoration_at, restored_at,
                   affected_area, feeder_id, district, customers_affected,
                   is_published, summary, created_by, created_at, updated_at
            FROM outages WHERE id = %s::uuid
            """,
            (outage_id,),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Outage not found")
        outage = _row_to_dict(cur, row)
    outage["links"] = list_links(conn, "OUTAGE", outage_id)
    return outage


def create_outage(conn, data: dict[str, Any]) -> dict[str, Any]:
    ref = next_reference(conn, "OUTAGE")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO outages (
              reference, outage_type, status, started_at, estimated_restoration_at,
              affected_area, feeder_id, district, customers_affected,
              is_published, summary, created_by
            ) VALUES (
              %s, %s::outage_type, %s::outage_status, COALESCE(%s::timestamptz, NOW()),
              %s::timestamptz, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING id::text
            """,
            (
                ref,
                data.get("outage_type", "UNPLANNED"),
                data.get("status", "ACTIVE"),
                data.get("started_at"),
                data.get("estimated_restoration_at"),
                data.get("affected_area"),
                data.get("feeder_id"),
                data.get("district"),
                data.get("customers_affected", 0),
                data.get("is_published", False),
                data["summary"],
                data.get("created_by"),
            ),
        )
        outage_id = cur.fetchone()[0]
    write_audit(
        conn,
        record_type="OUTAGE",
        record_id=outage_id,
        event_type="created",
        operator_id=data.get("created_by"),
        payload={"reference": ref},
    )
    if data.get("create_ticket"):
        ticket = create_ticket(
            conn,
            {
                "source": "OUTAGE",
                "ticket_type": "OUTAGE",
                "severity": "HIGH",
                "priority": 1,
                "summary": data["summary"],
                "created_by": data.get("created_by"),
            },
        )
        create_link(
            conn,
            source_type="OUTAGE",
            source_id=outage_id,
            target_type="TICKET",
            target_id=ticket["id"],
            link_reason="auto_created",
            created_by=data.get("created_by"),
        )
    return get_outage(conn, outage_id)


def patch_outage(conn, outage_id: str, data: dict[str, Any]) -> dict[str, Any]:
    current = get_outage(conn, outage_id)
    if "status" in data and data["status"]:
        validate_transition(current["status"], data["status"], OUTAGE_TRANSITIONS)
    fields = []
    params: list[Any] = []
    for col in (
        "outage_type",
        "status",
        "estimated_restoration_at",
        "restored_at",
        "affected_area",
        "feeder_id",
        "district",
        "customers_affected",
        "is_published",
        "summary",
    ):
        if col in data and data[col] is not None:
            if col in ("outage_type", "status"):
                fields.append(f"{col} = %s::{col}")
            else:
                fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return current
    fields.append("updated_at = NOW()")
    params.append(outage_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE outages SET {', '.join(fields)} WHERE id = %s::uuid",
            params,
        )
    write_audit(
        conn,
        record_type="OUTAGE",
        record_id=outage_id,
        event_type="updated",
        operator_id=data.get("operator_id"),
        payload=data,
    )
    return get_outage(conn, outage_id)


def restore_outage(conn, outage_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return patch_outage(
        conn,
        outage_id,
        {
            "status": "RESTORED",
            "restored_at": data.get("restored_at"),
            "operator_id": data.get("operator_id"),
        },
    )
