import { useCallback, useEffect, useMemo, useState } from 'react';
import { PortalShell } from './PortalShell';
import { GiopTopologyTab } from './GiopTopologyTab';
import { GiopMapView } from './GiopMapView';
import { GiopSplitView } from './GiopSplitView';
import { GiopOperationsTab } from './GiopOperationsTab';
import { GiopMeterOcr } from './GiopMeterOcr';
import { GiopInsightsTab } from './GiopInsightsTab';
import { GiopSchematicTab } from './GiopSchematicTab';
import { GiopDlqTab } from './GiopDlqTab';
import { GiopApmWidget } from './GiopApmWidget';
import { GiopCasesTab } from './GiopCasesTab';
import { GiopTicketsTab } from './GiopTicketsTab';
import { GiopWorkOrdersTab } from './GiopWorkOrdersTab';
import { GiopOutagesTab } from './GiopOutagesTab';
import { GiopReportsTab } from './GiopReportsTab';
import { GiopSelectionProvider, useGiopSelection } from '../context/GiopSelectionContext';
import { useGiopTopology } from '../hooks/useGiopTopology';
import { useGiopRealtime } from '../hooks/useGiopRealtime';
import { DEFAULT_START_MRID } from '../api/giop-api';
import {
  readGiopRouteFromLocation,
  subscribeToGiopRouteChanges,
  writeGiopRouteToLocation,
  type GiopPortalTab,
} from '../lib/giopPortalRouting';
import type { GiopGraphQueryKey } from '../lib/giopGraphTypes';
import type { PortalNavGroup } from './PortalShell';

const NAV_GROUPS: PortalNavGroup[] = [
  {
    label: 'Grid',
    items: [
      { id: 'map', label: 'Map' },
      { id: 'topology', label: 'Topology' },
      { id: 'combined', label: 'Map + Topology' },
      { id: 'schematic', label: 'Schematic' },
    ],
  },
  {
    label: 'Assets & data',
    items: [
      { id: 'operations', label: 'Operations' },
      { id: 'insights', label: 'Energy insights' },
      { id: 'ocr', label: 'Meter OCR' },
      { id: 'dlq', label: 'DLQ' },
    ],
  },
  {
    label: 'Service desk',
    items: [
      { id: 'cases', label: 'Cases' },
      { id: 'tickets', label: 'Tickets' },
      { id: 'work-orders', label: 'Work orders' },
      { id: 'outages', label: 'Outages' },
      { id: 'reports', label: 'Reports' },
    ],
  },
];

const TAB_META: Record<GiopPortalTab, { title: string; subtitle: string }> = {
  operations: {
    title: 'Grid Operations',
    subtitle: 'Staging assets, validation, and topology repair',
  },
  map: {
    title: 'Network Map',
    subtitle: 'Geospatial view of connectivity nodes and line segments',
  },
  topology: {
    title: 'Network Topology',
    subtitle: 'Memgraph trace visualization from sync-service',
  },
  combined: {
    title: 'Map + Topology',
    subtitle: 'Correlate geography with connectivity graph structure',
  },
  schematic: {
    title: 'Engineering Schematic',
    subtitle: 'SVG one-line diagram from traced topology',
  },
  insights: {
    title: 'Energy Insights',
    subtitle: 'Feeder energy balance and loss-zone anomalies',
  },
  dlq: {
    title: 'Integration DLQ',
    subtitle: 'Review, retry, or discard failed integration payloads',
  },
  ocr: {
    title: 'Meter OCR',
    subtitle: 'Extract readings and submit telemetry',
  },
  cases: {
    title: 'Contact Centre',
    subtitle: 'Customer case intake and conversion',
  },
  tickets: {
    title: 'Trouble Tickets',
    subtitle: 'Incident tracking and assignment',
  },
  'work-orders': {
    title: 'Work Orders',
    subtitle: 'Field dispatch and crew assignment',
  },
  outages: {
    title: 'Outages',
    subtitle: 'Planned and unplanned outage visibility',
  },
  reports: {
    title: 'Regulatory Reports',
    subtitle: 'SAIDI, SAIFI, CAIDI reliability metrics',
  },
};

const THEME_STORAGE_KEY = 'giop.portal.theme.v1';

function readSavedTheme(): boolean {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light') return true;
    if (raw === 'dark') return false;
  } catch {
    /* ignore */
  }
  return false;
}

function GiopPortalInner() {
  const [route, setRoute] = useState(readGiopRouteFromLocation);
  const [isLightMode, setIsLightMode] = useState(readSavedTheme);
  const [mapRefreshToken, setMapRefreshToken] = useState(0);
  const [opsRefreshToken, setOpsRefreshToken] = useState(0);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'loading' | 'live'>('idle');

  const startMrid = route.startMrid || DEFAULT_START_MRID;
  const { selection, setSelection } = useGiopSelection();

  const {
    graph,
    staging,
    graphQuery,
    loading,
    error,
    refresh,
    applyQuery,
  } = useGiopTopology(startMrid);

  useEffect(() => {
    return subscribeToGiopRouteChanges(() => setRoute(readGiopRouteFromLocation()));
  }, []);

  useEffect(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    if (!path || path === '/') {
      writeGiopRouteToLocation({ tab: 'operations' }, true);
    }
  }, []);

  useEffect(() => {
    if (route.tab === 'combined' && graphQuery !== 'viewport_subgraph' && graphQuery !== 'traced_subgraph') {
      applyQuery('viewport_subgraph');
    }
  }, [route.tab, graphQuery, applyQuery]);

  useEffect(() => {
    if (route.graphQuery && route.graphQuery !== graphQuery) {
      applyQuery(route.graphQuery as GiopGraphQueryKey);
    }
  }, [route.graphQuery, graphQuery, applyQuery]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isLightMode ? 'light' : 'dark');
    } catch {
      /* ignore */
    }
  }, [isLightMode]);

  const goToTab = useCallback(
    (tab: GiopPortalTab) => {
      writeGiopRouteToLocation({
        tab,
        startMrid,
        graphQuery,
        focusMrid: selection.mrid || undefined,
      });
    },
    [graphQuery, selection.mrid, startMrid],
  );

  const onQueryChange = useCallback(
    (key: GiopGraphQueryKey) => {
      applyQuery(key);
      writeGiopRouteToLocation(
        {
          tab: route.tab,
          startMrid,
          graphQuery: key,
          focusMrid: selection.mrid || undefined,
        },
        true,
      );
    },
    [applyQuery, route.tab, selection.mrid, startMrid],
  );

  const refreshTopology = useCallback(async () => {
    setLiveStatus('loading');
    await refresh();
    setLiveStatus('live');
  }, [refresh]);

  const refreshMap = useCallback(() => {
    setMapRefreshToken((t) => t + 1);
  }, []);

  useGiopRealtime({
    onStagingChange: () => {
      setOpsRefreshToken((t) => t + 1);
      void refreshTopology();
    },
    onMasterChange: () => {
      setOpsRefreshToken((t) => t + 1);
      refreshMap();
      setTimeout(() => void refreshTopology(), 1200);
    },
  });

  const focusCoordinates = useMemo(() => {
    if (selection.coordinates) return selection.coordinates;
    const asset = staging.find((a) => a.mrid === selection.mrid);
    return asset?.geom?.coordinates ?? null;
  }, [selection.coordinates, selection.mrid, staging]);

  const handleGraphNodeSelect = useCallback(
    (mrid: string, label?: string) => {
      setSelection(mrid, { name: label, source: 'graph' });
      writeGiopRouteToLocation(
        { tab: route.tab, startMrid, graphQuery, focusMrid: mrid },
        true,
      );
    },
    [graphQuery, route.tab, setSelection, startMrid],
  );

  const clearFocus = useCallback(() => {
    writeGiopRouteToLocation(
      { tab: route.tab, startMrid, graphQuery, focusMrid: undefined },
      true,
    );
  }, [graphQuery, route.tab, startMrid]);

  const statusSlot = (
    <div className="flex items-center gap-3">
      <GiopApmWidget isLightMode={isLightMode} />
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            liveStatus === 'live' ? 'bg-cyan-400' : liveStatus === 'loading' ? 'bg-yellow-400 animate-pulse' : 'bg-slate-500'
          }`}
        />
        <span className={isLightMode ? 'text-slate-600' : 'text-slate-400'}>
          {liveStatus === 'live' ? 'Live' : liveStatus === 'loading' ? 'Updating…' : 'Idle'}
        </span>
      </div>
    </div>
  );

  const meta = TAB_META[route.tab];

  return (
    <PortalShell
      activeTab={route.tab}
      onTabChange={goToTab}
      isLightMode={isLightMode}
      onToggleTheme={() => setIsLightMode((m) => !m)}
      title={meta.title}
      subtitle={meta.subtitle}
      statusSlot={statusSlot}
      navGroups={NAV_GROUPS}
      footerLink={{ href: 'http://localhost:8080', label: 'Legacy UI ↗' }}
    >
      {route.tab === 'operations' && (
        <GiopOperationsTab
          isLightMode={isLightMode}
          onRefreshTopology={() => void refreshTopology()}
          onMapRefresh={refreshMap}
          refreshToken={opsRefreshToken}
        />
      )}

      {route.tab === 'map' && (
        <div className="h-full min-h-0 flex flex-col">
          <GiopMapView
            isLightMode={isLightMode}
            focusMrid={selection.mrid}
            focusCoordinates={focusCoordinates}
            stagingAssets={staging}
            refreshToken={mapRefreshToken}
            startMrid={startMrid}
            streamGraphChunk={false}
            onNodeClick={(mrid, coordinates) =>
              setSelection(mrid, { coordinates: coordinates ?? null, source: 'map' })
            }
          />
        </div>
      )}

      {route.tab === 'topology' && (
        <GiopTopologyTab
          graph={graph}
          loading={loading}
          error={error}
          graphQuery={(route.graphQuery as GiopGraphQueryKey) || graphQuery}
          onQueryChange={onQueryChange}
          isLightMode={isLightMode}
          focusMrid={selection.mrid || route.focusMrid}
          onFocusHandled={clearFocus}
          onNodeSelect={handleGraphNodeSelect}
        />
      )}

      {route.tab === 'combined' && (
        <GiopSplitView
          graph={graph}
          loading={loading}
          error={error}
          graphQuery={(route.graphQuery as GiopGraphQueryKey) || graphQuery}
          onQueryChange={onQueryChange}
          isLightMode={isLightMode}
          focusMrid={selection.mrid || route.focusMrid}
          onFocusHandled={clearFocus}
          onGraphNodeSelect={handleGraphNodeSelect}
          focusCoordinates={focusCoordinates}
          stagingAssets={staging}
          mapRefreshToken={mapRefreshToken}
          startMrid={startMrid}
          onMapNodeClick={(mrid, coordinates) =>
            setSelection(mrid, { coordinates: coordinates ?? null, source: 'map' })
          }
        />
      )}

      {route.tab === 'schematic' && (
        <GiopSchematicTab isLightMode={isLightMode} startMrid={startMrid} />
      )}

      {route.tab === 'insights' && <GiopInsightsTab isLightMode={isLightMode} />}

      {route.tab === 'dlq' && <GiopDlqTab isLightMode={isLightMode} />}

      {route.tab === 'ocr' && <GiopMeterOcr isLightMode={isLightMode} />}

      {route.tab === 'cases' && <GiopCasesTab isLightMode={isLightMode} />}

      {route.tab === 'tickets' && <GiopTicketsTab isLightMode={isLightMode} />}

      {route.tab === 'work-orders' && <GiopWorkOrdersTab isLightMode={isLightMode} />}

      {route.tab === 'outages' && <GiopOutagesTab isLightMode={isLightMode} />}

      {route.tab === 'reports' && <GiopReportsTab isLightMode={isLightMode} />}
    </PortalShell>
  );
}

export function GiopPortal() {
  return (
    <GiopSelectionProvider>
      <GiopPortalInner />
    </GiopSelectionProvider>
  );
}
