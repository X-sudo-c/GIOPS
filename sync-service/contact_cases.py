"""Contact centre cases (FR-013 MVP)."""

from __future__ import annotations

from typing import Any, Optional

from ops_common import CASE_TRANSITIONS, create_link, list_links, next_reference, validate_transition, write_audit
from trouble_tickets import create_ticket
from work_orders import create_work_order


def _row_to_dict(cur, row) -> dict[str, Any]:
    cols = [d[0] for d in cur.description]
    out = dict(zip(cols, row))
    for k, v in list(out.items()):
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


def list_cases(conn, *, status: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if status:
        clauses.append("status = %s::case_status")
        params.append(status)
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id::text, reference, channel::text, account_mrid::text, meter_mrid::text,
                   asset_mrid::text, classification, priority, status::text, assigned_to,
                   due_at, summary, notes, created_by, created_at, updated_at
            FROM contact_cases
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            params,
        )
        return [_row_to_dict(cur, row) for row in cur.fetchall()]


def get_case(conn, case_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, reference, channel::text, account_mrid::text, meter_mrid::text,
                   asset_mrid::text, classification, priority, status::text, assigned_to,
                   due_at, summary, notes, created_by, created_at, updated_at
            FROM contact_cases WHERE id = %s::uuid
            """,
            (case_id,),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Case not found")
        case = _row_to_dict(cur, row)
    case["links"] = list_links(conn, "CASE", case_id)
    return case


def create_case(conn, data: dict[str, Any]) -> dict[str, Any]:
    ref = next_reference(conn, "CASE")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO contact_cases (
              reference, channel, account_mrid, meter_mrid, asset_mrid,
              classification, priority, status, assigned_to, due_at,
              summary, notes, created_by
            ) VALUES (
              %s, %s::contact_channel, %s::uuid, %s::uuid, %s::uuid,
              %s, %s, %s::case_status, %s, %s,
              %s, %s, %s
            )
            RETURNING id::text
            """,
            (
                ref,
                data["channel"],
                data.get("account_mrid"),
                data.get("meter_mrid"),
                data.get("asset_mrid"),
                data.get("classification", "GENERAL"),
                data.get("priority", 3),
                data.get("status", "NEW"),
                data.get("assigned_to"),
                data.get("due_at"),
                data["summary"],
                data.get("notes"),
                data.get("created_by"),
            ),
        )
        case_id = cur.fetchone()[0]
    write_audit(
        conn,
        record_type="CASE",
        record_id=case_id,
        event_type="created",
        operator_id=data.get("created_by"),
        payload={"reference": ref},
    )
    return get_case(conn, case_id)


def patch_case(conn, case_id: str, data: dict[str, Any]) -> dict[str, Any]:
    current = get_case(conn, case_id)
    if "status" in data and data["status"]:
        validate_transition(current["status"], data["status"], CASE_TRANSITIONS)
    fields = []
    params: list[Any] = []
    for col in ("classification", "priority", "status", "assigned_to", "due_at", "summary", "notes"):
        if col in data and data[col] is not None:
            if col == "status":
                fields.append("status = %s::case_status")
            else:
                fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return current
    fields.append("updated_at = NOW()")
    params.append(case_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE contact_cases SET {', '.join(fields)} WHERE id = %s::uuid",
            params,
        )
    write_audit(
        conn,
        record_type="CASE",
        record_id=case_id,
        event_type="updated",
        operator_id=data.get("operator_id"),
        payload=data,
    )
    return get_case(conn, case_id)


def convert_case_to_ticket(conn, case_id: str, data: dict[str, Any]) -> dict[str, Any]:
    case = get_case(conn, case_id)
    ticket_data = {
        "source": "CASE",
        "source_case_id": case_id,
        "account_mrid": case.get("account_mrid"),
        "meter_mrid": case.get("meter_mrid"),
        "asset_mrid": case.get("asset_mrid"),
        "ticket_type": data.get("ticket_type") or case.get("classification", "CUSTOMER"),
        "severity": data.get("severity", "MEDIUM"),
        "priority": data.get("priority") or case.get("priority", 3),
        "summary": data.get("summary") or case["summary"],
        "assigned_to": data.get("assigned_to") or case.get("assigned_to"),
        "created_by": data.get("created_by"),
    }
    ticket = create_ticket(conn, ticket_data)
    create_link(
        conn,
        source_type="CASE",
        source_id=case_id,
        target_type="TICKET",
        target_id=ticket["id"],
        link_reason="converted",
        created_by=data.get("created_by"),
    )
    if case["status"] not in ("CLOSED",):
        patch_case(conn, case_id, {"status": "OPEN", "operator_id": data.get("created_by")})
    return ticket


def convert_case_to_work_order(conn, case_id: str, data: dict[str, Any]) -> dict[str, Any]:
    case = get_case(conn, case_id)
    wo_type = data.get("work_type", "OTHER")
    if case.get("classification") == "OUTAGE":
        wo_type = "OUTAGE"
    elif case.get("classification") == "METER":
        wo_type = "METER"
    wo_data = {
        "work_type": wo_type,
        "priority": data.get("priority") or case.get("priority", 3),
        "assigned_crew": data.get("assigned_crew"),
        "assigned_user": data.get("assigned_user"),
        "account_mrid": case.get("account_mrid"),
        "asset_mrid": case.get("asset_mrid") or data.get("asset_mrid"),
        "source_case_id": case_id,
        "summary": data.get("summary") or case["summary"],
        "notes": data.get("notes"),
        "created_by": data.get("created_by"),
    }
    wo = create_work_order(conn, wo_data)
    create_link(
        conn,
        source_type="CASE",
        source_id=case_id,
        target_type="WORK_ORDER",
        target_id=wo["id"],
        link_reason="converted",
        created_by=data.get("created_by"),
    )
    return wo
