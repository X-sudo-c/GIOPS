import { useEffect, useMemo, useState } from 'react';
import {
  getMapPlacesIndex,
  type GiopFieldTechnician,
  type GiopMapSearchResult,
  type GiopStagingAsset,
  type GiopWorkOrder,
} from '../api/giop-api';
import { buildLocalMapSearchCatalog } from '../lib/giopMapLocalSearch';

let cachedPlaces: GiopMapSearchResult[] | null = null;
let placesPromise: Promise<GiopMapSearchResult[]> | null = null;

function loadPlacesIndex(): Promise<GiopMapSearchResult[]> {
  if (cachedPlaces) return Promise.resolve(cachedPlaces);
  if (!placesPromise) {
    placesPromise = getMapPlacesIndex()
      .then((places) => {
        cachedPlaces = places;
        return places;
      })
      .catch(() => {
        placesPromise = null;
        return [] as GiopMapSearchResult[];
      });
  }
  return placesPromise;
}

export function useGiopMapSearchCatalog(options: {
  workOrders?: GiopWorkOrder[];
  fieldTechnicians?: GiopFieldTechnician[];
  stagingAssets?: GiopStagingAsset[];
}) {
  const [places, setPlaces] = useState<GiopMapSearchResult[]>(cachedPlaces ?? []);
  const [placesReady, setPlacesReady] = useState(Boolean(cachedPlaces?.length));

  useEffect(() => {
    let cancelled = false;
    void loadPlacesIndex().then((loaded) => {
      if (cancelled) return;
      setPlaces(loaded);
      setPlacesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog = useMemo(
    () =>
      buildLocalMapSearchCatalog({
        places,
        workOrders: options.workOrders,
        fieldTechnicians: options.fieldTechnicians,
        stagingAssets: options.stagingAssets,
      }),
    [places, options.workOrders, options.fieldTechnicians, options.stagingAssets],
  );

  return { catalog, placesReady };
}
