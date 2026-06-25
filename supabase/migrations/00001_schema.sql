-- GIOP core schema: Ghana power grid asset model

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ENUM types
CREATE TYPE asset_lifecycle_state AS ENUM (
  'PLANNING',
  'IN_CONSTRUCTION',
  'IN_SERVICE',
  'OUT_OF_SERVICE',
  'ABANDONED'
);

CREATE TYPE staging_validation_state AS ENUM (
  'PENDING_FIELD',
  'STAGED',
  'IN_CONFLICT',
  'APPROVED'
);

CREATE TYPE ghana_utility_enum AS ENUM (
  'ECG_SOUTHERN',
  'NEDCO_NORTHERN',
  'GRIDCO_TRANSMISSION'
);

CREATE TYPE ghana_voltage_enum AS ENUM (
  'LV_230V',
  'LV_400V',
  'MV_11KV',
  'MV_33KV',
  'HV_161KV',
  'HV_330KV'
);

-- Base identified object registry
CREATE TABLE identified_objects (
  mrid UUID PRIMARY KEY,
  name TEXT NOT NULL,
  lifecycle_state asset_lifecycle_state NOT NULL DEFAULT 'PLANNING',
  validation staging_validation_state NOT NULL DEFAULT 'PENDING_FIELD',
  error_log TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grid connectivity nodes (spatial)
CREATE TABLE connectivity_nodes (
  mrid UUID PRIMARY KEY REFERENCES identified_objects (mrid) ON DELETE CASCADE,
  boundary_feeder_id TEXT,
  geom GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX idx_connectivity_nodes_geom ON connectivity_nodes USING GIST (geom);

-- Conducting equipment (lines, switches, etc.)
CREATE TABLE conducting_equipment (
  mrid UUID PRIMARY KEY REFERENCES identified_objects (mrid) ON DELETE CASCADE,
  phases TEXT NOT NULL DEFAULT 'ABC',
  nominal_voltage ghana_voltage_enum NOT NULL,
  serial_number TEXT
);

-- AC line segments between connectivity nodes
CREATE TABLE ac_line_segments (
  mrid UUID PRIMARY KEY REFERENCES conducting_equipment (mrid) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES connectivity_nodes (mrid),
  target_node_id UUID NOT NULL REFERENCES connectivity_nodes (mrid),
  direction_downstream BOOLEAN NOT NULL DEFAULT TRUE,
  geom GEOMETRY(LineString, 4326) NOT NULL
);

CREATE INDEX idx_ac_line_segments_geom ON ac_line_segments USING GIST (geom);

-- Ghana-specific grid asset metadata
CREATE TABLE ghana_grid_assets (
  mrid UUID PRIMARY KEY REFERENCES identified_objects (mrid) ON DELETE CASCADE,
  operating_utility ghana_utility_enum NOT NULL,
  substation_name TEXT
);

-- Collision shield: detect parallel field sync conflicts
CREATE OR REPLACE FUNCTION intercept_sync_collision()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.updated_at IS DISTINCT FROM NEW.updated_at THEN
    NEW.validation := 'IN_CONFLICT';
    NEW.error_log := COALESCE(NEW.error_log, '') || format(
      E'\n[%s] updated_at conflict: row had %s, update carried %s',
      NOW(), OLD.updated_at, NEW.updated_at
    );
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.validation := 'STAGED';
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_collision_shield
  BEFORE UPDATE ON identified_objects
  FOR EACH ROW
  WHEN (OLD.validation = 'PENDING_FIELD')
  EXECUTE FUNCTION intercept_sync_collision();
