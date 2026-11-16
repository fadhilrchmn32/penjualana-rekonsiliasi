import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '';

export const isSupabaseConfigured =
  supabaseUrl.length > 0 &&
  supabaseAnonKey.length > 0 &&
  !supabaseUrl.includes('your-shared-project.supabase.co') &&
  !supabaseAnonKey.includes('your-supabase-publishable');

let clientInstance: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!clientInstance) {
    clientInstance = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    });
  }
  return clientInstance;
}

export function getSupabaseConfigStatus() {
  return {
    configured: isSupabaseConfigured,
    hasUrl: supabaseUrl.length > 0 && !supabaseUrl.includes('your-shared-project.supabase.co'),
    hasKey: supabaseAnonKey.length > 0 && !supabaseAnonKey.includes('your-supabase-publishable'),
    urlPreview: supabaseUrl ? supabaseUrl.replace(/^(https:\/\/[^.]{4}).*(\.supabase\.co.*)$/, '$1…$2') : 'Belum diisi',
  };
}

export async function createSignedEvidenceUrl(storagePath: string): Promise<string | null> {
  const sb = getSupabaseClient();
  if (!sb || !storagePath) return null;
  const { data, error } = await sb.storage
    .from('finops-evidence')
    .createSignedUrl(storagePath, 120);
  if (error) return null;
  return data?.signedUrl ?? null;
}
