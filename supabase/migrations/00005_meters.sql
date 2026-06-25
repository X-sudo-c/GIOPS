-- Smart meters registry: maps physical serial on meter case to asset MRID

CREATE TABLE public.meters (
  mrid UUID PRIMARY KEY REFERENCES public.identified_objects (mrid) ON DELETE CASCADE,
  serial_number TEXT NOT NULL UNIQUE,
  manufacturer TEXT,
  installed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meters_serial ON public.meters (serial_number);

GRANT SELECT ON public.meters TO anon, authenticated;

-- Test meter for OCR development
INSERT INTO public.identified_objects (mrid, name, lifecycle_state, validation)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'Pokuaa BSP Smart Meter (Test)',
  'IN_SERVICE',
  'APPROVED'
) ON CONFLICT (mrid) DO NOTHING;

INSERT INTO public.meters (mrid, serial_number, manufacturer)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'ECG-12345678',
  'Holley'
) ON CONFLICT (mrid) DO NOTHING;
