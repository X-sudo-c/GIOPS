import type {
  GiopFieldTechnician,
  GiopMapSearchKind,
  GiopMapSearchResult,
  GiopStagingAsset,
  GiopWorkOrder,
} from '../api/giop-api';
import { extractStagingGeomCoordinates } from './giopMapCoordinates';

export type GiopMapSearchFilter = 'all' | GiopMapSearchKind;

function rankMatch(title: string, query: string): number {
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return 99;
}

export function searchLocalMapCatalog(
  catalog: GiopMapSearchResult[],
  query: string,
  filter: GiopMapSearchFilter,
  limit = 12,
): GiopMapSearchResult[] {
  const q = query.trim();
  if (q.length < 1) return [];

  const kinds =
    filter === 'all' ? null : new Set<GiopMapSearchKind>([filter]);

  const hits = catalog.filter((item) => {
    if (kinds && !kinds.has(item.kind)) return false;
    const hay = `${item.title} ${item.subtitle ?? ''} ${item.id}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  hits.sort((a, b) => {
    const ra = rankMatch(a.title, q);
    const rb = rankMatch(b.title, q);
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title);
  });

  return hits.slice(0, limit);
}

/** Merge OSM geocode hits without duplicating ECG district names. */
export function mergeGeocodePlaces(
  base: GiopMapSearchResult[],
  geocode: GiopMapSearchResult[],
): GiopMapSearchResult[] {
  if (!geocode.length) return base;
  const seen = new Set(base.map((item) => item.title.trim().toLowerCase()));
  const extra = geocode.filter((item) => {
    const key = item.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return extra.length ? [...base, ...extra] : base;
}

export function buildLocalMapSearchCatalog(options: {
  places: GiopMapSearchResult[];
  workOrders?: GiopWorkOrder[];
  fieldTechnicians?: GiopFieldTechnician[];
  stagingAssets?: GiopStagingAsset[];
}): GiopMapSearchResult[] {
  const out: GiopMapSearchResult[] = [...options.places];

  for (const wo of options.workOrders ?? []) {
    out.push({
      kind: 'work_order',
      id: wo.id,
      title: wo.reference || wo.summary || wo.id,
      subtitle: wo.summary || wo.status,
      longitude: wo.longitude ?? null,
      latitude: wo.latitude ?? null,
    });
  }

  for (const tech of options.fieldTechnicians ?? []) {
    out.push({
      kind: 'crew',
      id: tech.technician_id,
      title: tech.display_name || tech.technician_id,
      subtitle: 'Field technician',
      longitude: tech.longitude,
      latitude: tech.latitude,
    });
  }

  for (const asset of options.stagingAssets ?? []) {
    const coords = extractStagingGeomCoordinates(asset.geom);
    out.push({
      kind: 'asset',
      id: asset.mrid,
      title: asset.name || asset.mrid,
      subtitle: asset.validation || asset.asset_kind || 'Staging asset',
      longitude: coords?.[0] ?? null,
      latitude: coords?.[1] ?? null,
    });
  }

  return out;
}

/** Smooth ease-out curve (Apple-like deceleration). */
export function mapSearchEase(t: number): number {
  return 1 - (1 - t) ** 3;
}
