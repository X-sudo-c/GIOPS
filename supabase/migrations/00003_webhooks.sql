-- Auto webhooks: Postgres -> sync-service -> Memgraph
--
-- Uses Supabase's supabase_functions.http_request (pg_net) to POST on row changes.
-- Local dev: Postgres runs in Docker; sync-service runs on the host at :5000.
-- Use host.docker.internal (not localhost) so the DB container can reach the host.
--
-- Requires sync-service running: uvicorn main:app --port 5000
-- Inspect webhook delivery: SELECT * FROM net._http_response ORDER BY id DESC LIMIT 10;

CREATE TRIGGER trg_webhook_connectivity_nodes
  AFTER INSERT OR UPDATE OR DELETE ON public.connectivity_nodes
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'http://host.docker.internal:5000/webhook/supabase-sync',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );

CREATE TRIGGER trg_webhook_ac_line_segments
  AFTER INSERT OR UPDATE OR DELETE ON public.ac_line_segments
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'http://host.docker.internal:5000/webhook/supabase-sync',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );
