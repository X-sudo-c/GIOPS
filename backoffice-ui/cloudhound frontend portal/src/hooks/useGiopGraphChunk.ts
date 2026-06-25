import { useCallback, useEffect, useRef, useState } from 'react';
import { getGraphChunk, type GiopGraphChunkResponse } from '../api/giop-api';

export interface MapBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function bboxKey(bbox: MapBbox, zoom: number): string {
  const precision = zoom >= 14 ? 4 : zoom >= 12 ? 3 : 2;
  const round = (n: number) => n.toFixed(precision);
  return `${round(bbox.west)}:${round(bbox.south)}:${round(bbox.east)}:${round(bbox.north)}:${zoom}`;
}

function neighborBboxes(bbox: MapBbox): MapBbox[] {
  const w = bbox.east - bbox.west;
  const h = bbox.north - bbox.south;
  const shifts = [
    { west: -w, east: -w, south: 0, north: 0 },
    { west: w, east: w, south: 0, north: 0 },
    { west: 0, east: 0, south: -h, north: -h },
    { west: 0, east: 0, south: h, north: h },
  ];
  return shifts.map((s) => ({
    west: bbox.west + s.west,
    east: bbox.east + s.east,
    south: bbox.south + s.south,
    north: bbox.north + s.north,
  }));
}

async function fetchChunk(bbox: MapBbox, startMrid?: string): Promise<GiopGraphChunkResponse> {
  return getGraphChunk({
    west: bbox.west,
    south: bbox.south,
    east: bbox.east,
    north: bbox.north,
    startMrid,
  });
}

export function useGiopGraphChunk(startMrid?: string) {
  const [chunk, setChunk] = useState<GiopGraphChunkResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, GiopGraphChunkResponse>>(new Map());
  const requestIdRef = useRef(0);
  const startMridRef = useRef(startMrid);
  startMridRef.current = startMrid;

  const prefetchNeighbors = useCallback((bbox: MapBbox, zoom: number) => {
    const run = () => {
      for (const neighbor of neighborBboxes(bbox)) {
        const key = bboxKey(neighbor, zoom);
        if (cacheRef.current.has(key)) continue;
        void fetchChunk(neighbor, startMridRef.current)
          .then((data) => {
            cacheRef.current.set(key, data);
            if (cacheRef.current.size > 32) {
              const firstKey = cacheRef.current.keys().next().value;
              if (firstKey) cacheRef.current.delete(firstKey);
            }
          })
          .catch(() => undefined);
      }
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run);
    } else {
      setTimeout(run, 100);
    }
  }, []);

  const loadBbox = useCallback(
    async (bbox: MapBbox, zoom: number) => {
      const key = bboxKey(bbox, zoom);
      const cached = cacheRef.current.get(key);
      if (cached) {
        setChunk(cached);
        setError(null);
        prefetchNeighbors(bbox, zoom);
        return;
      }

      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchChunk(bbox, startMridRef.current);
        if (requestId !== requestIdRef.current) return;

        cacheRef.current.set(key, data);
        if (cacheRef.current.size > 32) {
          const firstKey = cacheRef.current.keys().next().value;
          if (firstKey) cacheRef.current.delete(firstKey);
        }
        setChunk(data);
        prefetchNeighbors(bbox, zoom);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load map chunk');
        setChunk(null);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [prefetchNeighbors],
  );

  useEffect(() => {
    cacheRef.current.clear();
    setChunk(null);
  }, [startMrid]);

  return { chunk, loading, error, loadBbox };
}
