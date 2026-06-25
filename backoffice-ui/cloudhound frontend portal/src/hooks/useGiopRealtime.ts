import { useEffect } from 'react';
import { getGiopSupabaseClient } from '../lib/giopSupabaseClient';

interface UseGiopRealtimeOptions {
  onStagingChange?: (reason: string) => void;
  onMasterChange?: (reason: string) => void;
  enabled?: boolean;
}

export function useGiopRealtime({
  onStagingChange,
  onMasterChange,
  enabled = true,
}: UseGiopRealtimeOptions) {
  useEffect(() => {
    if (!enabled) return;

    const supabase = getGiopSupabaseClient();

    const channel = supabase
      .channel('giop-grid-portal')
      .on(
        'postgres_changes',
        { event: '*', schema: 'staging', table: 'connectivity_nodes' },
        (payload) => onStagingChange?.(`staging nodes ${payload.eventType}`),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'staging', table: 'identified_objects' },
        (payload) => onStagingChange?.(`staging assets ${payload.eventType}`),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connectivity_nodes' },
        (payload) => onMasterChange?.(`nodes ${payload.eventType}`),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ac_line_segments' },
        (payload) => onMasterChange?.(`lines ${payload.eventType}`),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'identified_objects' },
        (payload) => onMasterChange?.(`assets ${payload.eventType}`),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, onStagingChange, onMasterChange]);
}
