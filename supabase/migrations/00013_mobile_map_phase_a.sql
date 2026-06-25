-- Phase A mobile map: entity kind on nodes + line geometry on node_connections.

CREATE OR REPLACE FUNCTION public.asset_kind_for_mrid(p_mrid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT CASE am.source_layer
        WHEN 'distribution_transformer' THEN 'distribution_transformer'
        WHEN 'power_transformer' THEN 'power_transformer'
        WHEN 'oh_support_structure_11kv' THEN 'pole_11kv'
        WHEN 'oh_support_structure_33kv' THEN 'pole_33kv'
        WHEN 'oh_support_structure_lvle' THEN 'pole_lv'
        ELSE 'connectivity_node'
      END
      FROM gis.asset_id_map am
      WHERE am.mrid = p_mrid
      ORDER BY am.source_fid
      LIMIT 1
    ),
    'connectivity_node'
  );
$$;

GRANT EXECUTE ON FUNCTION public.asset_kind_for_mrid(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.nodes_near_location(
  p_lat double precision,
  p_lon double precision,
  p_limit integer DEFAULT 1000,
  p_radius_m double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH origin AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326) AS geom
  ),
  ranked AS (
    SELECT
      cn.mrid,
      cn.boundary_feeder_id,
      cn.geom,
      ST_Distance(
        cn.geom::geography,
        (SELECT geom FROM origin)::geography
      ) AS dist_m
    FROM public.connectivity_nodes cn
    JOIN public.identified_objects io ON io.mrid = cn.mrid
    CROSS JOIN origin o
    WHERE p_radius_m IS NULL
      OR ST_DWithin(cn.geom::geography, o.geom::geography, p_radius_m)
    ORDER BY cn.geom <-> o.geom
    LIMIT GREATEST(1, LEAST(p_limit, 1000))
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'mrid', r.mrid,
        'boundary_feeder_id', r.boundary_feeder_id,
        'geom', ST_AsGeoJSON(r.geom)::jsonb,
        'distance_m', r.dist_m,
        'asset_kind', public.asset_kind_for_mrid(r.mrid),
        'identified_objects', jsonb_build_object(
          'name', io.name,
          'validation', io.validation,
          'ghana_grid_assets', (
            SELECT jsonb_build_object(
              'operating_utility', gga.operating_utility,
              'substation_name', gga.substation_name
            )
            FROM public.ghana_grid_assets gga
            WHERE gga.mrid = r.mrid
          )
        )
      )
      ORDER BY r.dist_m
    ),
    '[]'::jsonb
  )
  FROM ranked r
  JOIN public.identified_objects io ON io.mrid = r.mrid;
$$;

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
      ST_AsGeoJSON(als.geom)::jsonb AS geom,
      ST_Distance(cn.geom::geography, tgt.geom::geography) AS span_m
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
      ST_AsGeoJSON(als.geom)::jsonb AS geom,
      ST_Distance(src.geom::geography, cn.geom::geography) AS span_m
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
    'asset_kind', public.asset_kind_for_mrid(p_mrid),
    'downstream', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_mrid', line_mrid,
        'neighbor_mrid', neighbor_mrid,
        'neighbor_name', neighbor_name,
        'voltage', voltage,
        'direction', direction,
        'span_m', span_m,
        'geom', geom
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
        'span_m', span_m,
        'geom', geom
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
