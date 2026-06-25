-- Extended platform schema (Module 2 subset): spot billing, inspections, topology repair

CREATE TYPE meter_install_status AS ENUM (
  'PLANNED',
  'INSTALLED',
  'COMMISSIONED',
  'DECOMMISSIONED'
);

CREATE TABLE customer_accounts (
  account_mrid UUID PRIMARY KEY,
  customer_name TEXT NOT NULL,
  account_number TEXT NOT NULL UNIQUE,
  balance_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_points (
  mrid UUID PRIMARY KEY REFERENCES identified_objects (mrid) ON DELETE CASCADE,
  account_mrid UUID NOT NULL REFERENCES customer_accounts (account_mrid),
  geom GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX idx_usage_points_geom ON usage_points USING GIST (geom);

CREATE TABLE spot_billing_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_mrid UUID NOT NULL REFERENCES customer_accounts (account_mrid),
  meter_mrid UUID REFERENCES meters (mrid),
  previous_reading_kwh NUMERIC(10, 3) NOT NULL,
  current_reading_kwh NUMERIC(10, 3) NOT NULL,
  net_consumption_kwh NUMERIC(10, 3) GENERATED ALWAYS AS (current_reading_kwh - previous_reading_kwh) STORED,
  tariff_rate_ghs NUMERIC(8, 4) NOT NULL DEFAULT 1.25,
  amount_ghs NUMERIC(12, 2) GENERATED ALWAYS AS ((current_reading_kwh - previous_reading_kwh) * tariff_rate_ghs) STORED,
  billed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  field_technician TEXT,
  evidence_photo_url TEXT
);

CREATE TABLE field_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_mrid UUID NOT NULL REFERENCES identified_objects (mrid),
  evidence_photo_url TEXT,
  nameplate_photo_url TEXT,
  ai_validation_status TEXT NOT NULL DEFAULT 'PENDING',
  inspector_notes TEXT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION apply_spot_bill_to_account()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE customer_accounts
  SET balance_ghs = balance_ghs + NEW.amount_ghs
  WHERE account_mrid = NEW.account_mrid;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_spot_bill_balance
  AFTER INSERT ON spot_billing_records
  FOR EACH ROW
  EXECUTE FUNCTION apply_spot_bill_to_account();

-- Dual-pass topology repair (simplified MVP)
CREATE OR REPLACE FUNCTION repair_asset_topology_and_attributes(
  target_uuid UUID,
  radius_meters DOUBLE PRECISION DEFAULT 50
)
RETURNS JSONB AS $$
DECLARE
  repairs JSONB := '[]'::JSONB;
  seg RECORD;
  snapped GEOMETRY;
  nearest UUID;
  fixed_serial TEXT;
BEGIN
  -- Pass 1: normalize conducting equipment serial numbers (ECG20001 -> ECG-20001)
  UPDATE conducting_equipment ce
  SET serial_number = regexp_replace(
    ce.serial_number,
    '^([A-Z]+)(\d+)$',
    '\1-\2'
  )
  FROM identified_objects io
  WHERE ce.mrid = io.mrid
    AND io.mrid = target_uuid
    AND ce.serial_number ~ '^[A-Z]+\d+$';

  IF FOUND THEN
    repairs := repairs || jsonb_build_array(jsonb_build_object('pass', 1, 'action', 'serial_normalized'));
  END IF;

  -- Pass 2: snap line segment endpoints to nearest connectivity node within radius
  FOR seg IN
    SELECT als.mrid, als.source_node_id, als.target_node_id, als.geom
    FROM ac_line_segments als
    WHERE als.mrid = target_uuid
       OR als.source_node_id = target_uuid
       OR als.target_node_id = target_uuid
  LOOP
    SELECT cn.mrid, cn.geom
    INTO nearest, snapped
    FROM connectivity_nodes cn
    WHERE cn.mrid <> seg.source_node_id
    ORDER BY cn.geom <-> ST_StartPoint(seg.geom)
    LIMIT 1;

    IF nearest IS NOT NULL
       AND ST_DWithin(
         ST_StartPoint(seg.geom)::geography,
         snapped::geography,
         radius_meters
       ) THEN
      UPDATE ac_line_segments
      SET geom = ST_SetSRID(
        ST_MakeLine(snapped, ST_EndPoint(geom)),
        4326
      )
      WHERE mrid = seg.mrid;

      repairs := repairs || jsonb_build_array(
        jsonb_build_object('pass', 2, 'segment', seg.mrid, 'snapped_to', nearest)
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(repairs) > 0 THEN
    UPDATE identified_objects
    SET validation = 'STAGED', updated_at = NOW()
    WHERE mrid = target_uuid;
  END IF;

  RETURN jsonb_build_object('target_uuid', target_uuid, 'repairs', repairs);
END;
$$ LANGUAGE plpgsql;

GRANT SELECT ON customer_accounts, usage_points, spot_billing_records, field_inspections TO anon, authenticated;

-- Demo customer for spot billing tests
INSERT INTO customer_accounts (account_mrid, customer_name, account_number, balance_ghs)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'Demo Residential Customer',
  'ECG-ACC-00001',
  0
) ON CONFLICT (account_mrid) DO NOTHING;
