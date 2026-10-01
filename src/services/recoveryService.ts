import { supabase } from './supabaseClient';

export type RecoveryUser = {
  user_id: string; email: string; registered_at: string; last_sign_in_at: string | null;
  email_confirmed: boolean; has_scan: boolean; scan_count: number; first_scan_at: string | null;
  whatsapp_phone: string | null; whatsapp_opt_in: boolean; recovery_attempts: number;
  last_recovery_at: string | null; source: string | null; medium: string | null; campaign: string | null;
};
export type RecoveryDashboard = {
  summary: { registered: number; needs_recovery: number; scanned: number; whatsapp_opted_in: number };
  users: RecoveryUser[];
};

export async function getRecoveryUsers(): Promise<RecoveryDashboard> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase.rpc('get_admin_recovery_users', { p_limit: 300 });
  if (error) throw error;
  return data as RecoveryDashboard;
}

export async function generateRecoveryLink(userId: string) {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase.functions.invoke('admin-generate-recovery-link', { body: { userId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { email: string; magicLink: string; message: string };
}

export async function setWhatsAppRecovery(phone: string, optIn: boolean) {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { error } = await supabase.rpc('set_whatsapp_recovery', { p_phone: phone, p_opt_in: optIn });
  if (error) throw error;
}

export async function recordRecoveryOpen(channel = 'magic_link') {
  if (!supabase) return;
  await supabase.rpc('record_recovery_open', { p_channel: channel });
}

export async function shouldPromptWhatsAppRecovery(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const [{ data: contact }, { count }] = await Promise.all([
    supabase.from('user_recovery_contacts').select('whatsapp_prompted_at').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('scans').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id).eq('status', 'done'),
  ]);
  return !contact?.whatsapp_prompted_at && (count ?? 0) === 0;
}
