-- Raw GIS import schema for Power System.gpkg (QGIS / ECG network model)

CREATE SCHEMA IF NOT EXISTS gis;

CREATE TABLE gis.import_runs (
  id BIGSERIAL PRIMARY KEY,
  layer_name TEXT NOT NULL,
  target_table TEXT NOT NULL,
  feature_count BIGINT,
  duration_ms BIGINT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps GPKG unique_id values to deterministic MRIDs (line endpoint resolution).
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

-- Unified conductor geometry for map tiles / analytics (no CIM FK requirements).
CREATE TABLE gis.conductor_segments (
  id BIGSERIAL PRIMARY KEY,
  source_layer TEXT NOT NULL,
  source_fid BIGINT,
  voltage_class TEXT,
  circuit_id TEXT,
  district TEXT,
  region TEXT,
  originating_node_id TEXT,
  end_node_id TEXT,
  length_m DOUBLE PRECISION,
  geom GEOMETRY(Geometry, 4326) NOT NULL
);

CREATE INDEX idx_gis_conductor_segments_geom ON gis.conductor_segments USING GIST (geom);
CREATE INDEX idx_gis_conductor_segments_layer ON gis.conductor_segments (source_layer);

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

CREATE OR REPLACE FUNCTION gis.mrid_from_source(p_source TEXT)
RETURNS UUID AS $$
  SELECT uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'giop:' || p_source
  );
$$ LANGUAGE sql IMMUTABLE;

-- Rebuild node map from imported point layers (transformers + poles).
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
    SELECT 'oh_support_structure_11kv'::text AS layer_name, unique_id, globalid, fid, geom
    FROM gis.oh_support_structure_11kv
    UNION ALL
    SELECT 'oh_support_structure_33kv', unique_id, globalid, fid, geom
    FROM gis.oh_support_structure_33kv
    UNION ALL
    SELECT 'oh_support_structure_lvle', unique_id, globalid, fid, geom
    FROM gis.oh_support_structure_lvle
  ) poles
  WHERE geom IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  RETURN jsonb_build_object('asset_id_map_rows', v_total);
END;
$$ LANGUAGE plpgsql;

-- Promote transformers into master CIM tables (connectivity_nodes).
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

-- Flatten imported line layers into gis.conductor_segments.
CREATE OR REPLACE FUNCTION gis.rebuild_conductor_segments()
RETURNS JSONB AS $$
DECLARE
  v_total BIGINT := 0;
  v_count BIGINT;
BEGIN
  TRUNCATE gis.conductor_segments;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'oh_conductor_11kv', fid, 'MV_11KV', circuit_id, district, region,
    originating_node_id, end_node_id, length_in_meters, ST_Force2D(geom)
  FROM gis.oh_conductor_11kv
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'oh_conductor_33kv', fid, 'MV_33KV', circuit_id, district, region,
    originating_node_id, end_node_id, length_in_meters, ST_Force2D(geom)
  FROM gis.oh_conductor_33kv
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'ug_cable_11kv', fid, 'MV_11KV', circuit_id, district, region,
    originating_node_id, end_node_id, length_in_meters, ST_Force2D(geom)
  FROM gis.ug_cable_11kv
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'ug_cable_33kv', fid, 'MV_33KV', circuit_id, district, region,
    originating_node_id, end_node_id, length_in_meters, ST_Force2D(geom)
  FROM gis.ug_cable_33kv
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'oh_conductor_lvle', fid, 'LV', NULL, district, NULL,
    originating_node_id, end_node_id, length_in_meters,
    ST_LineMerge(ST_Force2D(geom))
  FROM gis.oh_conductor_lvle
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'ug_cable_lvle', fid, 'LV', NULL, district, NULL,
    originating_node_id, end_node_id, length_in_meters, ST_Force2D(geom)
  FROM gis.ug_cable_lvle
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  INSERT INTO gis.conductor_segments (
    source_layer, source_fid, voltage_class, circuit_id, district, region,
    originating_node_id, end_node_id, length_m, geom
  )
  SELECT
    'service_line_lvle', fid, 'LV', NULL, district, NULL,
    originating_node_id, end_node_id, length_in_meters, ST_Force2D(geom)
  FROM gis.service_line_lvle
  WHERE geom IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  RETURN jsonb_build_object('conductor_segments', v_total);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gis.post_import_refresh()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'asset_id_map', gis.rebuild_asset_id_map(),
    'conductors', gis.rebuild_conductor_segments(),
    'cim_nodes', gis.promote_transformers_to_cim()
  );
$$ LANGUAGE sql;

GRANT USAGE ON SCHEMA gis TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA gis TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION gis.post_import_refresh() TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA gis
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;
