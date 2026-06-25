#!/usr/bin/env python3
"""Full reconcile: Postgres connectivity topology → Memgraph (removes orphans)."""

import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

sys.path.insert(0, str(ROOT / "sync-service"))
from graph_sync import reconcile_memgraph  # noqa: E402


def _driver_hint(exc: BaseException) -> str | None:
    msg = str(exc).lower()
    if "defunct connection" not in msg:
        return None
    venv_python = ROOT / ".venv" / "bin" / "python"
    if venv_python.is_file():
        return (
            "Memgraph Bolt handshake failed — use the project venv "
            f"({venv_python} memgraph/bootstrap.py). "
            "System python often ships an incompatible neo4j driver."
        )
    return (
        "Memgraph Bolt handshake failed — install deps in a venv "
        "(pip install -r memgraph/requirements.txt) and rerun with that python."
    )


def main():
    try:
        stats = reconcile_memgraph()
        print(
            "Reconciled Memgraph from Postgres: "
            f"{stats['nodes_synced']} nodes, {stats['edges_synced']} edges "
            f"(removed {stats['orphan_nodes_removed']} orphan nodes, "
            f"{stats['orphan_edges_removed']} orphan edges)"
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        hint = _driver_hint(exc)
        if hint:
            print(f"Hint: {hint}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
