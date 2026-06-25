import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_START_MRID, getStagingAssets, getTrace } from '../api/giop-api';
import type { GiopStagingAsset, GiopTraceResponse } from '../api/giop-api';
import { traceToPortalGraph } from '../lib/giopGraphAdapter';
import type { GiopGraphQueryKey } from '../lib/giopGraphTypes';
import type { PortalGraphResponse } from '../lib/giopGraphTypes';

export interface GiopTopologyState {
  trace: GiopTraceResponse | null;
  staging: GiopStagingAsset[];
  graph: PortalGraphResponse | null;
  loading: boolean;
  error: string | null;
}

function traceScopeForQuery(queryKey: GiopGraphQueryKey): 'traced' | 'full' {
  return queryKey === 'traced_subgraph' ? 'traced' : 'full';
}

export function useGiopTopology(startMrid: string = DEFAULT_START_MRID) {
  const [trace, setTrace] = useState<GiopTraceResponse | null>(null);
  const [staging, setStaging] = useState<GiopStagingAsset[]>([]);
  const [graphQuery, setGraphQuery] = useState<GiopGraphQueryKey>('traced_subgraph');
  const [graph, setGraph] = useState<PortalGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [traceScope, setTraceScope] = useState<'traced' | 'full'>('traced');

  const rebuildGraph = useCallback(
    (traceData: GiopTraceResponse, stagingData: GiopStagingAsset[], queryKey: GiopGraphQueryKey) => {
      setGraph(traceToPortalGraph(traceData, stagingData, queryKey));
    },
    [],
  );

  const refresh = useCallback(
    async (queryKey: GiopGraphQueryKey = graphQuery) => {
      const scope = traceScopeForQuery(queryKey);
      setLoading(true);
      setError(null);
      try {
        const [traceData, stagingData] = await Promise.all([
          getTrace(startMrid, scope),
          getStagingAssets().catch(() => [] as GiopStagingAsset[]),
        ]);
        setTrace(traceData);
        setStaging(stagingData);
        setTraceScope(scope);
        setGraph(traceToPortalGraph(traceData, stagingData, queryKey));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topology');
        setTrace(null);
        setGraph(null);
      } finally {
        setLoading(false);
      }
    },
    [startMrid, graphQuery],
  );

  useEffect(() => {
    void refresh(graphQuery);
  }, [startMrid]);

  const applyQuery = useCallback(
    (queryKey: GiopGraphQueryKey) => {
      setGraphQuery(queryKey);
      const nextScope = traceScopeForQuery(queryKey);
      if (trace && nextScope === traceScope) {
        rebuildGraph(trace, staging, queryKey);
        return;
      }
      void refresh(queryKey);
    },
    [trace, traceScope, staging, rebuildGraph, refresh],
  );

  return {
    trace,
    staging,
    graph,
    graphQuery,
    loading,
    error,
    refresh: () => refresh(graphQuery),
    applyQuery,
    setGraphQuery,
  };
}
