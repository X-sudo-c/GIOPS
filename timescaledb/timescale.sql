-- TimescaleDB schema for GIOP meter telemetry

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE public.meter_readings (
  id BIGSERIAL,
  meter_mrid UUID NOT NULL,
  reading_timestamp TIMESTAMPTZ NOT NULL,
  active_energy_kwh NUMERIC(10, 3) NOT NULL,
  PRIMARY KEY (meter_mrid, reading_timestamp)
);

SELECT create_hypertable('public.meter_readings', 'reading_timestamp');

CREATE INDEX idx_meter_readings_meter_mrid ON public.meter_readings (meter_mrid);

COMMENT ON TABLE public.meter_readings IS
  'TimescaleDB hypertable partitioned by reading_timestamp for per-meter time-series queries.';
