"""Data lineage read helpers (FR-003)."""

from __future__ import annotations

import json
from typing import Any, Optional

import psycopg2


def log_lineage(
    conn,
    *,
    target_mrid: str,
    source_type: str,
    action_type: str,
    operator_id: str | None = None,
    provenance_ref: str | None = None,
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT public.log_data_lineage(
              %s::uuid, %s::lineage_source_type, %s, %s, %s, %s::jsonb, %s::jsonb
            )
            """,
            (
                target_mrid,
                source_type,
                action_type,
                operator_id,
                provenance_ref,
                json.dumps(before_state) if before_state is not None else None,
                json.dumps(after_state) if after_state is not None else None,
            ),
        )
        return int(cur.fetchone()[0])


def fetch_lineage(conn, asset_mrid: str, limit: int = 50) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, target_mrid::text, source_type::text, action_type,
                   operator_id, provenance_ref, before_state, after_state, created_at
            FROM public.data_lineage
            WHERE target_mrid = %s::uuid
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (asset_mrid, limit),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "target_mrid": row[1],
            "source_type": row[2],
            "action_type": row[3],
            "operator_id": row[4],
            "provenance_ref": row[5],
            "before_state": row[6],
            "after_state": row[7],
            "created_at": row[8].isoformat() if row[8] else None,
        }
        for row in rows
    ]


def fetch_asset_updated_at(conn, mrid: str, tier: str) -> Optional[Any]:
    table = "staging.identified_objects" if tier == "staging" else "public.identified_objects"
    with conn.cursor() as cur:
        cur.execute(f"SELECT updated_at FROM {table} WHERE mrid = %s", (mrid,))
        row = cur.fetchone()
        return row[0] if row else None


def insert_conflict_proposal(
    conn,
    *,
    asset_mrid: str,
    offline_session_started_at: str,
    server_updated_at,
    proposed_payload: dict[str, Any],
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO conflict_proposals (
              asset_mrid, offline_session_started_at, server_updated_at, proposed_payload
            ) VALUES (%s::uuid, %s::timestamptz, %s, %s::jsonb)
            RETURNING id::text
            """,
            (asset_mrid, offline_session_started_at, server_updated_at, json.dumps(proposed_payload)),
        )
        conflict_id = cur.fetchone()[0]
        cur.execute(
            """
            UPDATE staging.identified_objects
            SET validation = 'IN_CONFLICT', updated_at = NOW()
            WHERE mrid = %s::uuid
            """,
            (asset_mrid,),
        )
        if cur.rowcount == 0:
            cur.execute(
                """
                UPDATE public.identified_objects
                SET validation = 'IN_CONFLICT', updated_at = NOW()
                WHERE mrid = %s::uuid
                """,
                (asset_mrid,),
            )
    return conflict_id


def list_open_conflicts(conn, limit: int = 100) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cp.id::text, cp.asset_mrid::text, cp.offline_session_started_at,
                   cp.server_updated_at, cp.proposed_payload, cp.status::text, cp.created_at,
                   COALESCE(sio.name, pio.name) AS asset_name
            FROM conflict_proposals cp
            LEFT JOIN staging.identified_objects sio ON sio.mrid = cp.asset_mrid
            LEFT JOIN public.identified_objects pio ON pio.mrid = cp.asset_mrid
            WHERE cp.status = 'OPEN'
            ORDER BY cp.created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "asset_mrid": row[1],
            "offline_session_started_at": row[2].isoformat() if row[2] else None,
            "server_updated_at": row[3].isoformat() if row[3] else None,
            "proposed_payload": row[4],
            "status": row[5],
            "created_at": row[6].isoformat() if row[6] else None,
            "asset_name": row[7],
        }
        for row in rows
    ]


def resolve_conflict(
    conn,
    conflict_id: str,
    resolution: str,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT asset_mrid::text, proposed_payload, status::text
            FROM conflict_proposals WHERE id = %s::uuid
            """,
            (conflict_id,),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Conflict not found")
        asset_mrid, proposed, status = row
        if status != "OPEN":
            raise ValueError("Conflict already resolved")

        if resolution == "master":
            new_status = "RESOLVED_MASTER"
            cur.execute(
                """
                UPDATE staging.identified_objects
                SET validation = 'STAGED', updated_at = NOW()
                WHERE mrid = %s::uuid AND validation = 'IN_CONFLICT'
                """,
                (asset_mrid,),
            )
            if cur.rowcount == 0:
                cur.execute(
                    """
                    UPDATE public.identified_objects
                    SET validation = 'APPROVED', updated_at = NOW()
                    WHERE mrid = %s::uuid AND validation = 'IN_CONFLICT'
                    """,
                    (asset_mrid,),
                )
        elif resolution == "field":
            new_status = "RESOLVED_FIELD"
            payload = proposed or {}
            name = payload.get("name")
            lon = payload.get("longitude")
            lat = payload.get("latitude")
            if name:
                cur.execute(
                    "UPDATE staging.identified_objects SET name = %s, validation = 'STAGED', updated_at = NOW() WHERE mrid = %s::uuid",
                    (name, asset_mrid),
                )
                if cur.rowcount == 0:
                    cur.execute(
                        "UPDATE public.identified_objects SET name = %s, validation = 'STAGED', updated_at = NOW() WHERE mrid = %s::uuid",
                        (name, asset_mrid),
                    )
            if lon is not None and lat is not None:
                cur.execute(
                    """
                    UPDATE staging.connectivity_nodes
                    SET geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                    WHERE mrid = %s::uuid
                    """,
                    (lon, lat, asset_mrid),
                )
                if cur.rowcount == 0:
                    cur.execute(
                        """
                        UPDATE public.connectivity_nodes
                        SET geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                        WHERE mrid = %s::uuid
                        """,
                        (lon, lat, asset_mrid),
                    )
            log_lineage(
                conn,
                target_mrid=asset_mrid,
                source_type="FIELD_SYNC",
                action_type="CONFLICT_RESOLVED_FIELD",
                provenance_ref=conflict_id,
                after_state=payload,
            )
        elif resolution == "discard":
            new_status = "DISCARDED"
            cur.execute(
                "UPDATE staging.identified_objects SET validation = 'STAGED', updated_at = NOW() WHERE mrid = %s::uuid",
                (asset_mrid,),
            )
        else:
            raise ValueError("resolution must be master, field, or discard")

        cur.execute(
            """
            UPDATE conflict_proposals SET status = %s::conflict_proposal_status WHERE id = %s::uuid
            """,
            (new_status, conflict_id),
        )
    return {"conflict_id": conflict_id, "asset_mrid": asset_mrid, "status": new_status}
