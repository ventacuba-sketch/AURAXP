import { supabase } from './supabaseClient';

export type SourceGroup = 'meta' | 'organic' | 'other';
export type RecoverySegment = 'unconfirmed' | 'no_first_scan';
export type FunnelStage =
  | 'registered_only'
  | 'viewed_upload'
  | 'selected_video'
  | 'attempted_submit'
  | 'completed_first_scan';

export interface RecoveryKpis {
  range: { start: string; end: string };
  registered: number;
  unconfirmed_legacy: number;
  no_first_scan: number;
  reached_upload_abandoned: number;
  attempted_scan_failed: number;
  recovered: number;
  recovery_rate_pct: number;
}

export interface RecoveryListRow {
  user_id: string;
  email: string;
  username: string | null;
  registered_at: string;
  email_confirmed_at: string | null;
  confirmed: boolean;
  last_sign_in_at: string | null;
  last_event_name: string | null;
  last_event_at: string | null;
  visitor_id: string | null;
  has_attribution: boolean;
  source_group: SourceGroup;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  scans_total: number;
  scans_done: number;
  has_first_scan: boolean;
  first_scan_at: string | null;
  reached_upload: boolean;
  reached_video_selected: boolean;
  reached_submitted: boolean;
  submit_failure_count: number;
  funnel_stage: FunnelStage;
  recovered: boolean;
  total_count: number;
}

export interface RecoveryFilters {
  start: Date;
  end: Date;
  segment?: RecoverySegment | null;
  sourceGroup?: SourceGroup | null;
  confirmed?: boolean | null;
  hasFirstScan?: boolean | null;
  campaign?: string | null;
  creative?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface RecoveryUserDetail {
  user: {
    user_id: string;
    email: string;
    registered_at: string;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    confirmation_sent_at: string | null;
    username: string | null;
    visitor_id: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    fbclid: string | null;
    fbc: string | null;
    fbp: string | null;
  };
  scans: Array<{ id: string; status: string; created_at: string; analyzed_at: string | null; aura_score: number | null }>;
  events: Array<{ event_name: string; created_at: string; metadata: Record<string, unknown> | null }>;
  recovery_actions: Array<{
    id: string;
    performed_by: string;
    email_confirmed: boolean;
    password_reset_sent: boolean;
    notes: string | null;
    created_at: string;
  }>;
}

export async function getUserRecoveryKpis(filters: RecoveryFilters): Promise<RecoveryKpis> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase.rpc('admin_user_recovery_kpis', {
    p_start: filters.start.toISOString(),
    p_end: filters.end.toISOString(),
    p_source_group: filters.sourceGroup ?? null,
    p_confirmed: filters.confirmed ?? null,
    p_has_first_scan: filters.hasFirstScan ?? null,
    p_campaign: filters.campaign ?? null,
    p_creative: filters.creative ?? null,
  });
  if (error) throw error;
  if (!data) throw new Error('No se recibieron KPIs de recuperación');
  return data as RecoveryKpis;
}

export async function listUserRecovery(filters: RecoveryFilters): Promise<RecoveryListRow[]> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase.rpc('admin_list_user_recovery', {
    p_start: filters.start.toISOString(),
    p_end: filters.end.toISOString(),
    p_segment: filters.segment ?? null,
    p_source_group: filters.sourceGroup ?? null,
    p_confirmed: filters.confirmed ?? null,
    p_has_first_scan: filters.hasFirstScan ?? null,
    p_campaign: filters.campaign ?? null,
    p_creative: filters.creative ?? null,
    p_search: filters.search ?? null,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as RecoveryListRow[];
}

export async function getUserRecoveryDetail(userId: string): Promise<RecoveryUserDetail> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase.rpc('admin_get_user_recovery_detail', { p_user_id: userId });
  if (error) throw error;
  if (!data) throw new Error('No se encontró el usuario');
  return data as RecoveryUserDetail;
}

export interface RecoverAccessResult {
  ok: boolean;
  email?: string;
  emailConfirmed?: boolean;
  alreadyConfirmed?: boolean;
  passwordResetSent?: boolean;
  error?: string;
}

export async function recoverUserAccess(userId: string): Promise<RecoverAccessResult> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesión de administrador no disponible');

  const { data, error } = await supabase.functions.invoke('admin-recover-user-access', {
    body: { userId, confirm: true },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<RecoverAccessResult> } }).context;
    const parsed = context?.json ? await context.json().catch(() => null) : null;
    return { ok: false, error: parsed?.error ?? error.message };
  }
  return data as RecoverAccessResult;
}
