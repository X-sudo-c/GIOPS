"""Trouble ticket management (FR-014)."""

from __future__ import annotations

from typing import Any, Optional

from ops_common import TICKET_TRANSITIONS, create_link, list_links, next_reference, validate_transition, write_audit


def _row_to_dict(cur, row) -> dict[str, Any]:
    cols = [d[0] for d in cur.description]
    out = dict(zip(cols, row))
    for k, v in list(out.items()):
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


def list_tickets(conn, *, status: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if status:
        clauses.append("status = %s::ticket_status")
        params.append(status)
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id::text, reference, source::text, source_case_id::text,
                   account_mrid::text, meter_mrid::text, asset_mrid::text,
                   ticket_type, category, severity, priority, status::text,
                   assigned_to, due_at, summary, resolution_code, resolution_summary,
                   created_by, created_at, updated_at
            FROM trouble_tickets
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            params,
        )
        return [_row_to_dict(cur, row) for row in cur.fetchall()]


def get_ticket(conn, ticket_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, reference, source::text, source_case_id::text,
                   account_mrid::text, meter_mrid::text, asset_mrid::text,
                   ticket_type, category, severity, priority, status::text,
                   assigned_to, due_at, summary, resolution_code, resolution_summary,
                   created_by, created_at, updated_at
            FROM trouble_tickets WHERE id = %s::uuid
            """,
            (ticket_id,),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Ticket not found")
        ticket = _row_to_dict(cur, row)
    ticket["links"] = list_links(conn, "TICKET", ticket_id)
    return ticket


def create_ticket(conn, data: dict[str, Any]) -> dict[str, Any]:
    ref = next_reference(conn, "TICKET")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO trouble_tickets (
              reference, source, source_case_id, account_mrid, meter_mrid, asset_mrid,
              ticket_type, category, severity, priority, status, assigned_to, due_at,
              summary, created_by
            ) VALUES (
              %s, %s::ticket_source, %s::uuid, %s::uuid, %s::uuid, %s::uuid,
              %s, %s, %s, %s, %s::ticket_status, %s, %s,
              %s, %s
            )
            RETURNING id::text
            """,
            (
                ref,
                data.get("source", "MANUAL"),
                data.get("source_case_id"),
                data.get("account_mrid"),
                data.get("meter_mrid"),
                data.get("asset_mrid"),
                data.get("ticket_type", "CUSTOMER"),
                data.get("category"),
                data.get("severity", "MEDIUM"),
                data.get("priority", 3),
                data.get("status", "NEW"),
                data.get("assigned_to"),
                data.get("due_at"),
                data["summary"],
                data.get("created_by"),
            ),
        )
        ticket_id = cur.fetchone()[0]
    write_audit(
        conn,
        record_type="TICKET",
        record_id=ticket_id,
        event_type="created",
        operator_id=data.get("created_by"),
        payload={"reference": ref},
    )
    return get_ticket(conn, ticket_id)


def patch_ticket(conn, ticket_id: str, data: dict[str, Any]) -> dict[str, Any]:
    current = get_ticket(conn, ticket_id)
    if "status" in data and data["status"]:
        validate_transition(current["status"], data["status"], TICKET_TRANSITIONS)
    fields = []
    params: list[Any] = []
    for col in (
        "ticket_type",
        "category",
        "severity",
        "priority",
        "status",
        "assigned_to",
        "due_at",
        "summary",
        "resolution_code",
        "resolution_summary",
    ):
        if col in data and data[col] is not None:
            if col == "status":
                fields.append("status = %s::ticket_status")
            else:
                fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return current
    fields.append("updated_at = NOW()")
    params.append(ticket_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE trouble_tickets SET {', '.join(fields)} WHERE id = %s::uuid",
            params,
        )
    write_audit(
        conn,
        record_type="TICKET",
        record_id=ticket_id,
        event_type="updated",
        operator_id=data.get("operator_id"),
        payload=data,
    )
    return get_ticket(conn, ticket_id)


def link_ticket(
    conn,
    ticket_id: str,
    *,
    target_type: str,
    target_id: str,
    link_reason: Optional[str] = None,
    operator_id: Optional[str] = None,
) -> dict[str, Any]:
    if target_type not in ("CASE", "WORK_ORDER", "OUTAGE"):
        raise ValueError("Invalid link target type")
    create_link(
        conn,
        source_type="TICKET",
        source_id=ticket_id,
        target_type=target_type,
        target_id=target_id,
        link_reason=link_reason or "manual",
        created_by=operator_id,
    )
    write_audit(
        conn,
        record_type="TICKET",
        record_id=ticket_id,
        event_type="linked",
        operator_id=operator_id,
        payload={"target_type": target_type, "target_id": target_id},
    )
    return get_ticket(conn, ticket_id)
