import { useCallback, useEffect, useState } from 'react';
import {
  createOutage,
  listOutages,
  restoreOutage,
  type GiopOutage,
} from '../api/giop-api';

interface GiopOutagesTabProps {
  isLightMode: boolean;
}

export function GiopOutagesTab({ isLightMode }: GiopOutagesTabProps) {
  const [outages, setOutages] = useState<GiopOutage[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [affectedArea, setAffectedArea] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOutages(await listOutages());
    } catch {
      setOutages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const card = isLightMode ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-900/40';

  return (
    <div className="h-full overflow-auto p-6">
      <h3 className={`text-sm font-semibold mb-4 ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>
        Outage Visibility
      </h3>
      <div className={`rounded-lg border p-4 mb-6 ${card}`}>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Outage summary"
          className="w-full text-sm rounded border px-2 py-1 mb-2 bg-transparent"
        />
        <input
          value={affectedArea}
          onChange={(e) => setAffectedArea(e.target.value)}
          placeholder="Affected area"
          className="w-full text-sm rounded border px-2 py-1 mb-2 bg-transparent"
        />
        <button
          type="button"
          className="text-xs px-3 py-1.5 bg-amber-700 rounded text-white"
          onClick={async () => {
            if (!summary.trim()) return;
            try {
              await createOutage({
                summary,
                affected_area: affectedArea,
                customers_affected: 100,
                is_published: true,
                create_ticket: true,
              });
              setSummary('');
              setAffectedArea('');
              setStatus('Outage published');
              await load();
            } catch (err) {
              setStatus(err instanceof Error ? err.message : 'Create failed');
            }
          }}
        >
          Publish outage
        </button>
      </div>
      {status && <p className="text-xs text-slate-500 mb-2">{status}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      <div className="space-y-3">
        {outages.map((o) => (
          <div key={o.id} className={`rounded-lg border p-3 text-sm ${card}`}>
            <div className="flex justify-between gap-2">
              <span className="font-mono text-xs">{o.reference}</span>
              <span className={`text-xs ${o.status === 'ACTIVE' ? 'text-red-400' : 'text-green-400'}`}>
                {o.status}
              </span>
            </div>
            <p className="mt-1">{o.summary}</p>
            <p className="text-xs text-slate-500 mt-1">
              {o.affected_area ?? '—'} · {o.customers_affected} customers
              {o.is_published ? ' · published' : ''}
            </p>
            {o.status !== 'RESTORED' && o.status !== 'CANCELLED' && (
              <button
                type="button"
                className="text-xs px-2 py-1 mt-2 bg-green-800 rounded text-white"
                onClick={async () => {
                  try {
                    await restoreOutage(o.id);
                    setStatus(`Outage ${o.reference} restored`);
                    await load();
                  } catch (err) {
                    setStatus(err instanceof Error ? err.message : 'Restore failed');
                  }
                }}
              >
                Mark restored
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
