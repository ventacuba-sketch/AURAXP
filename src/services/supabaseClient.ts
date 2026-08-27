import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True once EXPO_PUBLIC_SUPABASE_URL/ANON_KEY are set (see .env.example).
 * Every real-backend service checks this first and falls back to mock
 * data when it's false — so the app keeps working exactly as before
 * until Supabase is actually wired up. No crash, no half-broken screen.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Null until configured. Only import/use this through the service layer
 * (scanService, authService, challengeService), which all check
 * `isSupabaseConfigured` first — never reach for this directly from a screen.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
