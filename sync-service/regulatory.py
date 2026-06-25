"""Regulatory reporting metrics (FR-015 MVP)."""

from __future__ import annotations

import json
from typing import Any, Optional


def compute_metrics(
    conn,
    *,
    period_start: str,
    period_end: str,
    customer_base: int = 10000,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT compute_regulatory_metrics(%s::timestamptz, %s::timestamptz, %s)",
            (period_start, period_end, customer_base),
        )
        row = cur.fetchone()
        if not row or not row[0]:
            return {}
        return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def generate_report(
    conn,
    *,
    period_start: str,
    period_end: str,
    customer_base: int = 10000,
    generated_by: Optional[str] = None,
) -> dict[str, Any]:
    metrics = compute_metrics(
        conn,
        period_start=period_start,
        period_end=period_end,
        customer_base=customer_base,
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO regulatory_report_runs (period_start, period_end, metrics, generated_by)
            VALUES (%s::timestamptz, %s::timestamptz, %s::jsonb, %s)
            RETURNING id::text, generated_at
            """,
            (period_start, period_end, json.dumps(metrics), generated_by),
        )
        row = cur.fetchone()
    return {
        "id": row[0],
        "period_start": period_start,
        "period_end": period_end,
        "metrics": metrics,
        "generated_by": generated_by,
        "generated_at": row[1].isoformat() if row[1] else None,
    }


def list_reports(conn, limit: int = 50) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, period_start, period_end, metrics, generated_by, generated_at
            FROM regulatory_report_runs
            ORDER BY generated_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        cols = [d[0] for d in cur.description]
        out = []
        for row in cur.fetchall():
            item = dict(zip(cols, row))
            for k, v in list(item.items()):
                if hasattr(v, "isoformat"):
                    item[k] = v.isoformat()
            out.append(item)
        return out
