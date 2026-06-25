"""SVG schematic generation from Memgraph trace (FR-008)."""

from __future__ import annotations

from typing import Any
from xml.sax.saxutils import escape

VOLTAGE_COLORS = {
    "HV_161KV": "#78350F",
    "HV_330KV": "#78350F",
    "MV_33KV": "#1D4ED8",
    "MV_11KV": "#B91C1C",
    "LV_230V": "#0F172A",
    "LV_400V": "#0F172A",
}


def _edge_color(voltage: str | None) -> str:
    if not voltage:
        return "#475569"
    return VOLTAGE_COLORS.get(voltage.upper(), "#475569")


def generate_svg(trace: dict[str, Any], start_mrid: str) -> str:
    nodes = trace.get("nodes") or []
    edges = trace.get("edges") or []
    if not nodes:
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120">'
            '<text x="20" y="60" fill="#64748b">No topology for schematic</text></svg>'
        )

    cols = max(1, min(6, len(nodes)))
    positions: dict[str, tuple[float, float]] = {}
    for i, node in enumerate(nodes):
        col = i % cols
        row = i // cols
        positions[node["mrid"]] = (80 + col * 140, 60 + row * 100)

    lines: list[str] = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" '
        'style="background:#0f172a;font-family:system-ui,sans-serif">',
        '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">'
        '<path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8"/></marker></defs>',
    ]

    for edge in edges:
        src = positions.get(edge.get("source"))
        tgt = positions.get(edge.get("target"))
        if not src or not tgt:
            continue
        color = _edge_color(edge.get("voltage"))
        lines.append(
            f'<line x1="{src[0]}" y1="{src[1]}" x2="{tgt[0]}" y2="{tgt[1]}" '
            f'stroke="{color}" stroke-width="2.5" marker-end="url(#arrow)" opacity="0.9"/>'
        )

    for node in nodes:
        mrid = node["mrid"]
        x, y = positions[mrid]
        is_start = mrid == start_mrid
        fill = "#f97316" if is_start else "#334155"
        stroke = "#fff" if is_start else "#64748b"
        name = escape(str(node.get("name") or mrid[:8]))
        lines.append(f'<circle cx="{x}" cy="{y}" r="14" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        lines.append(f'<text x="{x}" y="{y + 28}" text-anchor="middle" fill="#e2e8f0" font-size="10">{name}</text>')

    lines.append("</svg>")
    return "\n".join(lines)
