-- Wire imported GIS conductor topology into public CIM tables (nodes + ac_line_segments).

CREATE TABLE IF NOT EXISTS gis.unique_id_lookup (
  unique_id TEXT PRIMARY KEY,
  mrid UUID NOT NULL,
  geom GEOMETRY(Point, 4326)
);

CREATE INDEX IF NOT EXISTS idx_gis_unique_id_lookup_mrid ON gis.unique_id_lookup (mrid);

CREATE INDEX IF NOT EXISTS idx_gis_conductor_segments_originating
  ON gis.conductor_segments (originating_node_id)
  WHERE originating_node_id IS NOT NULL AND btrim(originating_node_id) <> '';

CREATE INDEX IF NOT EXISTS idx_gis_conductor_segments_end
  ON gis.conductor_segments (end_node_id)
  WHERE end_node_id IS NOT NULL AND btrim(end_node_id) <> '';

CREATE OR REPLACE FUNCTION gis.voltage_class_to_enum(p_class TEXT)
RETURNS ghana_voltage_enum AS $$
  SELECT CASE p_class
    WHEN 'MV_11KV' THEN 'MV_11KV'::ghana_voltage_enum
    WHEN 'MV_33KV' THEN 'MV_33KV'::ghana_voltage_enum
    WHEN 'LV' THEN 'LV_400V'::ghana_voltage_enum
    ELSE 'MV_11KV'::ghana_voltage_enum
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION gis.conductor_segment_mrid(
  p_layer TEXT,
  p_fid BIGINT
)
RETURNS UUID AS $$
  SELECT gis.mrid_from_source('conductor:' || p_layer || ':' || p_fid::text);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION gis.rebuild_unique_id_lookup()
RETURNS JSONB AS $$
DECLARE
  v_count BIGINT;
BEGIN
  TRUNCATE gis.unique_id_lookup;

  INSERT INTO gis.unique_id_lookup (unique_id, mrid, geom)
  SELECT DISTINCT ON (btrim(source_unique_id))
    btrim(source_unique_id),
    mrid,
    geom
  FROM gis.asset_id_map
  WHERE source_unique_id IS NOT NULL AND btrim(source_unique_id) <> ''
  ORDER BY
    btrim(source_unique_id),
    CASE source_layer
      WHEN 'distribution_transformer' THEN 1
      WHEN 'power_transformer' THEN 2
      WHEN 'oh_support_structure_11kv' THEN 3
      WHEN 'oh_support_structure_33kv' THEN 4
      WHEN 'oh_support_structure_lvle' THEN 5
      ELSE 9
    END,
    source_fid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('unique_id_lookup_rows', v_count);
END;
$$ LANGUAGE plpgsql;

-- Promote poles / support structures so line endpoints can FK to connectivity_nodes.
CREATE OR REPLACE FUNCTION gis.promote_support_structures_to_cim()
RETURNS JSONB AS $$
DECLARE
  v_nodes BIGINT;
BEGIN
  ALTER TABLE public.connectivity_nodes DISABLE TRIGGER trg_webhook_connectivity_nodes;

  INSERT INTO public.identified_objects (mrid, name, lifecycle_state, validation)
  SELECT
    m.mrid,
    COALESCE(
      NULLIF(btrim(m.source_unique_id), ''),
      m.source_layer || ':' || m.source_fid::text
    ),
    'IN_SERVICE',
    'APPROVED'
  FROM gis.asset_id_map m
  WHERE m.source_layer LIKE 'oh_support_structure%'
    AND NOT EXISTS (
      SELECT 1 FROM public.connectivity_nodes cn WHERE cn.mrid = m.mrid
    )
  ON CONFLICT (mrid) DO NOTHING;

  INSERT INTO public.connectivity_nodes (mrid, boundary_feeder_id, geom)
  SELECT m.mrid, NULL, m.geom
  FROM gis.asset_id_map m
  WHERE m.source_layer LIKE 'oh_support_structure%'
    AND NOT EXISTS (
      SELECT 1 FROM public.connectivity_nodes cn WHERE cn.mrid = m.mrid
    )
  ON CONFLICT (mrid) DO NOTHING;

  GET DIAGNOSTICS v_nodes = ROW_COUNT;

  INSERT INTO public.ghana_grid_assets (mrid, operating_utility, substation_name)
  SELECT m.mrid, 'ECG_SOUTHERN', m.source_layer
  FROM gis.asset_id_map m
  WHERE m.source_layer LIKE 'oh_support_structure%'
    AND EXISTS (
      SELECT 1 FROM public.connectivity_nodes cn WHERE cn.mrid = m.mrid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ghana_grid_assets gga WHERE gga.mrid = m.mrid
    )
  ON CONFLICT (mrid) DO NOTHING;

  ALTER TABLE public.connectivity_nodes ENABLE TRIGGER trg_webhook_connectivity_nodes;

  RETURN jsonb_build_object('support_structure_nodes', v_nodes);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gis.as_linestring(p_geom geometry)
RETURNS geometry AS $$
DECLARE
  v_merged geometry;
BEGIN
  IF p_geom IS NULL THEN
    RETURN NULL;
  END IF;

  v_merged := ST_LineMerge(ST_CollectionHomogenize(ST_Force2D(p_geom)));
  IF v_merged IS NULL THEN
    RETURN NULL;
  END IF;

  IF GeometryType(v_merged) = 'LINESTRING' THEN
    RETURN v_merged;
  ELSIF GeometryType(v_merged) = 'MULTILINESTRING' THEN
    RETURN (
      SELECT d.geom
      FROM ST_Dump(v_merged) AS d
      ORDER BY ST_Length(d.geom) DESC
      LIMIT 1
    );
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Promote resolvable conductor segments into ac_line_segments (+ equipment registry).
CREATE OR REPLACE FUNCTION gis.promote_conductors_to_cim()
RETURNS JSONB AS $$
DECLARE
  v_lines BIGINT;
  v_skipped BIGINT;
  v_unresolved BIGINT;
BEGIN
  DROP TABLE IF EXISTS _gis_eligible_conductors;
  ALTER TABLE public.ac_line_segments DISABLE TRIGGER trg_webhook_ac_line_segments;

  CREATE TEMP TABLE _gis_eligible_conductors ON COMMIT DROP AS
  SELECT
    cs.id,
    cs.source_layer,
    cs.source_fid,
    cs.voltage_class,
    cs.circuit_id,
    gis.conductor_segment_mrid(cs.source_layer, cs.source_fid) AS line_mrid,
    src.mrid AS source_mrid,
    tgt.mrid AS target_mrid,
    gis.as_linestring(cs.geom) AS line_geom
  FROM gis.conductor_segments cs
  JOIN gis.unique_id_lookup src
    ON src.unique_id = btrim(cs.originating_node_id)
  JOIN gis.unique_id_lookup tgt
    ON tgt.unique_id = btrim(cs.end_node_id)
  WHERE cs.originating_node_id IS NOT NULL
    AND cs.end_node_id IS NOT NULL
    AND btrim(cs.originating_node_id) <> ''
    AND btrim(cs.end_node_id) <> ''
    AND src.mrid IS DISTINCT FROM tgt.mrid
    AND gis.as_linestring(cs.geom) IS NOT NULL;

  INSERT INTO public.identified_objects (mrid, name, lifecycle_state, validation)
  SELECT
    e.line_mrid,
    e.source_layer || ' segment ' || e.source_fid::text,
    'IN_SERVICE',
    'APPROVED'
  FROM _gis_eligible_conductors e
  ON CONFLICT (mrid) DO NOTHING;

  INSERT INTO public.conducting_equipment (mrid, phases, nominal_voltage, serial_number)
  SELECT
    e.line_mrid,
    'ABC',
    gis.voltage_class_to_enum(e.voltage_class),
    NULLIF(btrim(e.circuit_id), '')
  FROM _gis_eligible_conductors e
  ON CONFLICT (mrid) DO NOTHING;

  INSERT INTO public.ac_line_segments (
    mrid, source_node_id, target_node_id, direction_downstream, geom
  )
  SELECT
    e.line_mrid,
    e.source_mrid,
    e.target_mrid,
    TRUE,
    e.line_geom::geometry(LineString, 4326)
  FROM _gis_eligible_conductors e
  WHERE GeometryType(e.line_geom) = 'LINESTRING'
  ON CONFLICT (mrid) DO NOTHING;

  GET DIAGNOSTICS v_lines = ROW_COUNT;

  ALTER TABLE public.ac_line_segments ENABLE TRIGGER trg_webhook_ac_line_segments;

  SELECT COUNT(*) INTO v_skipped
  FROM gis.conductor_segments cs
  WHERE cs.originating_node_id IS NULL
     OR cs.end_node_id IS NULL
     OR btrim(cs.originating_node_id) = ''
     OR btrim(cs.end_node_id) = '';

  SELECT COUNT(*) INTO v_unresolved
  FROM gis.conductor_segments cs
  WHERE cs.originating_node_id IS NOT NULL
    AND cs.end_node_id IS NOT NULL
    AND btrim(cs.originating_node_id) <> ''
    AND btrim(cs.end_node_id) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM _gis_eligible_conductors e
      WHERE e.id = cs.id
    );

  RETURN jsonb_build_object(
    'ac_line_segments_inserted', v_lines,
    'segments_missing_endpoints', v_skipped,
    'segments_unresolved_endpoints', v_unresolved
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gis.promote_topology_to_cim()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'unique_id_lookup', gis.rebuild_unique_id_lookup(),
    'support_structures', gis.promote_support_structures_to_cim(),
    'conductors', gis.promote_conductors_to_cim()
  );
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION gis.post_import_refresh()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'asset_id_map', gis.rebuild_asset_id_map(),
    'conductors', gis.rebuild_conductor_segments(),
    'cim_nodes', gis.promote_transformers_to_cim()
  );
$$ LANGUAGE sql;

-- Connected neighbors for map detail / trace (Postgres-native, no Memgraph required).
CREATE OR REPLACE FUNCTION public.node_connections(
  p_mrid UUID,
  p_limit INTEGER DEFAULT 25
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH lim AS (
    SELECT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100)) AS n
  ),
  downstream AS (
    SELECT
      als.mrid AS line_mrid,
      als.target_node_id AS neighbor_mrid,
      io.name AS neighbor_name,
      ce.nominal_voltage::text AS voltage,
      'downstream' AS direction,
      ST_Distance(
        cn.geom::geography,
        tgt.geom::geography
      ) AS span_m
    FROM public.ac_line_segments als
    JOIN public.connectivity_nodes cn ON cn.mrid = als.source_node_id
    JOIN public.connectivity_nodes tgt ON tgt.mrid = als.target_node_id
    JOIN public.identified_objects io ON io.mrid = tgt.mrid
    JOIN public.conducting_equipment ce ON ce.mrid = als.mrid
    WHERE als.source_node_id = p_mrid
    ORDER BY span_m NULLS LAST
    LIMIT (SELECT n FROM lim)
  ),
  upstream AS (
    SELECT
      als.mrid AS line_mrid,
      als.source_node_id AS neighbor_mrid,
      io.name AS neighbor_name,
      ce.nominal_voltage::text AS voltage,
      'upstream' AS direction,
      ST_Distance(
        src.geom::geography,
        cn.geom::geography
      ) AS span_m
    FROM public.ac_line_segments als
    JOIN public.connectivity_nodes cn ON cn.mrid = als.target_node_id
    JOIN public.connectivity_nodes src ON src.mrid = als.source_node_id
    JOIN public.identified_objects io ON io.mrid = src.mrid
    JOIN public.conducting_equipment ce ON ce.mrid = als.mrid
    WHERE als.target_node_id = p_mrid
    ORDER BY span_m NULLS LAST
    LIMIT (SELECT n FROM lim)
  )
  SELECT jsonb_build_object(
    'mrid', p_mrid,
    'downstream', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_mrid', line_mrid,
        'neighbor_mrid', neighbor_mrid,
        'neighbor_name', neighbor_name,
        'voltage', voltage,
        'direction', direction,
        'span_m', span_m
      ) ORDER BY span_m)
      FROM downstream
    ), '[]'::jsonb),
    'upstream', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_mrid', line_mrid,
        'neighbor_mrid', neighbor_mrid,
        'neighbor_name', neighbor_name,
        'voltage', voltage,
        'direction', direction,
        'span_m', span_m
      ) ORDER BY span_m)
      FROM upstream
    ), '[]'::jsonb),
    'degree', (
      SELECT COUNT(*)::int
      FROM public.ac_line_segments als
      WHERE als.source_node_id = p_mrid OR als.target_node_id = p_mrid
    )
  );
$$;

GRANT EXECUTE ON FUNCTION gis.promote_topology_to_cim() TO service_role;
GRANT EXECUTE ON FUNCTION public.node_connections(UUID, INTEGER) TO anon, authenticated;
