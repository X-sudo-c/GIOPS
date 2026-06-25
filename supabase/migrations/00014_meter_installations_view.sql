-- Meter installations view for ops display (light schema gap closure)

CREATE OR REPLACE VIEW public.meter_installations AS
SELECT
  m.mrid AS meter_mrid,
  m.serial_number,
  m.manufacturer,
  m.installed_at,
  up.account_mrid,
  up.mrid AS usage_point_mrid
FROM public.meters m
LEFT JOIN public.usage_points up ON up.mrid = m.mrid;

GRANT SELECT ON public.meter_installations TO anon, authenticated;
