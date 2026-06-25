"""Shared helpers for operational modules (cases, tickets, work orders, outages)."""

from __future__ import annotations

import json
from typing import Any, Optional

RECORD_KINDS = frozenset({"CASE", "TICKET", "WORK_ORDER", "OUTAGE"})

REF_SEQUENCES = {
    "CASE": ("CASE", "ops_case_ref_seq"),
    "TICKET": ("TKT", "ops_ticket_ref_seq"),
    "WORK_ORDER": ("WO", "ops_work_order_ref_seq"),
    "OUTAGE": ("OUT", "ops_outage_ref_seq"),
}


def next_reference(conn, kind: str) -> str:
    prefix, seq = REF_SEQUENCES[kind]
    with conn.cursor() as cur:
        cur.execute("SELECT ops_next_reference(%s, %s)", (prefix, seq))
        return cur.fetchone()[0]


def write_audit(
    conn,
    *,
    record_type: str,
    record_id: str,
    event_type: str,
    operator_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops_audit_events (record_type, record_id, event_type, operator_id, payload)
            VALUES (%s::ops_record_kind, %s::uuid, %s, %s, %s::jsonb)
            """,
            (record_type, record_id, event_type, operator_id, json.dumps(payload or {})),
        )


def create_link(
    conn,
    *,
    source_type: str,
    source_id: str,
    target_type: str,
    target_id: str,
    link_reason: Optional[str] = None,
    created_by: Optional[str] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops_record_links
              (source_type, source_id, target_type, target_id, link_reason, created_by)
            VALUES (%s::ops_record_kind, %s::uuid, %s::ops_record_kind, %s::uuid, %s, %s)
            ON CONFLICT (source_type, source_id, target_type, target_id) DO NOTHING
            """,
            (source_type, source_id, target_type, target_id, link_reason, created_by),
        )


def list_links(conn, record_type: str, record_id: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_type::text, source_id::text, target_type::text, target_id::text,
                   link_reason, created_at
            FROM ops_record_links
            WHERE (source_type = %s::ops_record_kind AND source_id = %s::uuid)
               OR (target_type = %s::ops_record_kind AND target_id = %s::uuid)
            ORDER BY created_at DESC
            """,
            (record_type, record_id, record_type, record_id),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def queue_notification(
    conn,
    *,
    channel: str,
    recipient: str,
    message_type: str,
    payload: dict[str, Any],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notification_log (channel, recipient, message_type, status, payload)
            VALUES (%s, %s, %s, 'QUEUED'::notification_status, %s::jsonb)
            """,
            (channel, recipient, message_type, json.dumps(payload)),
        )


def validate_transition(current: str, new: str, allowed: dict[str, set[str]]) -> None:
    if current == new:
        return
    permitted = allowed.get(current, set())
    if new not in permitted:
        raise ValueError(f"Invalid status transition: {current} -> {new}")


CASE_TRANSITIONS: dict[str, set[str]] = {
    "NEW": {"OPEN", "CLOSED"},
    "OPEN": {"ESCALATED", "CLOSED"},
    "ESCALATED": {"OPEN", "CLOSED"},
    "CLOSED": set(),
}

TICKET_TRANSITIONS: dict[str, set[str]] = {
    "NEW": {"OPEN", "ASSIGNED", "CLOSED"},
    "OPEN": {"ASSIGNED", "IN_PROGRESS", "ESCALATED", "CLOSED"},
    "ASSIGNED": {"IN_PROGRESS", "PENDING_FIELD", "ESCALATED", "CLOSED"},
    "IN_PROGRESS": {"PENDING_FIELD", "RESOLVED", "ESCALATED", "CLOSED"},
    "PENDING_FIELD": {"IN_PROGRESS", "RESOLVED", "ESCALATED"},
    "ESCALATED": {"IN_PROGRESS", "RESOLVED", "CLOSED"},
    "RESOLVED": {"CLOSED", "OPEN"},
    "CLOSED": set(),
}

WORK_ORDER_TRANSITIONS: dict[str, set[str]] = {
    "DISPATCHED": {"RECEIVED", "ACCEPTED", "CANCELLED", "REJECTED"},
    "RECEIVED": {"ACCEPTED", "REJECTED", "CANCELLED"},
    "ACCEPTED": {"EN_ROUTE", "CANCELLED"},
    "EN_ROUTE": {"ON_SITE", "CANCELLED"},
    "ON_SITE": {"IN_PROGRESS", "CANCELLED"},
    "IN_PROGRESS": {"COMPLETED", "REJECTED"},
    "COMPLETED": set(),
    "REJECTED": set(),
    "CANCELLED": set(),
}

OUTAGE_TRANSITIONS: dict[str, set[str]] = {
    "PLANNED": {"ACTIVE", "CANCELLED"},
    "ACTIVE": {"RESTORING", "RESTORED", "CANCELLED"},
    "RESTORING": {"RESTORED", "CANCELLED"},
    "RESTORED": set(),
    "CANCELLED": set(),
}
