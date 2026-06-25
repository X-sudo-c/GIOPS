-- Tier 1 priority FR: lineage, conflicts, DLQ, schematic symbols, energy balance

CREATE TYPE lineage_source_type AS ENUM (
  'FIELD_SYNC',
  'REPAIR',
  'PROMOTE',
  'MANUAL_EDIT',
  'DLQ_RETRY',
  'SYSTEM'
);

CREATE TYPE conflict_proposal_status AS ENUM (
  'OPEN',
  'RESOLVED_MASTER',
  'RESOLVED_FIELD',
  'DISCARDED'
);

CREATE TYPE integration_dlq_source AS ENUM (
  'KAFKA',
  'MIGRATION',
  'WEBHOOK',
  'FIELD_SYNC'
);

CREATE TYPE integration_dlq_status AS ENUM (
  'OPEN',
  'RETRYING',
  'RESOLVED',
  'DISCARDED'
);

CREATE TABLE public.data_lineage (
  id BIGSERIAL PRIMARY KEY,
  target_mrid UUID NOT NULL,
  source_type lineage_source_type NOT NULL,
  action_type TEXT NOT NULL,
  operator_id TEXT,
  provenance_ref TEXT,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_lineage_target ON public.data_lineage (target_mrid, created_at DESC);
CREATE INDEX idx_data_lineage_source_action ON public.data_lineage (source_type, action_type);

CREATE TABLE public.conflict_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_mrid UUID NOT NULL,
  offline_session_started_at TIMESTAMPTZ NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL,
  proposed_payload JSONB NOT NULL,
  status conflict_proposal_status NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conflict_proposals_asset ON public.conflict_proposals (asset_mrid, status);

CREATE TABLE public.integration_dlq (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source integration_dlq_source NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT NOT NULL,
  status integration_dlq_status NOT NULL DEFAULT 'OPEN',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_integration_dlq_status ON public.integration_dlq (status, created_at DESC);

CREATE TABLE public.schematic_symbols (
  symbol_type TEXT PRIMARY KEY,
  svg_path_data TEXT NOT NULL,
  width NUMERIC(6, 2) NOT NULL DEFAULT 24,
  height NUMERIC(6, 2) NOT NULL DEFAULT 24
);

CREATE TABLE public.energy_balance_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_key TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  energy_in_kwh NUMERIC(14, 3) NOT NULL DEFAULT 0,
  energy_out_kwh NUMERIC(14, 3) NOT NULL DEFAULT 0,
  variance_pct NUMERIC(8, 4) NOT NULL DEFAULT 0,
  anomaly_flag BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_energy_balance_zone ON public.energy_balance_results (zone_key, computed_at DESC);

INSERT INTO public.schematic_symbols (symbol_type, svg_path_data, width, height) VALUES
  ('transformer', 'M12 2 L12 8 M8 8 L16 8 M8 8 Q12 14 16 8 M12 14 L12 22', 24, 24),
  ('breaker', 'M4 12 L10 12 M14 12 L20 12 M10 8 L14 16', 24, 24),
  ('line', 'M2 12 L22 12', 24, 24),
  ('meter', 'M6 6 L18 6 L18 18 L6 18 Z M9 12 L15 12', 24, 24),
  ('node', 'M12 12 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0', 24, 24)
ON CONFLICT (symbol_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.log_data_lineage(
  p_target_mrid UUID,
  p_source_type lineage_source_type,
  p_action_type TEXT,
  p_operator_id TEXT DEFAULT NULL,
  p_provenance_ref TEXT DEFAULT NULL,
  p_before_state JSONB DEFAULT NULL,
  p_after_state JSONB DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO public.data_lineage (
    target_mrid, source_type, action_type, operator_id,
    provenance_ref, before_state, after_state
  ) VALUES (
    p_target_mrid, p_source_type, p_action_type, p_operator_id,
    p_provenance_ref, p_before_state, p_after_state
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_lineage_identified_objects_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'INSERT';
    PERFORM public.log_data_lineage(
      NEW.mrid,
      'SYSTEM',
      v_action,
      current_user,
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      NULL,
      row_to_json(NEW)::jsonb
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'UPDATE';
    PERFORM public.log_data_lineage(
      NEW.mrid,
      'MANUAL_EDIT',
      v_action,
      current_user,
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      row_to_json(OLD)::jsonb,
      row_to_json(NEW)::jsonb
    );
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lineage_public_identified_objects ON public.identified_objects;
CREATE TRIGGER trg_lineage_public_identified_objects
  AFTER INSERT OR UPDATE ON public.identified_objects
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_lineage_identified_objects_fn();

DROP TRIGGER IF EXISTS trg_lineage_staging_identified_objects ON staging.identified_objects;
CREATE TRIGGER trg_lineage_staging_identified_objects
  AFTER INSERT OR UPDATE ON staging.identified_objects
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_lineage_identified_objects_fn();

GRANT SELECT ON public.data_lineage TO anon, authenticated;
GRANT INSERT ON public.data_lineage TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.conflict_proposals TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.integration_dlq TO anon, authenticated;
GRANT SELECT ON public.schematic_symbols TO anon, authenticated;
GRANT SELECT, INSERT ON public.energy_balance_results TO anon, authenticated;

REVOKE UPDATE, DELETE ON public.data_lineage FROM anon, authenticated;
