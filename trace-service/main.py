"""GIOP trace service — downstream network path from a starting MRID."""

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase

load_dotenv()

MEMGRAPH_URI = os.environ.get("MEMGRAPH_URI", "bolt://localhost:7687")

app = FastAPI(title="GIOP Trace Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TRACE_QUERY = """
MATCH (s {mrid: $mrid})
MATCH p = (s)-[:AC_LINE_SEGMENT*1..10]->(c)
RETURN p
"""


def _node_payload(node) -> dict[str, Any]:
    return {
        "mrid": node.get("mrid"),
        "name": node.get("name"),
        "type": list(node.labels),
    }


def _edge_payload(rel) -> dict[str, Any]:
    return {
        "mrid": rel.get("mrid"),
        "source": rel.start_node.get("mrid"),
        "target": rel.end_node.get("mrid"),
        "phases": rel.get("phases"),
        "voltage": rel.get("voltage"),
    }


@app.get("/api/v1/trace")
def trace(start_mrid: str | None = Query(default=None)):
    if not start_mrid:
        raise HTTPException(status_code=400, detail="start_mrid query parameter is required")

    driver = GraphDatabase.driver(MEMGRAPH_URI, auth=None)
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}

    try:
        with driver.session() as session:
            result = session.run(TRACE_QUERY, mrid=start_mrid)
            records = list(result)

        if not records:
            raise HTTPException(status_code=404, detail=f"No paths found from mrid {start_mrid}")

        for record in records:
            path = record["p"]
            for node in path.nodes:
                nodes[node.get("mrid")] = _node_payload(node)
            for rel in path.relationships:
                key = rel.get("mrid") or f"{rel.start_node.get('mrid')}->{rel.end_node.get('mrid')}"
                edges[key] = _edge_payload(rel)

        return {"nodes": list(nodes.values()), "edges": list(edges.values())}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        driver.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5001, reload=True)
