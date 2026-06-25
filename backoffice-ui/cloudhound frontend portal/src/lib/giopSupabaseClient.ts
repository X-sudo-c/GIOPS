import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../api/giop-api';

let sharedClient: SupabaseClient | null = null;

export function getGiopSupabaseClient(): SupabaseClient {
  if (!sharedClient) {
    sharedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return sharedClient;
}
