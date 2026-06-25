-- Allow mobile app (anon REST) to join utility metadata on asset list queries

GRANT SELECT ON public.ghana_grid_assets TO anon, authenticated;
