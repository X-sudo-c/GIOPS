-- Enable Supabase Realtime for grid tables (live dashboard updates)

ALTER PUBLICATION supabase_realtime ADD TABLE public.connectivity_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ac_line_segments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.identified_objects;

-- Allow dashboard to read assets via REST (local dev)
GRANT SELECT ON public.connectivity_nodes TO anon, authenticated;
GRANT SELECT ON public.identified_objects TO anon, authenticated;
