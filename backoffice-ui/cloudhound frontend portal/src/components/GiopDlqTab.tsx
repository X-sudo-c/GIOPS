import { useCallback, useEffect, useState } from 'react';
import { discardDlq, listDlq, retryDlq, type GiopDlqItem } from '../api/giop-api';

interface GiopDlqTabProps {
  isLightMode: boolean;
}

export function GiopDlqTab({ isLightMode }: GiopDlqTabProps) {
  const [items, setItems] = useState<GiopDlqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listDlq('OPEN'));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = async (id: string) => {
    setStatus('Retrying…');
    try {
      await retryDlq(id);
      setStatus('Retried');
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  const handleDiscard = async (id: string) => {
    try {
      await discardDlq(id);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Discard failed');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h3 className={`text-sm font-semibold mb-4 ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>
        Integration DLQ
      </h3>
      {status && <p className="text-xs text-slate-500 mb-2">{status}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-500">No open DLQ items.</p>
      )}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border p-3 text-sm ${isLightMode ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-900/40'}`}
          >
            <div className="flex justify-between gap-2">
              <span className="font-mono text-xs">{item.source}</span>
              <span className="text-xs text-slate-500">retries {item.retry_count}</span>
            </div>
            <p className="text-xs text-red-400 mt-1">{item.error_message}</p>
            <pre className="text-xs mt-2 overflow-auto max-h-24 opacity-70">
              {JSON.stringify(item.payload, null, 2)}
            </pre>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="text-xs px-2 py-1 bg-emerald-800 rounded text-white"
                onClick={() => void handleRetry(item.id)}
              >
                Retry
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 bg-slate-700 rounded text-white"
                onClick={() => void handleDiscard(item.id)}
              >
                Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
