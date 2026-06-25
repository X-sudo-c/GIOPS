const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface ServiceStatus {
  id: string;
  name: string;
  kind: string;
  status: string;
  detail: string;
  port: number | null;
  pid: number | null;
  log_path: string | null;
  checked_at: string;
}

export interface StackStatus {
  platform: string;
  overall: string;
  summary: { up: number; down: number; partial: number; total: number };
  services: ServiceStatus[];
  paths: { root: string; overseeyer: string; logs: string; pids: string };
}

export interface MigrationFile {
  version: string;
  filename: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface MigrationInfo {
  local_count: number;
  applied_count: number;
  pending_count: number;
  local: MigrationFile[];
  applied: { version: string; name: string }[];
  pending: string[];
  db_reachable: boolean;
  db_error: string | null;
}

export interface SyncMetricsCheck {
  status: string;
  reason?: string;
  apm_status?: string;
  request_count?: number;
  error_count?: number;
  error_rate_pct?: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  last_kafka_ingest_at?: number | null;
}

export interface DlqCheck {
  status: string;
  reason?: string;
  source?: string;
  open_count?: number;
}

export interface TopologyCheck {
  status: string;
  reason?: string;
  node_count?: number;
  edge_count?: number;
  edge_ratio?: number;
  hint?: string | null;
}

export interface DataPlaneCheck {
  status: string;
  staging_count?: number | null;
  open_conflicts?: number | null;
  postgres_error?: string;
  timescale?: {
    reachable: boolean;
    meter_readings_table?: boolean;
    error?: string;
  };
}

export interface LogFileInfo {
  name: string;
  service_id: string | null;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface LogTail {
  name: string;
  path: string;
  service_id: string | null;
  tail: number;
  total_lines: number;
  lines: string[];
}

export interface ObservabilitySnapshot {
  checked_at: string;
  stack: StackStatus;
  sync_metrics: SyncMetricsCheck;
  dlq: DlqCheck;
  topology: TopologyCheck;
  data_plane: DataPlaneCheck;
  logs: LogFileInfo[];
  migrations: MigrationInfo;
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: string }).detail || res.statusText;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getObservability(): Promise<ObservabilitySnapshot> {
  return fetchJson<ObservabilitySnapshot>('/observability').catch(async (err) => {
    if (err instanceof Error && (err.message === 'Not Found' || err.message.includes('404'))) {
      const [stack, migrations] = await Promise.all([getStatus(), getMigrations()]);
      return {
        checked_at: new Date().toISOString(),
        stack,
        sync_metrics: {
          status: 'unavailable',
          reason: 'API outdated — run ./overseeyer/scripts/start.sh to restart',
        },
        dlq: { status: 'unavailable', reason: 'restart API' },
        topology: { status: 'unavailable', reason: 'restart API' },
        data_plane: { status: 'unavailable' },
        logs: [],
        migrations,
      };
    }
    throw err;
  });
}

export function getStatus(): Promise<StackStatus> {
  return fetchJson<StackStatus>('/status');
}

export function getMigrations(): Promise<MigrationInfo> {
  return fetchJson<MigrationInfo>('/migrations');
}

export function getLogTail(name: string, tail = 200): Promise<LogTail> {
  return fetchJson<LogTail>(`/logs/${encodeURIComponent(name)}?tail=${tail}`);
}

export function observabilityStreamUrl(): string {
  return `${API_BASE}/observability/stream`;
}

export function startService(id: string): Promise<unknown> {
  return fetchJson(`/services/${encodeURIComponent(id)}/start`, { method: 'POST' });
}

export function stopService(id: string): Promise<unknown> {
  return fetchJson(`/services/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

export function restartService(id: string): Promise<unknown> {
  return fetchJson(`/services/${encodeURIComponent(id)}/restart`, { method: 'POST' });
}

export function startStack(opts: {
  portal?: boolean;
  backoffice?: boolean;
  bootstrap?: boolean;
}): Promise<unknown> {
  return fetchJson('/stack/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

export function createMigration(name: string): Promise<{ filename: string }> {
  return fetchJson('/migrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function applyMigrations(mode: 'up' | 'reset', confirm = false): Promise<unknown> {
  return fetchJson('/migrations/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, confirm }),
  });
}

export interface MemgraphBootstrapStatus {
  running: boolean;
  log_name: string;
  python: string;
  script: string;
}

export function getMemgraphBootstrapStatus(): Promise<MemgraphBootstrapStatus> {
  return fetchJson<MemgraphBootstrapStatus>('/memgraph/bootstrap/status');
}

export function memgraphBootstrapStreamUrl(): string {
  return `${API_BASE}/memgraph/bootstrap/stream`;
}
