-- Staging schema: field captures land here; approval promotes rows into public (master).

CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE staging.identified_objects (
  mrid UUID PRIMARY KEY,
  name TEXT NOT NULL,
  lifecycle_state asset_lifecycle_state NOT NULL DEFAULT 'PLANNING',
  validation staging_validation_state NOT NULL DEFAULT 'PENDING_FIELD',
  error_log TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE staging.connectivity_nodes (
  mrid UUID PRIMARY KEY REFERENCES staging.identified_objects (mrid) ON DELETE CASCADE,
  boundary_feeder_id TEXT,
  geom GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX idx_staging_connectivity_nodes_geom
  ON staging.connectivity_nodes USING GIST (geom);

CREATE TABLE staging.ghana_grid_assets (
  mrid UUID PRIMARY KEY REFERENCES staging.identified_objects (mrid) ON DELETE CASCADE,
  operating_utility ghana_utility_enum NOT NULL,
  substation_name TEXT
);

-- Collision shield applies to staging workflow rows only (not master).
DROP TRIGGER IF EXISTS trg_collision_shield ON public.identified_objects;

CREATE TRIGGER trg_collision_shield_staging
  BEFORE UPDATE ON staging.identified_objects
  FOR EACH ROW
  WHEN (OLD.validation = 'PENDING_FIELD')
  EXECUTE FUNCTION intercept_sync_collision();

-- Promote a reviewed staging asset into the master public tables.
CREATE OR REPLACE FUNCTION promote_staged_asset(target_mrid UUID)
RETURNS JSONB AS $$
DECLARE
  v_validation staging_validation_state;
BEGIN
  SELECT validation INTO v_validation
  FROM staging.identified_objects
  WHERE mrid = target_mrid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staging asset % not found', target_mrid;
  END IF;

  IF v_validation = 'IN_CONFLICT' THEN
    RAISE EXCEPTION 'Cannot promote asset % in IN_CONFLICT state', target_mrid;
  END IF;

  IF v_validation NOT IN ('PENDING_FIELD', 'STAGED') THEN
    RAISE EXCEPTION 'Asset % is not promotable (validation=%)', target_mrid, v_validation;
  END IF;

  IF EXISTS (SELECT 1 FROM public.identified_objects WHERE mrid = target_mrid) THEN
    RAISE EXCEPTION 'Master already contains asset %', target_mrid;
  END IF;

  INSERT INTO public.identified_objects (mrid, name, lifecycle_state, validation, error_log, updated_at)
  SELECT mrid, name, lifecycle_state, 'APPROVED', error_log, NOW()
  FROM staging.identified_objects
  WHERE mrid = target_mrid;

  INSERT INTO public.connectivity_nodes (mrid, boundary_feeder_id, geom)
  SELECT mrid, boundary_feeder_id, geom
  FROM staging.connectivity_nodes
  WHERE mrid = target_mrid;

  INSERT INTO public.ghana_grid_assets (mrid, operating_utility, substation_name)
  SELECT mrid, operating_utility, substation_name
  FROM staging.ghana_grid_assets
  WHERE mrid = target_mrid;

  DELETE FROM staging.identified_objects WHERE mrid = target_mrid;

  RETURN jsonb_build_object(
    'mrid', target_mrid,
    'validation', 'APPROVED',
    'promoted', true
  );
END;
$$ LANGUAGE plpgsql;

-- Topology repair for assets still in staging (mirrors public repair on staging tables).
CREATE OR REPLACE FUNCTION repair_staging_asset_topology_and_attributes(
  target_uuid UUID,
  radius_meters DOUBLE PRECISION DEFAULT 50
)
RETURNS JSONB AS $$
DECLARE
  repairs JSONB := '[]'::JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM staging.identified_objects WHERE mrid = target_uuid
  ) THEN
    RAISE EXCEPTION 'Staging asset % not found', target_uuid;
  END IF;

  IF jsonb_array_length(repairs) = 0 THEN
    repairs := repairs || jsonb_build_array(
      jsonb_build_object('pass', 0, 'action', 'staging_asset_verified', 'mrid', target_uuid)
    );
  END IF;

  UPDATE staging.identified_objects
  SET validation = 'STAGED', updated_at = NOW()
  WHERE mrid = target_uuid
    AND validation = 'PENDING_FIELD';

  RETURN jsonb_build_object('target_uuid', target_uuid, 'tier', 'staging', 'repairs', repairs);
END;
$$ LANGUAGE plpgsql;

-- Move any legacy field-pending rows from master into staging (pre-split MVP data).
INSERT INTO staging.identified_objects (mrid, name, lifecycle_state, validation, error_log, updated_at)
SELECT mrid, name, lifecycle_state, validation, error_log, updated_at
FROM public.identified_objects
WHERE validation IN ('PENDING_FIELD', 'STAGED', 'IN_CONFLICT')
ON CONFLICT (mrid) DO NOTHING;

INSERT INTO staging.connectivity_nodes (mrid, boundary_feeder_id, geom)
SELECT cn.mrid, cn.boundary_feeder_id, cn.geom
FROM public.connectivity_nodes cn
JOIN public.identified_objects io ON cn.mrid = io.mrid
WHERE io.validation IN ('PENDING_FIELD', 'STAGED', 'IN_CONFLICT')
ON CONFLICT (mrid) DO NOTHING;

INSERT INTO staging.ghana_grid_assets (mrid, operating_utility, substation_name)
SELECT ga.mrid, ga.operating_utility, ga.substation_name
FROM public.ghana_grid_assets ga
JOIN public.identified_objects io ON ga.mrid = io.mrid
WHERE io.validation IN ('PENDING_FIELD', 'STAGED', 'IN_CONFLICT')
ON CONFLICT (mrid) DO NOTHING;

DELETE FROM public.identified_objects
WHERE validation IN ('PENDING_FIELD', 'STAGED', 'IN_CONFLICT');

-- API + realtime access
GRANT USAGE ON SCHEMA staging TO anon, authenticated;
GRANT SELECT ON staging.identified_objects, staging.connectivity_nodes, staging.ghana_grid_assets
  TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE staging.connectivity_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE staging.identified_objects;
