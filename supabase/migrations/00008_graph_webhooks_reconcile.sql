-- Replace bare http_request triggers with payloads that include INSERT/UPDATE/DELETE rows.
-- After any change, sync-service reconciles Memgraph against Postgres (source of truth).

DROP TRIGGER IF EXISTS trg_webhook_connectivity_nodes ON public.connectivity_nodes;
DROP TRIGGER IF EXISTS trg_webhook_ac_line_segments ON public.ac_line_segments;

CREATE OR REPLACE FUNCTION public.notify_giop_graph_sync()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    'old_record', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END
  );

  PERFORM net.http_post(
    url := 'http://host.docker.internal:5000/webhook/supabase-sync'::text,
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_webhook_connectivity_nodes
  AFTER INSERT OR UPDATE OR DELETE ON public.connectivity_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_giop_graph_sync();

CREATE TRIGGER trg_webhook_ac_line_segments
  AFTER INSERT OR UPDATE OR DELETE ON public.ac_line_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_giop_graph_sync();

-- CASCADE deletes from identified_objects remove connectivity_nodes rows, firing DELETE above.
