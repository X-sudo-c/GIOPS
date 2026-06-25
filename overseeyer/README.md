# OVERSEEYER

Standalone control plane for the GIOP monorepo. Tracks health of every service, starts/stops/restarts them, and manages Supabase migrations — independent of the GIOP portal.

## Quick start

```bash
chmod +x overseeyer/scripts/start.sh
./overseeyer/scripts/start.sh
```

- **UI:** http://127.0.0.1:5191
- **API:** http://127.0.0.1:5190/api/status

Uses the repo `.venv` if present; logs and PIDs go to `.giop/logs/` and `.giop/pids/` (same as `start_giop_stack.sh`).

## Manual start

**API** (port 5190):

```bash
cd overseeyer/server
pip install -r requirements.txt   # or use repo .venv
uvicorn main:app --host 0.0.0.0 --port 5190 --reload
```

**Web** (port 5191):

```bash
cd overseeyer/web
npm install
npm run dev
```

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Liveness |
| `GET /api/status` | Full stack health |
| `GET /api/observability` | Stack + metrics, DLQ, topology, data plane, logs, migrations |
| `GET /api/observability/stream` | SSE stream (5s interval) of observability snapshot |
| `GET /api/logs` | List `.giop/logs/*.log` with service mapping |
| `GET /api/logs/{name}?tail=200` | Tail log file (max 2000 lines) |
| `POST /api/services/{id}/start` | Start one service |
| `POST /api/services/{id}/stop` | Stop one service |
| `POST /api/services/{id}/restart` | Restart one service |
| `POST /api/stack/start` | Run `scripts/start_giop_stack.sh` |
| `GET /api/migrations` | Local vs applied migrations |
| `POST /api/migrations` | Create new `000NN_slug.sql` |
| `POST /api/migrations/apply` | `migration up` or `db reset` |
| `GET /api/memgraph/bootstrap/status` | Memgraph bootstrap job state |
| `GET /api/memgraph/bootstrap/stream` | SSE stream — runs `.venv/bin/python memgraph/bootstrap.py` with live output |

### Observability checks

The `/api/observability` payload includes:

- **sync_metrics** — from sync-service `GET /api/v1/health/metrics` (p50/p95, error rate)
- **dlq** — open integration DLQ count (sync-service or Postgres fallback)
- **topology** — node/edge counts and pass/warn/fail vs `verify_topology.sh` rules
- **data_plane** — staging asset count, open conflicts, Timescale `meter_readings` check
- **logs** — metadata for all files in `.giop/logs/`

### Service IDs

`supabase`, `memgraph`, `martin`, `timescale`, `sync-service`, `ocr-service`, `giop-portal`, `backoffice-ui`, `overseeyer-api`, `overseeyer-web`

OVERSEEYER cannot start/stop itself via API (use `start.sh`).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `OVERSEYER_API_PORT` | `5190` | API port |
| `OVERSEYER_WEB_PORT` | `5191` | Vite dev server port |
| `GIOP_RUN_DIR` | `.giop` | Shared logs/PIDs directory |
| `SUPABASE_DB_URI` | local Postgres | Migration status queries |

**Local development only** — runs `docker`, `npx supabase`, and process management on the host.
