import { useEffect, useState } from 'react';
import { getLineage, type GiopLineageEvent } from '../api/giop-api';

interface GiopLineageTimelineProps {
  assetMrid: string | null | undefined;
  isLightMode: boolean;
}

export function GiopLineageTimeline({ assetMrid, isLightMode }: GiopLineageTimelineProps) {
  const [events, setEvents] = useState<GiopLineageEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetMrid) {
      setEvents([]);
      return;
    }
    setLoading(true);
    void getLineage(assetMrid, 20)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [assetMrid]);

  if (!assetMrid) return null;

  return (
    <div className={`mt-4 rounded-lg border p-3 ${isLightMode ? 'border-slate-200 bg-slate-50' : 'border-slate-700 bg-slate-900/50'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
        Lineage
      </p>
      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      {!loading && events.length === 0 && (
        <p className="text-xs text-slate-500">No lineage events for this asset.</p>
      )}
      <ul className="space-y-2 max-h-40 overflow-auto">
        {events.map((ev) => (
          <li key={ev.id} className="text-xs border-l-2 border-cyan-600 pl-2">
            <span className="font-medium">{ev.action_type}</span>
            <span className={`ml-2 ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
              {ev.source_type}
            </span>
            {ev.created_at && (
              <p className={`${isLightMode ? 'text-slate-500' : 'text-slate-500'}`}>
                {new Date(ev.created_at).toLocaleString()}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
