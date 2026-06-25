DROP TABLE IF EXISTS gis.asset_id_map;

CREATE TABLE gis.asset_id_map (
  source_layer TEXT NOT NULL,
  source_fid BIGINT NOT NULL,
  source_unique_id TEXT,
  mrid UUID NOT NULL,
  geom GEOMETRY(Point, 4326),
  PRIMARY KEY (source_layer, source_fid)
);

CREATE INDEX idx_gis_asset_id_map_unique_id ON gis.asset_id_map (source_unique_id)
  WHERE source_unique_id IS NOT NULL AND btrim(source_unique_id) <> '';
CREATE INDEX idx_gis_asset_id_map_geom ON gis.asset_id_map USING GIST (geom);

CREATE OR REPLACE FUNCTION gis.as_point(p_geom geometry)
RETURNS geometry(Point, 4326) AS $$
  SELECT CASE GeometryType(ST_Force2D(p_geom))
    WHEN 'POINT' THEN ST_Force2D(p_geom)
    WHEN 'MULTIPOINT' THEN ST_GeometryN(ST_Force2D(p_geom), 1)
    ELSE ST_Centroid(ST_Force2D(p_geom))
  END::geometry(Point, 4326);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION gis.source_asset_key(p_layer TEXT, p_fid BIGINT)
RETURNS TEXT AS $$
  SELECT p_layer || ':fid:' || p_fid::text;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION gis.rebuild_asset_id_map()
RETURNS JSONB AS $$
DECLARE
  v_total BIGINT := 0;
  v_count BIGINT;
BEGIN
  TRUNCATE gis.asset_id_map;

  INSERT INTO gis.asset_id_map (source_layer, source_fid, source_unique_id, mrid, geom)
  SELECT
    'power_transformer',
    fid,
    NULLIF(btrim(unique_id), ''),
    gis.mrid_from_source(gis.source_asset_key('power_transformer', fid)),
    gis.as_point(geom)
  FROM gis.power_transformer
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.asset_id_map (source_layer, source_fid, source_unique_id, mrid, geom)
  SELECT
    'distribution_transformer',
    fid,
    NULLIF(btrim(unique_id), ''),
    gis.mrid_from_source(gis.source_asset_key('distribution_transformer', fid)),
    gis.as_point(geom)
  FROM gis.distribution_transformer
  WHERE geom IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.asset_id_map (source_layer, source_fid, source_unique_id, mrid, geom)
  SELECT layer_name, fid, NULLIF(btrim(unique_id), ''),
    gis.mrid_from_source(gis.source_asset_key(layer_name, fid)),
    gis.as_point(geom)
  FROM (
    SELECT 'oh_support_structure_11kv'::text AS layer_name, fid, unique_id, geom
    FROM gis.oh_support_structure_11kv
    UNION ALL
    SELECT 'oh_support_structure_33kv', fid, unique_id, geom
    FROM gis.oh_support_structure_33kv
    UNION ALL
    SELECT 'oh_support_structure_lvle', fid, unique_id, geom
    FROM gis.oh_support_structure_lvle
  ) poles
  WHERE geom IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  RETURN jsonb_build_object('asset_id_map_rows', v_total);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gis.promote_transformers_to_cim()
RETURNS JSONB AS $$
DECLARE
  v_dist BIGINT;
  v_pwr BIGINT;
BEGIN
  INSERT INTO public.identified_objects (mrid, name, lifecycle_state, validation)
  SELECT
    gis.mrid_from_source(gis.source_asset_key('distribution_transformer', dt.fid)),
    COALESCE(NULLIF(btrim(dt.asset_name), ''), 'DT ' || COALESCE(NULLIF(btrim(dt.unique_id), ''), dt.fid::text)),
    'IN_SERVICE',
    'APPROVED'
  FROM gis.distribution_transformer dt
  WHERE dt.geom IS NOT NULL
  ON CONFLICT (mrid) DO NOTHING;

  INSERT INTO public.connectivity_nodes (mrid, boundary_feeder_id, geom)
  SELECT
    gis.mrid_from_source(gis.source_asset_key('distribution_transformer', dt.fid)),
    NULLIF(btrim(dt.circuit_id), ''),
    gis.as_point(dt.geom)
  FROM gis.distribution_transformer dt
  WHERE dt.geom IS NOT NULL
  ON CONFLICT (mrid) DO NOTHING;

  GET DIAGNOSTICS v_dist = ROW_COUNT;

  INSERT INTO public.ghana_grid_assets (mrid, operating_utility, substation_name)
  SELECT
    gis.mrid_from_source(gis.source_asset_key('distribution_transformer', dt.fid)),
    'ECG_SOUTHERN',
    NULLIF(btrim(dt.district), '')
  FROM gis.distribution_transformer dt
  WHERE dt.geom IS NOT NULL
  ON CONFLICT (mrid) DO NOTHING;

  INSERT INTO public.identified_objects (mrid, name, lifecycle_state, validation)
  SELECT
    gis.mrid_from_source(gis.source_asset_key('power_transformer', pt.fid)),
    COALESCE(NULLIF(btrim(pt.asset_name), ''), 'PT ' || COALESCE(NULLIF(btrim(pt.unique_id), ''), pt.fid::text)),
    'IN_SERVICE',
    'APPROVED'
  FROM gis.power_transformer pt
  WHERE pt.geom IS NOT NULL
  ON CONFLICT (mrid) DO NOTHING;

  INSERT INTO public.connectivity_nodes (mrid, boundary_feeder_id, geom)
  SELECT
    gis.mrid_from_source(gis.source_asset_key('power_transformer', pt.fid)),
    NULLIF(btrim(pt.circuit_id), ''),
    gis.as_point(pt.geom)
  FROM gis.power_transformer pt
  WHERE pt.geom IS NOT NULL
  ON CONFLICT (mrid) DO NOTHING;

  GET DIAGNOSTICS v_pwr = ROW_COUNT;

  INSERT INTO public.ghana_grid_assets (mrid, operating_utility, substation_name)
  SELECT
    gis.mrid_from_source(gis.source_asset_key('power_transformer', pt.fid)),
    'ECG_SOUTHERN',
    NULLIF(btrim(pt.district), '')
  FROM gis.power_transformer pt
  WHERE pt.geom IS NOT NULL
  ON CONFLICT (mrid) DO NOTHING;

  RETURN jsonb_build_object(
    'distribution_transformers', v_dist,
    'power_transformers', v_pwr
  );
END;
$$ LANGUAGE plpgsql;
