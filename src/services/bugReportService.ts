import { Platform } from 'react-native';

import { getSession } from './authService';
import { supabase } from './supabaseClient';

export type BugReportKind = 'bug' | 'suggestion' | 'other';

/** Contexto útil automático (K) -- nunca nada sensible: pantalla desde
 * donde se manda, plataforma, y el user agent del browser en web (no hay
 * forma de pedir permiso/beneficio extra por esto, y ayuda mucho a
 * reproducir un bug real). */
function buildContext(screen: string): Record<string, unknown> {
  const context: Record<string, unknown> = { screen, platform: Platform.OS };
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    context.userAgent = navigator.userAgent;
  }
  return context;
}

export async function submitBugReport(kind: BugReportKind, message: string, screen: string): Promise<boolean> {
  if (!supabase) return false;
  const session = await getSession();
  const { error } = await supabase.from('bug_reports').insert({
    user_id: session?.user.id ?? null,
    kind,
    message,
    context: buildContext(screen),
  });
  return !error;
}
