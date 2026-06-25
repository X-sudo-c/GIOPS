-- Phase 2 operational modules MVP: cases, tickets, work orders, outages, regulatory

CREATE TYPE contact_channel AS ENUM (
  'PHONE',
  'SMS',
  'WEB',
  'MOBILE_APP',
  'EMAIL',
  'WALK_IN'
);

CREATE TYPE case_status AS ENUM (
  'NEW',
  'OPEN',
  'ESCALATED',
  'CLOSED'
);

CREATE TYPE ticket_status AS ENUM (
  'NEW',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_FIELD',
  'ESCALATED',
  'RESOLVED',
  'CLOSED'
);

CREATE TYPE ticket_source AS ENUM (
  'MANUAL',
  'CASE',
  'OUTAGE',
  'FIELD',
  'SYSTEM'
);

CREATE TYPE work_order_status AS ENUM (
  'DISPATCHED',
  'RECEIVED',
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE work_order_type AS ENUM (
  'INSPECTION',
  'MAINTENANCE',
  'OUTAGE',
  'METER',
  'CONNECTION',
  'SURVEY',
  'OTHER'
);

CREATE TYPE outage_status AS ENUM (
  'PLANNED',
  'ACTIVE',
  'RESTORING',
  'RESTORED',
  'CANCELLED'
);

CREATE TYPE outage_type AS ENUM (
  'PLANNED',
  'UNPLANNED'
);

CREATE TYPE ops_record_kind AS ENUM (
  'CASE',
  'TICKET',
  'WORK_ORDER',
  'OUTAGE'
);

CREATE TYPE notification_status AS ENUM (
  'QUEUED',
  'SENT',
  'FAILED'
);

CREATE SEQUENCE IF NOT EXISTS ops_case_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ops_ticket_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ops_work_order_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ops_outage_ref_seq START 1;

CREATE TABLE contact_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT NOT NULL UNIQUE,
  channel contact_channel NOT NULL,
  account_mrid UUID REFERENCES customer_accounts (account_mrid),
  meter_mrid UUID REFERENCES meters (mrid),
  asset_mrid UUID REFERENCES identified_objects (mrid),
  classification TEXT NOT NULL DEFAULT 'GENERAL',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status case_status NOT NULL DEFAULT 'NEW',
  assigned_to TEXT,
  due_at TIMESTAMPTZ,
  summary TEXT NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trouble_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT NOT NULL UNIQUE,
  source ticket_source NOT NULL DEFAULT 'MANUAL',
  source_case_id UUID REFERENCES contact_cases (id),
  account_mrid UUID REFERENCES customer_accounts (account_mrid),
  meter_mrid UUID REFERENCES meters (mrid),
  asset_mrid UUID REFERENCES identified_objects (mrid),
  ticket_type TEXT NOT NULL DEFAULT 'CUSTOMER',
  category TEXT,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status ticket_status NOT NULL DEFAULT 'NEW',
  assigned_to TEXT,
  due_at TIMESTAMPTZ,
  summary TEXT NOT NULL,
  resolution_code TEXT,
  resolution_summary TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT NOT NULL UNIQUE,
  work_type work_order_type NOT NULL DEFAULT 'OTHER',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status work_order_status NOT NULL DEFAULT 'DISPATCHED',
  assigned_crew TEXT,
  assigned_user TEXT,
  due_at TIMESTAMPTZ,
  account_mrid UUID REFERENCES customer_accounts (account_mrid),
  asset_mrid UUID REFERENCES identified_objects (mrid),
  feeder_mrid UUID REFERENCES identified_objects (mrid),
  source_ticket_id UUID REFERENCES trouble_tickets (id),
  source_case_id UUID REFERENCES contact_cases (id),
  summary TEXT NOT NULL,
  notes TEXT,
  geom GEOMETRY(Point, 4326),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT NOT NULL UNIQUE,
  outage_type outage_type NOT NULL DEFAULT 'UNPLANNED',
  status outage_status NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_restoration_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  affected_area TEXT,
  feeder_id TEXT,
  district TEXT,
  customers_affected INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  summary TEXT NOT NULL,
  geom GEOMETRY(Polygon, 4326),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ops_record_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type ops_record_kind NOT NULL,
  source_id UUID NOT NULL,
  target_type ops_record_kind NOT NULL,
  target_id UUID NOT NULL,
  link_reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id, target_type, target_id)
);

CREATE TABLE ops_audit_events (
  id BIGSERIAL PRIMARY KEY,
  record_type ops_record_kind NOT NULL,
  record_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  operator_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ops_audit_record ON ops_audit_events (record_type, record_id, created_at DESC);

CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  message_type TEXT NOT NULL,
  status notification_status NOT NULL DEFAULT 'QUEUED',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE regulatory_report_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL,
  generated_by TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_cases_status ON contact_cases (status, created_at DESC);
CREATE INDEX idx_contact_cases_account ON contact_cases (account_mrid);
CREATE INDEX idx_trouble_tickets_status ON trouble_tickets (status, created_at DESC);
CREATE INDEX idx_trouble_tickets_assigned ON trouble_tickets (assigned_to);
CREATE INDEX idx_work_orders_status ON work_orders (status, created_at DESC);
CREATE INDEX idx_work_orders_assigned_user ON work_orders (assigned_user);
CREATE INDEX idx_work_orders_assigned_crew ON work_orders (assigned_crew);
CREATE INDEX idx_outages_status ON outages (status, started_at DESC);

CREATE OR REPLACE FUNCTION ops_next_reference(prefix TEXT, seq_name TEXT)
RETURNS TEXT AS $$
DECLARE
  n BIGINT;
BEGIN
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO n;
  RETURN prefix || '-' || to_char(NOW(), 'YYYY') || '-' || lpad(n::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION compute_regulatory_metrics(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_customer_base INTEGER DEFAULT 10000
)
RETURNS JSONB AS $$
DECLARE
  outage_count INTEGER;
  total_cmi NUMERIC;
  total_customers INTEGER;
  saidi NUMERIC;
  saifi NUMERIC;
  caidi NUMERIC;
BEGIN
  SELECT COUNT(*),
         COALESCE(SUM(
           customers_affected * GREATEST(
             EXTRACT(EPOCH FROM (
               COALESCE(restored_at, LEAST(NOW(), p_end)) - started_at
             )) / 60.0,
             0
           )
         ), 0),
         COALESCE(SUM(customers_affected), 0)
  INTO outage_count, total_cmi, total_customers
  FROM outages
  WHERE status IN ('ACTIVE', 'RESTORING', 'RESTORED')
    AND started_at >= p_start
    AND started_at < p_end;

  saidi := CASE WHEN p_customer_base > 0 THEN total_cmi / p_customer_base ELSE 0 END;
  saifi := CASE WHEN p_customer_base > 0 THEN total_customers::NUMERIC / p_customer_base ELSE 0 END;
  caidi := CASE WHEN total_customers > 0 THEN total_cmi / total_customers ELSE 0 END;

  RETURN jsonb_build_object(
    'period_start', p_start,
    'period_end', p_end,
    'customer_base', p_customer_base,
    'outage_count', outage_count,
    'customer_minutes_interrupted', total_cmi,
    'customers_affected_total', total_customers,
    'saidi_minutes', round(saidi::NUMERIC, 4),
    'saifi_interruptions_per_customer', round(saifi::NUMERIC, 6),
    'caidi_minutes', round(caidi::NUMERIC, 4),
    'methodology_note', 'SAIDI/SAIFI use customers_affected estimates; per-customer AMI detail not yet available.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

GRANT SELECT, INSERT, UPDATE ON contact_cases, trouble_tickets, work_orders, outages,
  ops_record_links, ops_audit_events, notification_log, regulatory_report_runs TO anon, authenticated;
GRANT USAGE ON SEQUENCE ops_case_ref_seq, ops_ticket_ref_seq, ops_work_order_ref_seq, ops_outage_ref_seq TO anon, authenticated;

-- Seed sample operational records
INSERT INTO contact_cases (
  id, reference, channel, account_mrid, classification, priority, status, summary, assigned_to
) VALUES (
  'f1000000-0000-0000-0000-000000000001',
  'CASE-2026-00001',
  'PHONE',
  'c0000000-0000-0000-0000-000000000001',
  'BILLING',
  2,
  'OPEN',
  'Customer reports incorrect meter reading on last bill',
  'agent.demo'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO contact_cases (
  id, reference, channel, classification, priority, status, summary
) VALUES (
  'f1000000-0000-0000-0000-000000000002',
  'CASE-2026-00002',
  'WALK_IN',
  'OUTAGE',
  1,
  'NEW',
  'Reported transformer fault near Mallam junction'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO outages (
  id, reference, outage_type, status, started_at, estimated_restoration_at,
  affected_area, feeder_id, district, customers_affected, is_published, summary
) VALUES (
  'f2000000-0000-0000-0000-000000000001',
  'OUT-2026-00001',
  'UNPLANNED',
  'ACTIVE',
  NOW() - INTERVAL '2 hours',
  NOW() + INTERVAL '4 hours',
  'Mallam Junction area',
  'FEEDER-ECG-MALLAM-04',
  'Ablekuma',
  450,
  TRUE,
  '11kV feeder fault affecting Mallam secondary distribution'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO trouble_tickets (
  id, reference, source, source_case_id, account_mrid, ticket_type, severity, priority,
  status, summary, assigned_to
) VALUES (
  'f3000000-0000-0000-0000-000000000001',
  'TKT-2026-00001',
  'CASE',
  'f1000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'BILLING',
  'MEDIUM',
  2,
  'ASSIGNED',
  'Investigate billing discrepancy for ECG-ACC-00001',
  'billing.team'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (
  id, reference, work_type, priority, status, assigned_crew, assigned_user,
  source_case_id, asset_mrid, summary
) VALUES (
  'f4000000-0000-0000-0000-000000000001',
  'WO-2026-00001',
  'OUTAGE',
  1,
  'DISPATCHED',
  'CREW-ABLEKUMA-01',
  'tech.demo',
  'f1000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'Inspect and restore Mallam feeder fault'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO ops_record_links (source_type, source_id, target_type, target_id, link_reason, created_by)
VALUES
  ('CASE', 'f1000000-0000-0000-0000-000000000001', 'TICKET', 'f3000000-0000-0000-0000-000000000001', 'converted', 'seed'),
  ('OUTAGE', 'f2000000-0000-0000-0000-000000000001', 'WORK_ORDER', 'f4000000-0000-0000-0000-000000000001', 'dispatch', 'seed')
ON CONFLICT DO NOTHING;

SELECT setval('ops_case_ref_seq', 2);
SELECT setval('ops_ticket_ref_seq', 1);
SELECT setval('ops_work_order_ref_seq', 1);
SELECT setval('ops_outage_ref_seq', 1);
