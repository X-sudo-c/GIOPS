-- Nearest connectivity nodes for mobile map (KNN on PostGIS geom index).

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

GRANT EXECUTE ON FUNCTION public.nodes_near_location(
  double precision, double precision, integer, double precision
) TO anon, authenticated;
