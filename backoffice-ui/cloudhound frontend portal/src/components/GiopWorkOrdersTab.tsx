import { useCallback, useEffect, useState } from 'react';
import {
  createWorkOrder,
  listWorkOrders,
  patchWorkOrder,
  type GiopWorkOrder,
} from '../api/giop-api';

interface GiopWorkOrdersTabProps {
  isLightMode: boolean;
}

export function GiopWorkOrdersTab({ isLightMode }: GiopWorkOrdersTabProps) {
  const [orders, setOrders] = useState<GiopWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await listWorkOrders());
    } catch {
      setOrders([]);
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
        Work Order Dispatch
      </h3>
      <div className={`rounded-lg border p-4 mb-6 ${card}`}>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Work order summary"
          className="w-full text-sm rounded border px-2 py-1 mb-2 bg-transparent"
        />
        <button
          type="button"
          className="text-xs px-3 py-1.5 bg-emerald-700 rounded text-white"
          onClick={async () => {
            if (!summary.trim()) return;
            try {
              await createWorkOrder({
                summary,
                work_type: 'MAINTENANCE',
                assigned_user: 'tech.demo',
                assigned_crew: 'CREW-DEMO',
              });
              setSummary('');
              setStatus('Work order dispatched');
              await load();
            } catch (err) {
              setStatus(err instanceof Error ? err.message : 'Dispatch failed');
            }
          }}
        >
          Dispatch
        </button>
      </div>
      {status && <p className="text-xs text-slate-500 mb-2">{status}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      <div className="space-y-3">
        {orders.map((wo) => (
          <div key={wo.id} className={`rounded-lg border p-3 text-sm ${card}`}>
            <div className="flex justify-between gap-2">
              <span className="font-mono text-xs">{wo.reference}</span>
              <span className="text-xs text-emerald-400">{wo.status}</span>
            </div>
            <p className="mt-1">{wo.summary}</p>
            <p className="text-xs text-slate-500 mt-1">
              {wo.work_type} · crew {wo.assigned_crew ?? '—'} · {wo.assigned_user ?? 'unassigned'}
            </p>
            {wo.status === 'DISPATCHED' && (
              <button
                type="button"
                className="text-xs px-2 py-1 mt-2 bg-slate-700 rounded text-white"
                onClick={async () => {
                  try {
                    await patchWorkOrder(wo.id, { status: 'ACCEPTED' });
                    await load();
                  } catch (err) {
                    setStatus(err instanceof Error ? err.message : 'Update failed');
                  }
                }}
              >
                Mark accepted
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
