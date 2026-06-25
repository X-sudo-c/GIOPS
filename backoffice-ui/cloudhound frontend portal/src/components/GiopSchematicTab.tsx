import { useEffect, useState } from 'react';
import { generateSchematic } from '../api/giop-api';
import { useGiopSelection } from '../context/GiopSelectionContext';
import { DEFAULT_START_MRID } from '../api/giop-api';

interface GiopSchematicTabProps {
  isLightMode: boolean;
  startMrid?: string;
}

export function GiopSchematicTab({ isLightMode, startMrid }: GiopSchematicTabProps) {
  const { selection } = useGiopSelection();
  const mrid = selection.mrid || startMrid || DEFAULT_START_MRID;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mrid) return;
    setLoading(true);
    setError(null);
    void generateSchematic(mrid)
      .then(setSvg)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load schematic');
        setSvg(null);
      })
      .finally(() => setLoading(false));
  }, [mrid]);

  return (
    <div className="h-full flex flex-col min-h-0 p-4">
      <p className={`text-xs mb-2 ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
        Engineering schematic for <span className="font-mono">{mrid}</span>
      </p>
      {loading && <p className="text-sm text-slate-500">Generating SVG…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {svg && (
        <div
          className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-700 bg-slate-950"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
