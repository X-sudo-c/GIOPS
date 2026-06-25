"""Energy balance analytics using TimescaleDB (FR-008)."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import psycopg2

TIMESCALE_URI = os.getenv("TIMESCALE_URI")
SUPABASE_DB_URI = os.getenv("SUPABASE_DB_URI")
ANOMALY_VARIANCE_THRESHOLD = float(os.getenv("ENERGY_ANOMALY_VARIANCE_PCT", "15"))


def _feeder_meter_mrids(zone_key: str) -> list[str]:
    if not SUPABASE_DB_URI:
        return []
    conn = psycopg2.connect(SUPABASE_DB_URI)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT m.mrid::text
                FROM public.meters m
                JOIN public.connectivity_nodes cn ON cn.mrid = m.mrid
                WHERE cn.boundary_feeder_id = %s
                LIMIT 500
                """,
                (zone_key,),
            )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def compute_balance(
    *,
    zone_key: str,
    period_start: datetime,
    period_end: datetime,
    nominal_injection_kwh: float | None = None,
) -> dict[str, Any]:
    if not TIMESCALE_URI:
        raise RuntimeError("TIMESCALE_URI not configured")

    meter_mrids = _feeder_meter_mrids(zone_key)
    energy_out_kwh = 0.0

    if meter_mrids:
        conn = psycopg2.connect(TIMESCALE_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(delta), 0)
                    FROM (
                      SELECT meter_mrid,
                             MAX(active_energy_kwh) - MIN(active_energy_kwh) AS delta
                      FROM public.meter_readings
                      WHERE meter_mrid = ANY(%s::uuid[])
                        AND reading_timestamp >= %s
                        AND reading_timestamp <= %s
                      GROUP BY meter_mrid
                    ) sub
                    """,
                    (meter_mrids, period_start, period_end),
                )
                row = cur.fetchone()
                energy_out_kwh = float(row[0] or 0)
        finally:
            conn.close()

    energy_in_kwh = nominal_injection_kwh if nominal_injection_kwh is not None else energy_out_kwh * 1.05
    if energy_in_kwh <= 0:
        variance_pct = 0.0
    else:
        variance_pct = abs(energy_in_kwh - energy_out_kwh) / energy_in_kwh * 100.0

    anomaly_flag = variance_pct >= ANOMALY_VARIANCE_THRESHOLD

    result_id = None
    if SUPABASE_DB_URI:
        conn = psycopg2.connect(SUPABASE_DB_URI)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO energy_balance_results (
                      zone_key, period_start, period_end,
                      energy_in_kwh, energy_out_kwh, variance_pct, anomaly_flag
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id::text
                    """,
                    (zone_key, period_start, period_end, energy_in_kwh, energy_out_kwh, variance_pct, anomaly_flag),
                )
                result_id = cur.fetchone()[0]
                conn.commit()
        finally:
            conn.close()

    return {
        "id": result_id,
        "zone_key": zone_key,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "energy_in_kwh": round(energy_in_kwh, 3),
        "energy_out_kwh": round(energy_out_kwh, 3),
        "variance_pct": round(variance_pct, 4),
        "anomaly_flag": anomaly_flag,
        "meter_count": len(meter_mrids),
    }
