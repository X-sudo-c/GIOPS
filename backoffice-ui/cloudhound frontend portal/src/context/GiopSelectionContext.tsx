import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type SelectionSource = 'map' | 'graph' | 'table' | null;

export interface GiopSelection {
  mrid: string | null;
  name?: string;
  coordinates?: [number, number] | null;
  source: SelectionSource;
}

interface GiopSelectionContextValue {
  selection: GiopSelection;
  setSelection: (
    mrid: string | null,
    opts?: { name?: string; coordinates?: [number, number] | null; source?: SelectionSource },
  ) => void;
  clearSelection: () => void;
}

const GiopSelectionContext = createContext<GiopSelectionContextValue | null>(null);

export function GiopSelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelectionState] = useState<GiopSelection>({
    mrid: null,
    source: null,
  });

  const setSelection = useCallback(
    (
      mrid: string | null,
      opts?: { name?: string; coordinates?: [number, number] | null; source?: SelectionSource },
    ) => {
      setSelectionState({
        mrid,
        name: opts?.name,
        coordinates: opts?.coordinates ?? null,
        source: opts?.source ?? null,
      });
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectionState({ mrid: null, source: null });
  }, []);

  const value = useMemo(
    () => ({ selection, setSelection, clearSelection }),
    [selection, setSelection, clearSelection],
  );

  return <GiopSelectionContext.Provider value={value}>{children}</GiopSelectionContext.Provider>;
}

export function useGiopSelection() {
  const ctx = useContext(GiopSelectionContext);
  if (!ctx) throw new Error('useGiopSelection must be used within GiopSelectionProvider');
  return ctx;
}
