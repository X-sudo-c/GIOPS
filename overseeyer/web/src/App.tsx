import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  applyMigrations,
  createMigration,
  getLogTail,
  getMemgraphBootstrapStatus,
  getObservability,
  memgraphBootstrapStreamUrl,
  observabilityStreamUrl,
  restartService,
  startService,
  startStack,
  stopService,
  type LogTail,
  type ObservabilitySnapshot,
  type ServiceStatus,
} from './api';

const STATUS_DOT: Record<string, string> = {
  up: 'bg-emerald-400',
  down: 'bg-red-400',
  partial: 'bg-amber-400',
  missing: 'bg-orange-400',
  unknown: 'bg-slate-500',
};

function currentBootstrapLines(lines: string[]): string[] {
  let start = 0;
  lines.forEach((line, index) => {
    if (line.startsWith('--- bootstrap ')) start = index;
  });
  return lines.slice(start);
}

const OVERALL: Record<string, string> = {
  healthy: 'text-emerald-400',
  partial: 'text-amber-400',
  degraded: 'text-orange-400',
  offline: 'text-red-400',
};

const APM_COLORS: Record<string, string> = {
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
};

const CHECK_COLORS: Record<string, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  fail: 'text-red-400',
  unavailable: 'text-slate-500',
  partial: 'text-amber-400',
};

export function App() {
  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [migrationName, setMigrationName] = useState('');
  const [stackOpts, setStackOpts] = useState({ portal: true, backoffice: false, bootstrap: false });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notifyOnDegrade, setNotifyOnDegrade] = useState(false);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<LogTail | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [bootstrapLines, setBootstrapLines] = useState<string[]>([]);
  const [bootstrapRunning, setBootstrapRunning] = useState(false);
  const prevOverall = useRef<string | null>(null);
  const bootstrapSource = useRef<EventSource | null>(null);

  const applySnapshot = useCallback(
    (data: ObservabilitySnapshot) => {
      if (
        notifyOnDegrade &&
        prevOverall.current === 'healthy' &&
        data.stack.overall !== 'healthy' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification('OVERSEEYER', {
          body: `Stack status changed to ${data.stack.overall}`,
        });
      }
      prevOverall.current = data.stack.overall;
      setSnapshot(data);
    },
    [notifyOnDegrade],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await getObservability();
      applySnapshot(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load observability');
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  const loadLog = useCallback(async (name: string) => {
    setLogLoading(true);
    setSelectedLog(name);
    try {
      setLogTail(await getLogTail(name, 200));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load log');
      setLogTail(null);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;

    let es: EventSource | null = null;
    let pollId: number | null = null;

    const startPolling = () => {
      if (pollId !== null) return;
      pollId = window.setInterval(() => void refresh(), 15000);
    };

    try {
      es = new EventSource(observabilityStreamUrl());
      es.onmessage = (event) => {
        try {
          applySnapshot(JSON.parse(event.data) as ObservabilitySnapshot);
        } catch {
          /* ignore malformed SSE */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      es?.close();
      if (pollId !== null) window.clearInterval(pollId);
    };
  }, [autoRefresh, refresh, applySnapshot]);

  useEffect(() => {
    if (!selectedLog || !autoRefresh) return;
    const id = window.setInterval(() => void loadLog(selectedLog), 5000);
    return () => window.clearInterval(id);
  }, [selectedLog, autoRefresh, loadLog]);

  useEffect(() => {
    void getMemgraphBootstrapStatus()
      .then((s) => {
        if (!s.running) return;
        setBootstrapRunning(true);
        setMessage('Memgraph bootstrap in progress…');
        return getLogTail(s.log_name, 80).then((t) =>
          setBootstrapLines(currentBootstrapLines(t.lines)),
        );
      })
      .catch(() => {});
    return () => bootstrapSource.current?.close();
  }, []);

  useEffect(() => {
    if (!bootstrapRunning) return;
    const id = window.setInterval(() => {
      void getMemgraphBootstrapStatus().then((s) => {
        if (s.running) {
          void getLogTail(s.log_name, 80).then((t) =>
            setBootstrapLines(currentBootstrapLines(t.lines)),
          );
        } else {
          setBootstrapRunning(false);
          void refresh();
        }
      });
    }, 3000);
    return () => window.clearInterval(id);
  }, [bootstrapRunning, refresh]);

  const runMemgraphBootstrap = useCallback(() => {
    if (bootstrapRunning) return;
    setBootstrapLines([]);
    setBootstrapRunning(true);
    setMessage('Memgraph bootstrap…');
    bootstrapSource.current?.close();

    const es = new EventSource(memgraphBootstrapStreamUrl());
    bootstrapSource.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          text?: string;
          exit_code?: number;
        };
        if (data.type === 'line' && data.text) {
          setBootstrapLines((prev) => {
            if (data.text!.startsWith('--- bootstrap ')) return [data.text!];
            return [...currentBootstrapLines(prev).slice(-400), data.text!];
          });
        } else if (data.type === 'done') {
          setBootstrapRunning(false);
          es.close();
          setMessage(
            data.exit_code === 0
              ? 'Memgraph bootstrap done'
              : `Memgraph bootstrap failed (exit ${data.exit_code})`,
          );
          void refresh();
        } else if (data.type === 'error') {
          setBootstrapRunning(false);
          es.close();
          setMessage(data.text ?? 'Memgraph bootstrap failed');
        }
      } catch {
        /* ignore malformed SSE */
      }
    };

    es.onerror = () => {
      es.close();
      void getMemgraphBootstrapStatus().then((s) => {
        if (s.running) {
          setBootstrapRunning(true);
          setMessage('Memgraph bootstrap running — reconnect or wait for completion');
          void getLogTail(s.log_name, 80).then((t) =>
            setBootstrapLines(currentBootstrapLines(t.lines)),
          );
        } else {
          setBootstrapRunning(false);
          setMessage('Memgraph bootstrap finished');
          void refresh();
        }
      });
    };
  }, [bootstrapRunning, refresh]);

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    await Notification.requestPermission();
    setNotifyOnDegrade(true);
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setMessage(`${label}…`);
    try {
      await fn();
      setMessage(`${label} done`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  const serviceAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setBusyId(id);
    const fns = { start: startService, stop: stopService, restart: restartService };
    await run(`${action} ${id}`, () => fns[action](id));
    setBusyId(null);
  };

  const status = snapshot?.stack ?? null;
  const migrations = snapshot?.migrations ?? null;
  const metrics = snapshot?.sync_metrics;
  const dlq = snapshot?.dlq;
  const topology = snapshot?.topology;
  const dataPlane = snapshot?.data_plane;
  const logFiles = snapshot?.logs ?? [];
  const applied = new Set(migrations?.applied.map((a) => a.version) ?? []);

  const sortedMigrations = useMemo(() => {
    if (!migrations) return [];
    const appliedVersions = new Set(migrations.applied.map((a) => a.version));
    return [...migrations.local].sort((a, b) => {
      const aApplied = appliedVersions.has(a.version);
      const bApplied = appliedVersions.has(b.version);
      if (aApplied !== bApplied) return aApplied ? 1 : -1;
      return a.version.localeCompare(b.version);
    });
  }, [migrations]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-wide text-cyan-300">OVERSEEYER</h1>
            <p className="text-xs text-slate-400 mt-0.5">GIOP stack health &amp; orchestration</p>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <label className="flex items-center gap-1.5 text-slate-400">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Live updates
            </label>
            <label className="flex items-center gap-1.5 text-slate-400">
              <input
                type="checkbox"
                checked={notifyOnDegrade}
                onChange={(e) => {
                  if (e.target.checked) void requestNotifications();
                  else setNotifyOnDegrade(false);
                }}
              />
              Notify on degrade
            </label>
            <button
              type="button"
              onClick={() => void refresh()}
              className="px-3 py-1.5 rounded bg-cyan-900 hover:bg-cyan-800 text-white"
            >
              Refresh
            </button>
            <a href="http://127.0.0.1:5173" className="text-cyan-500 hover:underline" target="_blank" rel="noreferrer">
              GIOP Portal ↗
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {message && <p className="text-sm text-slate-400">{message}</p>}
        {loading && !status && <p className="text-slate-500">Connecting to OVERSEEYER API…</p>}

        {status && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <span className={`text-2xl font-semibold capitalize ${OVERALL[status.overall] ?? 'text-slate-300'}`}>
                  {status.overall}
                </span>
                <p className="text-sm text-slate-400 mt-1">
                  {status.summary.up} up · {status.summary.partial} partial · {status.summary.down} down
                </p>
              </div>
              <div className="flex flex-wrap gap-3 ml-auto items-center">
                <label className="text-xs text-slate-400 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={stackOpts.portal}
                    onChange={(e) => setStackOpts((o) => ({ ...o, portal: e.target.checked }))}
                  />
                  Portal
                </label>
                <label className="text-xs text-slate-400 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={stackOpts.backoffice}
                    onChange={(e) => setStackOpts((o) => ({ ...o, backoffice: e.target.checked }))}
                  />
                  Legacy UI
                </label>
                <label className="text-xs text-slate-400 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={stackOpts.bootstrap}
                    onChange={(e) => setStackOpts((o) => ({ ...o, bootstrap: e.target.checked }))}
                  />
                  Memgraph bootstrap
                </label>
                <button
                  type="button"
                  className="text-xs px-4 py-2 rounded bg-emerald-800 hover:bg-emerald-700 text-white"
                  onClick={() => void run('Start GIOP stack', () => startStack(stackOpts))}
                >
                  Start all offline
                </button>
              </div>
            </div>
          </section>
        )}

        {snapshot && (
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Observability</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ObsCard title="Sync gateway APM">
                {metrics?.status === 'ok' ? (
                  <>
                    <p className={`text-lg font-semibold capitalize ${APM_COLORS[metrics.apm_status ?? ''] ?? 'text-slate-300'}`}>
                      {metrics.apm_status}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      p50 {metrics.latency_p50_ms}ms · p95 {metrics.latency_p95_ms}ms
                    </p>
                    <p className="text-xs text-slate-500">
                      {metrics.request_count} reqs · {metrics.error_rate_pct}% errors
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">{metrics?.reason ?? 'unavailable'}</p>
                )}
              </ObsCard>

              <ObsCard title="Topology">
                {topology?.status !== 'unavailable' ? (
                  <>
                    <p className={`text-lg font-semibold capitalize ${CHECK_COLORS[topology?.status ?? ''] ?? ''}`}>
                      {topology?.status}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      {topology?.node_count ?? 0} nodes · {topology?.edge_count ?? 0} edges
                    </p>
                    {topology?.hint && <p className="text-xs text-amber-500 mt-1">{topology.hint}</p>}
                    <button
                      type="button"
                      disabled={bootstrapRunning}
                      className="mt-3 text-xs px-3 py-1.5 rounded bg-violet-900 hover:bg-violet-800 disabled:opacity-50 text-white"
                      onClick={() => runMemgraphBootstrap()}
                    >
                      {bootstrapRunning ? 'Syncing Memgraph…' : 'Sync Memgraph'}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">{topology?.reason}</p>
                )}
              </ObsCard>

              <ObsCard title="Queues">
                {dlq?.status === 'ok' ? (
                  <p className="text-lg font-semibold text-slate-200">
                    DLQ <span className="text-amber-400">{dlq.open_count}</span> open
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">{dlq?.reason ?? 'DLQ unavailable'}</p>
                )}
                <p className="text-xs text-slate-500 mt-2">
                  Staging {dataPlane?.staging_count ?? '—'} · Conflicts {dataPlane?.open_conflicts ?? '—'}
                </p>
              </ObsCard>

              <ObsCard title="Timescale">
                {dataPlane?.timescale?.reachable ? (
                  <>
                    <p className="text-lg font-semibold text-emerald-400">reachable</p>
                    <p className="text-xs text-slate-500 mt-2">
                      meter_readings: {dataPlane.timescale.meter_readings_table ? 'yes' : 'no'}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">{dataPlane?.timescale?.error ?? 'unavailable'}</p>
                )}
              </ObsCard>
            </div>
            {(bootstrapRunning || bootstrapLines.length > 0) && (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
                <p className="text-xs text-slate-500 mb-2">
                  Memgraph bootstrap
                  {bootstrapRunning ? ' (running — large grids may take 30+ min)' : ''}
                </p>
                <pre className="text-xs font-mono overflow-auto max-h-48 text-slate-300">
                  {bootstrapLines.join('\n') || 'Waiting for output…'}
                </pre>
              </div>
            )}
          </section>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Log viewer</h2>
            <select
              value={selectedLog ?? ''}
              onChange={(e) => {
                if (e.target.value) void loadLog(e.target.value);
                else {
                  setSelectedLog(null);
                  setLogTail(null);
                }
              }}
              className="text-xs px-2 py-1.5 rounded border border-slate-700 bg-slate-800 text-slate-300"
            >
              <option value="">Select log…</option>
              {logFiles.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                  {f.service_id ? ` (${f.service_id})` : ''}
                </option>
              ))}
            </select>
          </div>
          {logLoading && <p className="text-xs text-slate-500">Loading log…</p>}
          {logTail && (
            <>
              <p className="text-xs text-slate-600 mb-2">
                {logTail.path} · showing last {logTail.lines.length} of {logTail.total_lines} lines
              </p>
              <pre className="text-xs font-mono bg-slate-950 border border-slate-800 rounded p-3 overflow-auto max-h-64 text-slate-300">
                {logTail.lines.join('\n') || '(empty)'}
              </pre>
            </>
          )}
          {!selectedLog && !logLoading && (
            <p className="text-xs text-slate-600">Pick a log file or use View log on a service card.</p>
          )}
        </section>

        {status && (
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Services</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {status.services.map((svc: ServiceStatus) => {
                const selfManaged = svc.id.startsWith('overseeyer-');
                const logName = logFiles.find((f) => f.service_id === svc.id)?.name;
                return (
                  <article
                    key={svc.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[svc.status] ?? STATUS_DOT.unknown}`} />
                      <h3 className="font-medium text-sm">{svc.name}</h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {svc.status} · {svc.detail}
                      {svc.pid ? ` · pid ${svc.pid}` : ''}
                    </p>
                    {selfManaged ? (
                      <p className="text-xs text-slate-600 mt-3">Managed by start.sh</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        <Btn label="Start" color="emerald" disabled={busyId === svc.id} onClick={() => void serviceAction(svc.id, 'start')} />
                        <Btn label="Restart" color="amber" disabled={busyId === svc.id} onClick={() => void serviceAction(svc.id, 'restart')} />
                        <Btn
                          label="Stop"
                          color="slate"
                          disabled={busyId === svc.id || svc.kind === 'supabase'}
                          onClick={() => void serviceAction(svc.id, 'stop')}
                        />
                        {logName && (
                          <Btn label="View log" color="slate" onClick={() => void loadLog(logName)} />
                        )}
                        {svc.id === 'memgraph' && (
                          <Btn
                            label={bootstrapRunning ? 'Syncing…' : 'Bootstrap'}
                            color="violet"
                            disabled={bootstrapRunning}
                            onClick={() => runMemgraphBootstrap()}
                          />
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {migrations && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Migrations</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {migrations.applied_count} applied · {migrations.pending_count} pending · {migrations.local_count} files
                </p>
                {migrations.db_error && <p className="text-xs text-amber-500 mt-1">{migrations.db_error}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded bg-cyan-900 text-white"
                  onClick={() => void run('Apply migrations', () => applyMigrations('up'))}
                >
                  Apply pending
                </button>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded bg-red-900 text-white"
                  onClick={() => {
                    if (!window.confirm('Wipe DB and re-apply all migrations?')) return;
                    void run('DB reset', () => applyMigrations('reset', true));
                  }}
                >
                  DB reset
                </button>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="new_migration_name"
                value={migrationName}
                onChange={(e) => setMigrationName(e.target.value)}
                className="text-sm flex-1 min-w-[200px] px-3 py-2 rounded border border-slate-700 bg-slate-800"
              />
              <button
                type="button"
                className="text-xs px-4 py-2 rounded bg-violet-900 text-white"
                onClick={() => {
                  if (!migrationName.trim()) return;
                  void run('Create migration', async () => {
                    const r = await createMigration(migrationName.trim());
                    setMigrationName('');
                    setMessage(`Created ${r.filename}`);
                  });
                }}
              >
                Create file
              </button>
            </div>

            <div className="overflow-auto max-h-80 rounded border border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 sticky top-0">
                  <tr className="text-slate-500 text-left">
                    <th className="py-2 px-3">Version</th>
                    <th className="py-2 px-3">File</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMigrations.map((m) => {
                    const isApplied = applied.has(m.version);
                    return (
                      <tr key={m.filename} className={!isApplied && migrations.db_reachable ? 'text-amber-400' : 'text-slate-300'}>
                        <td className="py-1.5 px-3 font-mono">{m.version}</td>
                        <td className="py-1.5 px-3 font-mono">{m.filename}</td>
                        <td className="py-1.5 px-3">{isApplied ? 'applied' : migrations.db_reachable ? 'pending' : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ObsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide">{title}</h3>
      <div className="mt-2">{children}</div>
    </article>
  );
}

function Btn({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: 'emerald' | 'amber' | 'slate' | 'violet';
  disabled?: boolean;
  onClick: () => void;
}) {
  const colors = {
    emerald: 'bg-emerald-900 hover:bg-emerald-800',
    amber: 'bg-amber-900 hover:bg-amber-800',
    slate: 'bg-slate-700 hover:bg-slate-600',
    violet: 'bg-violet-900 hover:bg-violet-800',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`text-xs px-2 py-1 rounded text-white disabled:opacity-40 ${colors[color]}`}
    >
      {label}
    </button>
  );
}
