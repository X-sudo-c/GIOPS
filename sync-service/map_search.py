"""Map spotlight search — assets, districts, work orders, field crews."""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)

SEARCH_KINDS = frozenset({"asset", "place", "work_order", "crew"})


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _search_assets(cur, pattern: str, prefix: str, q: str, per_kind: int) -> list[dict[str, Any]]:
    rows: list[tuple[Any, ...]]
    if UUID_RE.match(q):
        cur.execute(
            """
            SELECT cn.mrid::text, io.name, io.validation::text,
                   ST_X(cn.geom) AS longitude, ST_Y(cn.geom) AS latitude
            FROM public.connectivity_nodes cn
            JOIN public.identified_objects io ON io.mrid = cn.mrid
            WHERE cn.geom IS NOT NULL
              AND cn.mrid::text ILIKE %s
            ORDER BY io.name
            LIMIT %s
            """,
            (prefix, per_kind),
        )
    else:
        cur.execute(
            """
            SELECT cn.mrid::text, io.name, io.validation::text,
                   ST_X(cn.geom) AS longitude, ST_Y(cn.geom) AS latitude
            FROM public.connectivity_nodes cn
            JOIN public.identified_objects io ON io.mrid = cn.mrid
            WHERE cn.geom IS NOT NULL
              AND (io.name ILIKE %s OR cn.mrid::text ILIKE %s)
            ORDER BY
              CASE WHEN io.name ILIKE %s THEN 0 ELSE 1 END,
              io.name
            LIMIT %s
            """,
            (pattern, pattern, prefix, per_kind),
        )
    rows = cur.fetchall()
    return [
        {
            "kind": "asset",
            "id": mrid,
            "title": name or mrid,
            "subtitle": validation or "Connectivity node",
            "longitude": _float_or_none(lon),
            "latitude": _float_or_none(lat),
        }
        for mrid, name, validation, lon, lat in rows
    ]


def _search_places(cur, pattern: str, per_kind: int) -> list[dict[str, Any]]:
    # gis.ecg_admin_boundaries columns: fid, district, region, geom
    cur.execute(
        """
        SELECT
          COALESCE(district, region) AS label,
          MAX(region) AS region,
          ST_X(ST_Centroid(ST_Union(geom))) AS center_lon,
          ST_Y(ST_Centroid(ST_Union(geom))) AS center_lat,
          ST_XMin(ST_Extent(geom)) AS west,
          ST_YMin(ST_Extent(geom)) AS south,
          ST_XMax(ST_Extent(geom)) AS east,
          ST_YMax(ST_Extent(geom)) AS north
        FROM gis.ecg_admin_boundaries
        WHERE district ILIKE %s OR region ILIKE %s
        GROUP BY COALESCE(district, region)
        ORDER BY label
        LIMIT %s
        """,
        (pattern, pattern, per_kind),
    )
    out: list[dict[str, Any]] = []
    for label, region, clon, clat, west, south, east, north in cur.fetchall():
        out.append(
            {
                "kind": "place",
                "id": f"place:{label}",
                "title": label or "District",
                "subtitle": region or "ECG boundary",
                "longitude": _float_or_none(clon),
                "latitude": _float_or_none(clat),
                "bbox": {
                    "west": _float_or_none(west),
                    "south": _float_or_none(south),
                    "east": _float_or_none(east),
                    "north": _float_or_none(north),
                },
            }
        )
    return out


def _search_work_orders(cur, pattern: str, per_kind: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT wo.id::text, wo.reference, wo.summary, wo.status::text,
               COALESCE(ST_X(wo.geom), ST_X(cn.geom)) AS longitude,
               COALESCE(ST_Y(wo.geom), ST_Y(cn.geom)) AS latitude
        FROM work_orders wo
        LEFT JOIN public.connectivity_nodes cn ON cn.mrid = wo.asset_mrid
        WHERE wo.reference ILIKE %s
           OR wo.summary ILIKE %s
           OR wo.work_type::text ILIKE %s
        ORDER BY wo.created_at DESC
        LIMIT %s
        """,
        (pattern, pattern, pattern, per_kind),
    )
    return [
        {
            "kind": "work_order",
            "id": wo_id,
            "title": reference or summary or wo_id,
            "subtitle": summary or status or "Work order",
            "longitude": _float_or_none(lon),
            "latitude": _float_or_none(lat),
        }
        for wo_id, reference, summary, status, lon, lat in cur.fetchall()
    ]


def _search_crews(cur, pattern: str, per_kind: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT technician_id, display_name, longitude, latitude
        FROM public.field_technician_positions
        WHERE technician_id ILIKE %s
           OR display_name ILIKE %s
        ORDER BY reported_at DESC NULLS LAST
        LIMIT %s
        """,
        (pattern, pattern, per_kind),
    )
    return [
        {
            "kind": "crew",
            "id": tech_id,
            "title": display_name or tech_id,
            "subtitle": "Field technician",
            "longitude": _float_or_none(lon),
            "latitude": _float_or_none(lat),
        }
        for tech_id, display_name, lon, lat in cur.fetchall()
    ]


def search_map(
    conn,
    *,
    query: str,
    limit: int = 12,
    kinds: Optional[set[str]] = None,
) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if len(q) < 2:
        return []

    active_kinds = kinds or SEARCH_KINDS
    per_kind = max(3, min(limit, 20))
    pattern = f"%{q}%"
    prefix = f"{q}%"
    results: list[dict[str, Any]] = []

    searchers: list[tuple[str, Any]] = []
    if "asset" in active_kinds:
        searchers.append(("asset", lambda cur: _search_assets(cur, pattern, prefix, q, per_kind)))
    if "place" in active_kinds:
        searchers.append(("place", lambda cur: _search_places(cur, pattern, per_kind)))
    if "work_order" in active_kinds:
        searchers.append(("work_order", lambda cur: _search_work_orders(cur, pattern, per_kind)))
    if "crew" in active_kinds:
        searchers.append(("crew", lambda cur: _search_crews(cur, pattern, per_kind)))

    with conn.cursor() as cur:
        for kind, fn in searchers:
            if len(results) >= limit:
                break
            try:
                results.extend(fn(cur))
            except Exception:
                logger.exception("map search %s failed for query=%r", kind, q)
                conn.rollback()

    ql = q.lower()

    def rank(item: dict[str, Any]) -> tuple[int, str]:
        title = (item.get("title") or "").lower()
        if title.startswith(ql):
            return (0, title)
        if ql in title:
            return (1, title)
        return (2, title)

    results.sort(key=rank)
    return results[:limit]


def list_places_index(conn) -> list[dict[str, Any]]:
    """All ECG districts and regions with centroid + bbox for client-side map search."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              district,
              MAX(region) AS region,
              ST_X(ST_Centroid(ST_Union(geom))) AS center_lon,
              ST_Y(ST_Centroid(ST_Union(geom))) AS center_lat,
              ST_XMin(ST_Extent(geom)) AS west,
              ST_YMin(ST_Extent(geom)) AS south,
              ST_XMax(ST_Extent(geom)) AS east,
              ST_YMax(ST_Extent(geom)) AS north
            FROM gis.ecg_admin_boundaries
            WHERE district IS NOT NULL AND TRIM(district) <> ''
            GROUP BY district
            ORDER BY district
            """
        )
        for district, region, clon, clat, west, south, east, north in cur.fetchall():
            label = (district or "").strip()
            if not label:
                continue
            key = f"d:{label.lower()}"
            seen.add(key)
            out.append(
                {
                    "kind": "place",
                    "id": f"district:{label}",
                    "title": label,
                    "subtitle": region or "District",
                    "place_type": "district",
                    "longitude": _float_or_none(clon),
                    "latitude": _float_or_none(clat),
                    "bbox": {
                        "west": _float_or_none(west),
                        "south": _float_or_none(south),
                        "east": _float_or_none(east),
                        "north": _float_or_none(north),
                    },
                }
            )

        cur.execute(
            """
            SELECT
              region,
              ST_X(ST_Centroid(ST_Union(geom))) AS center_lon,
              ST_Y(ST_Centroid(ST_Union(geom))) AS center_lat,
              ST_XMin(ST_Extent(geom)) AS west,
              ST_YMin(ST_Extent(geom)) AS south,
              ST_XMax(ST_Extent(geom)) AS east,
              ST_YMax(ST_Extent(geom)) AS north
            FROM gis.ecg_admin_boundaries
            WHERE region IS NOT NULL AND TRIM(region) <> ''
            GROUP BY region
            ORDER BY region
            """
        )
        for region, clon, clat, west, south, east, north in cur.fetchall():
            label = (region or "").strip()
            if not label:
                continue
            key = f"r:{label.lower()}"
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "kind": "place",
                    "id": f"region:{label}",
                    "title": label,
                    "subtitle": "Region",
                    "place_type": "region",
                    "longitude": _float_or_none(clon),
                    "latitude": _float_or_none(clat),
                    "bbox": {
                        "west": _float_or_none(west),
                        "south": _float_or_none(south),
                        "east": _float_or_none(east),
                        "north": _float_or_none(north),
                    },
                }
            )

    out.sort(key=lambda item: (item.get("title") or "").lower())
    return out
