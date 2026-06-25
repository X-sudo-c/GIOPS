import { useEffect, useRef, useState } from 'react';
import maplibregl from '../lib/maplibreSetup';
import { MARTIN_URL } from '../api/giop-api';
import type { GiopStagingAsset, GiopGraphChunkResponse } from '../api/giop-api';
import { useGiopGraphChunk } from '../hooks/useGiopGraphChunk';
import { chunkToEdgeGeoJson, chunkToNodeGeoJson, chunkToTracedNodeGeoJson } from '../lib/giopChunkGeoJson';
import type { MapBbox } from '../hooks/useGiopGraphChunk';

interface GiopMapViewProps {
  isLightMode?: boolean;
  focusMrid?: string | null;
  focusCoordinates?: [number, number] | null;
  stagingAssets?: GiopStagingAsset[];
  onNodeClick?: (mrid: string, coordinates?: [number, number]) => void;
  onViewportChange?: (bbox: MapBbox, zoom: number) => void;
  refreshToken?: number;
  startMrid?: string;
  streamGraphChunk?: boolean;
  graphChunk?: GiopGraphChunkResponse | null;
  chunkLoadingExternal?: boolean;
  chunkErrorExternal?: string | null;
}

const DEFAULT_CENTER: [number, number] = [-0.2941, 5.6812];
const NODE_DETAIL_ZOOM = 12;

const BASEMAP_LIGHT = ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'];
const BASEMAP_DARK = ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'];

// #region agent log
function debugMapLog(location: string, message: string, data: Record<string, unknown>, hypothesisId: string) {
  fetch('http://127.0.0.1:7771/ingest/c7d2ea3f-61be-4e5f-b77c-bfd46e6a1eff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '207c92' },
    body: JSON.stringify({
      sessionId: '207c92',
      runId: 'post-fix-map-empty',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number; z: number } {
  const z = Math.max(0, Math.round(zoom));
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n),
  };
}

function whenMapStyleReady(map: maplibregl.Map, fn: () => void) {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  const onStyle = () => {
    if (map.isStyleLoaded()) {
      map.off('styledata', onStyle);
      fn();
    }
  };
  map.on('styledata', onStyle);
  map.once('load', fn);
}

function applyMapTheme(map: maplibregl.Map, isLightMode: boolean) {
  const basemap = map.getSource('basemap') as maplibregl.RasterTileSource | undefined;
  if (basemap && typeof basemap.setTiles === 'function') {
    basemap.setTiles(isLightMode ? BASEMAP_LIGHT : BASEMAP_DARK);
  }
  if (map.getLayer('lines')) {
    map.setPaintProperty('lines', 'line-color', isLightMode ? '#2563eb' : '#1D4ED8');
  }
  if (map.getLayer('nodes')) {
    map.setPaintProperty('nodes', 'circle-color', isLightMode ? '#2563eb' : '#3b82f6');
  }
}

export function GiopMapView({
  isLightMode = false,
  focusMrid,
  focusCoordinates,
  stagingAssets = [],
  onNodeClick,
  onViewportChange,
  refreshToken = 0,
  startMrid,
  streamGraphChunk = true,
  graphChunk: graphChunkExternal = null,
  chunkLoadingExternal = false,
  chunkErrorExternal = null,
}: GiopMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const onViewportChangeRef = useRef(onViewportChange);
  const isLightModeRef = useRef(isLightMode);
  const [mapBusy, setMapBusy] = useState(true);
  const [mapZoom, setMapZoom] = useState(11);
  const { chunk: internalChunk, loading: internalLoading, error: internalError, loadBbox } =
    useGiopGraphChunk(startMrid);

  const chunk = streamGraphChunk ? internalChunk : graphChunkExternal;
  const chunkLoading = streamGraphChunk ? internalLoading : chunkLoadingExternal;
  const chunkError = streamGraphChunk ? internalError : chunkErrorExternal;

  onNodeClickRef.current = onNodeClick;
  onViewportChangeRef.current = onViewportChange;
  isLightModeRef.current = isLightMode;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const light = isLightModeRef.current;
    const nodeTileTemplate = `${MARTIN_URL}/connectivity_nodes/{z}/{x}/{y}`;
    const lineTileTemplate = `${MARTIN_URL}/ac_line_segments/{z}/{x}/{y}`;
    const overviewUg33TileTemplate = `${MARTIN_URL}/ug_cable_33kv/{z}/{x}/{y}`;
    const overviewUg11TileTemplate = `${MARTIN_URL}/ug_cable_11kv/{z}/{x}/{y}`;
    const overviewOh33TileTemplate = `${MARTIN_URL}/oh_conductor_33kv/{z}/{x}/{y}`;
    const containerRect = containerRef.current.getBoundingClientRect();
    // #region agent log
    debugMapLog(
      'GiopMapView.tsx:init',
      'map init config',
      {
        martinUrl: MARTIN_URL,
        maplibreWorkerUrl: maplibregl.workerUrl,
        nodeTileTemplate,
        lineTileTemplate,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
        defaultCenter: DEFAULT_CENTER,
        defaultZoom: 11,
        streamGraphChunk,
      },
      'H1-H4',
    );
    // #endregion
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: light ? BASEMAP_LIGHT : BASEMAP_DARK,
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
          overview_ug_cable_33kv: {
            type: 'vector',
            tiles: [overviewUg33TileTemplate],
            minzoom: 0,
            maxzoom: 14,
          },
          overview_ug_cable_11kv: {
            type: 'vector',
            tiles: [overviewUg11TileTemplate],
            minzoom: 0,
            maxzoom: 14,
          },
          overview_oh_conductor_33kv: {
            type: 'vector',
            tiles: [overviewOh33TileTemplate],
            minzoom: 5,
            maxzoom: 14,
          },
          connectivity_nodes: {
            type: 'vector',
            tiles: [nodeTileTemplate],
            minzoom: NODE_DETAIL_ZOOM,
            maxzoom: 14,
          },
          ac_line_segments: {
            type: 'vector',
            tiles: [lineTileTemplate],
            minzoom: NODE_DETAIL_ZOOM,
            maxzoom: 14,
          },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap' },
          {
            id: 'overview-ug-33kv',
            type: 'line',
            source: 'overview_ug_cable_33kv',
            'source-layer': 'ug_cable_33kv',
            maxzoom: NODE_DETAIL_ZOOM,
            paint: {
              'line-color': light ? '#1d4ed8' : '#bfdbfe',
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 7, 0.7, 9, 1, 11, 1.4, 12, 1.8],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 8, 0.75, 10, 0.85, 12, 0.92],
            },
          },
          {
            id: 'overview-ug-11kv',
            type: 'line',
            source: 'overview_ug_cable_11kv',
            'source-layer': 'ug_cable_11kv',
            maxzoom: NODE_DETAIL_ZOOM,
            paint: {
              'line-color': light ? '#2563eb' : '#60a5fa',
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.45, 8, 0.65, 10, 0.95, 12, 1.4],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.55, 8, 0.65, 10, 0.78, 12, 0.88],
            },
          },
          {
            id: 'overview-oh-33kv',
            type: 'line',
            source: 'overview_oh_conductor_33kv',
            'source-layer': 'oh_conductor_33kv',
            minzoom: 5,
            maxzoom: NODE_DETAIL_ZOOM,
            paint: {
              'line-color': light ? '#0ea5e9' : '#67e8f9',
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 7, 0.6, 9, 0.95, 11, 1.4, 12, 1.9],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 8, 0.72, 10, 0.85, 12, 0.92],
            },
          },
          {
            id: 'lines',
            type: 'line',
            source: 'ac_line_segments',
            'source-layer': 'ac_line_segments',
            minzoom: 10,
            paint: {
              'line-color': light ? '#2563eb' : '#60a5fa',
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 11, 1, 12, 1.25, 13, 1.6, 15, 2.5],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 11, 0.68, 14, 0.9],
            },
          },
          {
            id: 'nodes',
            type: 'circle',
            source: 'connectivity_nodes',
            'source-layer': 'connectivity_nodes',
            minzoom: 11.5,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 1.8, 12, 2.5, 13, 3.6, 15, 6.5],
              'circle-color': light ? '#2563eb' : '#3b82f6',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.45, 12, 0.62, 15, 0.9],
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11.5, 0.2, 12, 0.35, 15, 1.2],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.25, 12, 0.4, 15, 0.85],
            },
          },
        ],
      },
      center: DEFAULT_CENTER,
      zoom: 13,
      minZoom: 5,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    // #region agent log
    map.on('error', (event) => {
      debugMapLog(
        'GiopMapView.tsx:map-error',
        'maplibre error',
        { error: String(event.error ?? event), type: (event as { type?: string }).type },
        'H3',
      );
    });
    map.on('sourcedata', (event) => {
      if (
        event.sourceId !== 'connectivity_nodes' &&
        event.sourceId !== 'ac_line_segments' &&
        event.sourceId !== 'overview_oh_conductor_33kv'
      )
        return;
      debugMapLog(
        'GiopMapView.tsx:sourcedata',
        'vector source event',
        {
          sourceId: event.sourceId,
          isSourceLoaded: event.isSourceLoaded,
          dataType: event.dataType,
          tile: event.tile ? String((event.tile as { tileID?: unknown }).tileID) : null,
        },
        'H2-H3',
      );
    });
    // #endregion

    const syncMapState = () => {
      setMapZoom(Number(map.getZoom().toFixed(1)));
    };
    const markMapReady = () => {
      syncMapState();
      setMapBusy(false);
    };

    map.on('movestart', () => setMapBusy(true));
    map.on('zoomstart', () => setMapBusy(true));
    map.on('moveend', markMapReady);
    map.on('zoomend', markMapReady);
    map.on('idle', markMapReady);

    const resizeMap = () => {
      if (mapRef.current) mapRef.current.resize();
    };
    resizeMap();
    requestAnimationFrame(resizeMap);

    const container = containerRef.current;
    const resizeObserver =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => resizeMap())
        : null;
    resizeObserver?.observe(container);

    const bindMartinClicks = () => {
      map.on('click', 'nodes', (e) => {
        const feature = e.features?.[0];
        const mrid = feature?.properties?.mrid as string | undefined;
        if (!mrid) return;
        let coordinates: [number, number] | undefined;
        const geom = feature?.geometry;
        if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
          coordinates = [geom.coordinates[0], geom.coordinates[1]];
        }
        onNodeClickRef.current?.(mrid, coordinates);
      });
      map.on('mouseenter', 'nodes', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'nodes', () => {
        map.getCanvas().style.cursor = '';
      });
    };

    map.once('load', () => {
      bindMartinClicks();
      resizeMap();
      markMapReady();
      // #region agent log
      const center = map.getCenter();
      const tile = lonLatToTile(center.lng, center.lat, map.getZoom());
      const nodeProbeUrl = `${MARTIN_URL}/connectivity_nodes/${tile.z}/${tile.x}/${tile.y}`;
      const lineProbeUrl = `${MARTIN_URL}/ac_line_segments/${tile.z}/${tile.x}/${tile.y}`;
      void Promise.all([
        fetch(nodeProbeUrl).then(async (res) => ({
          url: nodeProbeUrl,
          status: res.status,
          contentType: res.headers.get('content-type'),
          bytes: (await res.arrayBuffer()).byteLength,
        })),
        fetch(lineProbeUrl).then(async (res) => ({
          url: lineProbeUrl,
          status: res.status,
          contentType: res.headers.get('content-type'),
          bytes: (await res.arrayBuffer()).byteLength,
        })),
      ])
        .then((results) => {
          debugMapLog(
            'GiopMapView.tsx:tile-probe',
            'current center tile probe',
            { zoom: map.getZoom(), center: center.toArray(), tile, results },
            'H2',
          );
        })
        .catch((err) => {
          debugMapLog(
            'GiopMapView.tsx:tile-probe',
            'current center tile probe failed',
            { zoom: map.getZoom(), center: center.toArray(), tile, error: String(err) },
            'H2',
          );
        });
      // #endregion
    });

    // #region agent log
    map.on('idle', () => {
      const renderedNodes = map.queryRenderedFeatures({ layers: ['nodes'] });
      const renderedLines = map.queryRenderedFeatures({ layers: ['lines'] });
      const overviewLayerIds = ['overview-ug-33kv', 'overview-ug-11kv', 'overview-oh-33kv'];
      const renderedOverviewFeatures = overviewLayerIds.reduce((count, layerId) => {
        return count + (map.getLayer(layerId) ? map.queryRenderedFeatures({ layers: [layerId] }).length : 0);
      }, 0);
      const renderedOhBackboneFeatures = map.getLayer('overview-oh-33kv')
        ? map.queryRenderedFeatures({ layers: ['overview-oh-33kv'] }).length
        : 0;
      const overviewNodesLayer = map.getLayer('graph-chunk-nodes-layer');
      const overviewLinesLayer = map.getLayer('graph-chunk-edges-layer');
      const renderedOverviewNodes = overviewNodesLayer
        ? map.queryRenderedFeatures({ layers: ['graph-chunk-nodes-layer'] })
        : [];
      const renderedOverviewLines = overviewLinesLayer
        ? map.queryRenderedFeatures({ layers: ['graph-chunk-edges-layer'] })
        : [];
      debugMapLog(
        'GiopMapView.tsx:idle',
        'rendered feature counts',
        {
          zoom: map.getZoom(),
          center: map.getCenter().toArray(),
          loaded: map.loaded(),
          styleLoaded: map.isStyleLoaded(),
          nodesLayerExists: Boolean(map.getLayer('nodes')),
          linesLayerExists: Boolean(map.getLayer('lines')),
          nodesSourceExists: Boolean(map.getSource('connectivity_nodes')),
          linesSourceExists: Boolean(map.getSource('ac_line_segments')),
          renderedNodeCount: renderedNodes.length,
          renderedLineCount: renderedLines.length,
          overviewMartinLayerCount: renderedOverviewFeatures,
          renderedOhBackboneCount: renderedOhBackboneFeatures,
          overviewNodesLayerExists: Boolean(overviewNodesLayer),
          overviewLinesLayerExists: Boolean(overviewLinesLayer),
          renderedOverviewNodeCount: renderedOverviewNodes.length,
          renderedOverviewLineCount: renderedOverviewLines.length,
        },
        'H4-H5',
      );
    });
    const immediateCenter = map.getCenter();
    const immediateTile = lonLatToTile(immediateCenter.lng, immediateCenter.lat, map.getZoom());
    const immediateNodeUrl = `${MARTIN_URL}/connectivity_nodes/${immediateTile.z}/${immediateTile.x}/${immediateTile.y}`;
    const immediateLineUrl = `${MARTIN_URL}/ac_line_segments/${immediateTile.z}/${immediateTile.x}/${immediateTile.y}`;
    void Promise.allSettled([
      fetch(maplibregl.workerUrl).then(async (res) => ({
        kind: 'worker',
        url: maplibregl.workerUrl,
        status: res.status,
        contentType: res.headers.get('content-type'),
        bytes: (await res.arrayBuffer()).byteLength,
      })),
      fetch(immediateNodeUrl).then(async (res) => ({
        kind: 'nodes',
        url: immediateNodeUrl,
        status: res.status,
        contentType: res.headers.get('content-type'),
        bytes: (await res.arrayBuffer()).byteLength,
      })),
      fetch(immediateLineUrl).then(async (res) => ({
        kind: 'lines',
        url: immediateLineUrl,
        status: res.status,
        contentType: res.headers.get('content-type'),
        bytes: (await res.arrayBuffer()).byteLength,
      })),
    ]).then((results) => {
      debugMapLog(
        'GiopMapView.tsx:immediate-probes',
        'worker and current tile probes',
        {
          zoom: map.getZoom(),
          center: immediateCenter.toArray(),
          tile: immediateTile,
          results: results.map((result) =>
            result.status === 'fulfilled'
              ? { status: 'fulfilled', value: result.value }
              : { status: 'rejected', reason: String(result.reason) },
          ),
        },
        'H2-H3',
      );
    });
    window.setTimeout(() => {
      const nodesLayer = map.getLayer('nodes');
      const linesLayer = map.getLayer('lines');
      const overviewLayerIds = ['overview-ug-33kv', 'overview-ug-11kv', 'overview-oh-33kv'];
      const renderedOverviewFeatures = overviewLayerIds.reduce((count, layerId) => {
        return count + (map.getLayer(layerId) ? map.queryRenderedFeatures({ layers: [layerId] }).length : 0);
      }, 0);
      const renderedOhBackboneFeatures = map.getLayer('overview-oh-33kv')
        ? map.queryRenderedFeatures({ layers: ['overview-oh-33kv'] }).length
        : 0;
      const overviewNodesLayer = map.getLayer('graph-chunk-nodes-layer');
      const overviewLinesLayer = map.getLayer('graph-chunk-edges-layer');
      const renderedNodes = nodesLayer ? map.queryRenderedFeatures({ layers: ['nodes'] }) : [];
      const renderedLines = linesLayer ? map.queryRenderedFeatures({ layers: ['lines'] }) : [];
      const renderedOverviewNodes = overviewNodesLayer
        ? map.queryRenderedFeatures({ layers: ['graph-chunk-nodes-layer'] })
        : [];
      const renderedOverviewLines = overviewLinesLayer
        ? map.queryRenderedFeatures({ layers: ['graph-chunk-edges-layer'] })
        : [];
      debugMapLog(
        'GiopMapView.tsx:delayed-snapshot',
        'map snapshot after startup delay',
        {
          zoom: map.getZoom(),
          center: map.getCenter().toArray(),
          loaded: map.loaded(),
          styleLoaded: map.isStyleLoaded(),
          nodesLayerExists: Boolean(nodesLayer),
          linesLayerExists: Boolean(linesLayer),
          nodesSourceExists: Boolean(map.getSource('connectivity_nodes')),
          linesSourceExists: Boolean(map.getSource('ac_line_segments')),
          renderedNodeCount: renderedNodes.length,
          renderedLineCount: renderedLines.length,
          overviewMartinLayerCount: renderedOverviewFeatures,
          renderedOhBackboneCount: renderedOhBackboneFeatures,
          overviewNodesLayerExists: Boolean(overviewNodesLayer),
          overviewLinesLayerExists: Boolean(overviewLinesLayer),
          renderedOverviewNodeCount: renderedOverviewNodes.length,
          renderedOverviewLineCount: renderedOverviewLines.length,
        },
        'H3-H5',
      );
    }, 7000);
    // #endregion

    return () => {
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      applyMapTheme(map, isLightMode);
    } else {
      map.once('load', () => applyMapTheme(map, isLightMode));
    }
  }, [isLightMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const emitViewport = () => {
      const bounds = map.getBounds();
      const bbox: MapBbox = {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      };
      const zoom = map.getZoom();
      onViewportChangeRef.current?.(bbox, zoom);
      if (streamGraphChunk) {
        void loadBbox(bbox, zoom);
      }
    };

    let debounceTimer: number | undefined;
    const scheduleSync = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(emitViewport, 250);
    };

    map.on('load', emitViewport);
    const onStyleReady = () => {
      if (map.isStyleLoaded()) emitViewport();
    };
    map.on('styledata', onStyleReady);
    window.setTimeout(onStyleReady, 300);
    map.on('moveend', scheduleSync);
    map.on('zoomend', scheduleSync);

    return () => {
      window.clearTimeout(debounceTimer);
      map.off('load', emitViewport);
      map.off('styledata', onStyleReady);
      map.off('moveend', scheduleSync);
      map.off('zoomend', scheduleSync);
    };
  }, [loadBbox, streamGraphChunk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || refreshToken === 0) return;

    const v = Date.now();
    for (const id of ['connectivity_nodes', 'ac_line_segments']) {
      const src = map.getSource(id) as maplibregl.VectorTileSource | undefined;
      if (src && typeof src.setTiles === 'function') {
        src.setTiles([`${MARTIN_URL}/${id}/{z}/{x}/{y}?v=${v}`]);
      }
    }
    map.triggerRepaint();
  }, [refreshToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !streamGraphChunk) return;

    const applyChunkLayers = () => {
      const edgeData = chunkToEdgeGeoJson(chunk);
      const nodeData = chunkToNodeGeoJson(chunk);
      const tracedData = chunkToTracedNodeGeoJson(chunk);
      const edgeSourceId = 'graph-chunk-edges';
      const nodeSourceId = 'graph-chunk-nodes';
      const tracedSourceId = 'graph-chunk-traced';

      if (map.getSource(nodeSourceId)) {
        (map.getSource(nodeSourceId) as maplibregl.GeoJSONSource).setData(nodeData);
      } else if (nodeData.features.length > 0) {
        map.addSource(nodeSourceId, { type: 'geojson', data: nodeData });
        map.addLayer(
          {
            id: 'graph-chunk-nodes-layer',
            type: 'circle',
            source: nodeSourceId,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 8, 1.8, 12, 3.5, 14, 6, 18, 10],
              'circle-color': [
                'case',
                ['boolean', ['get', 'traced'], false],
                '#f97316',
                ['boolean', ['get', 'connected'], false],
                isLightModeRef.current ? '#2563eb' : '#3b82f6',
                isLightModeRef.current ? '#64748b' : '#94a3b8',
              ],
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.4, 14, 1, 18, 1.6],
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.65, 14, 0.85],
            },
          },
          'nodes',
        );
        map.on('click', 'graph-chunk-nodes-layer', (e) => {
          const f = e.features?.[0];
          const mrid = f?.properties?.mrid as string | undefined;
          const coords = (f?.geometry as { coordinates?: [number, number] })?.coordinates;
          if (mrid) onNodeClickRef.current?.(mrid, coords);
        });
        map.on('mouseenter', 'graph-chunk-nodes-layer', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'graph-chunk-nodes-layer', () => {
          map.getCanvas().style.cursor = '';
        });
      }

      if (map.getSource(edgeSourceId)) {
        (map.getSource(edgeSourceId) as maplibregl.GeoJSONSource).setData(edgeData);
      } else {
        map.addSource(edgeSourceId, { type: 'geojson', data: edgeData });
        map.addLayer(
          {
            id: 'graph-chunk-edges-layer',
            type: 'line',
            source: edgeSourceId,
            paint: {
              'line-color': ['coalesce', ['get', 'color'], '#475569'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 8, 0.8, 12, 1.5, 15, 2.5],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.45, 8, 0.55, 13, 0.9],
            },
          },
          'nodes',
        );
      }

      if (map.getSource(tracedSourceId)) {
        (map.getSource(tracedSourceId) as maplibregl.GeoJSONSource).setData(tracedData);
      } else if (tracedData.features.length > 0) {
        map.addSource(tracedSourceId, { type: 'geojson', data: tracedData });
        map.addLayer({
          id: 'graph-chunk-traced-layer',
          type: 'circle',
          source: tracedSourceId,
          paint: {
            'circle-radius': 11,
            'circle-color': '#f97316',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      applyChunkLayers();
    } else {
      whenMapStyleReady(map, applyChunkLayers);
    }
  }, [chunk, streamGraphChunk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const geojson = {
      type: 'FeatureCollection' as const,
      features: stagingAssets
        .filter((a) => a.geom?.coordinates)
        .map((a) => ({
          type: 'Feature' as const,
          properties: { mrid: a.mrid, name: a.name || a.mrid },
          geometry: {
            type: 'Point' as const,
            coordinates: a.geom!.coordinates,
          },
        })),
    };

    const sourceId = 'staging-overlay';
    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'staging-points',
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 10,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
      map.on('click', 'staging-points', (e) => {
        const f = e.features?.[0];
        const mrid = f?.properties?.mrid as string | undefined;
        const coords = (f?.geometry as { coordinates?: [number, number] })?.coordinates;
        if (mrid && onNodeClickRef.current) onNodeClickRef.current(mrid, coords);
      });
      map.on('mouseenter', 'staging-points', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'staging-points', () => {
        map.getCanvas().style.cursor = '';
      });
    }
  }, [stagingAssets]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusCoordinates) return;
    map.flyTo({ center: focusCoordinates, zoom: 14, duration: 800 });
  }, [focusMrid, focusCoordinates]);

  return (
    <div className="giop-map-host">
      <div ref={containerRef} className="absolute inset-0" />
      <div
        className={`pointer-events-none absolute right-3 top-3 z-10 rounded-md border px-3 py-2 text-xs shadow-lg ${
          isLightMode
            ? 'border-slate-200 bg-white/90 text-slate-700'
            : 'border-slate-700 bg-slate-900/90 text-slate-200'
        }`}
      >
        {mapBusy ? 'Loading map…' : `Zoom ${mapZoom.toFixed(1)}`}
        {mapZoom < NODE_DETAIL_ZOOM ? ' · lines shown, zoom in for nodes' : ''}
      </div>
      {streamGraphChunk && (chunk || chunkLoading || chunkError) && (
        <div
          className={`pointer-events-none absolute left-3 top-3 z-10 rounded-md border px-3 py-2 text-xs shadow-lg ${
            isLightMode
              ? 'border-slate-200 bg-white/90 text-slate-700'
              : 'border-slate-700 bg-slate-900/90 text-slate-200'
          }`}
        >
          {chunkLoading && <span>Loading viewport…</span>}
          {!chunkLoading && chunkError && <span className="text-red-400">{chunkError}</span>}
          {!chunkLoading && !chunkError && chunk && (
            <span>
              Viewport: {chunk.nodes.length.toLocaleString()} nodes, {chunk.edges.length.toLocaleString()} lines
              {chunk.truncated ? ` · nodes capped at ${chunk.limit}` : ''}
              {chunk.edges_truncated ? ` · lines capped at ${chunk.edge_limit ?? 5000}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
