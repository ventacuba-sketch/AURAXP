import { supabase } from './supabaseClient';

export interface DashboardKpis {
  web_visits: number;
  web_unique_visitors: number;
  app_opens: number;
  active_users: number;
  landing_views: number;
  landing_unique_visitors: number;
  landing_cta_clicks: number;
  signup_starts: number;
  signup_completions: number;
  new_users: number;
  total_users: number;
  confirmed_users: number;
  first_scan_users: number;
  scan_starts: number;
  scan_completions: number;
  unique_scanners: number;
  done_scans: number;
  failed_scans: number;
  rejected_scans: number;
  processing_scans: number;
  avg_scan_seconds: number | null;
  avg_aura: number | null;
  best_aura: number | null;
  challenge_creations: number;
  challenge_acceptances: number;
  challenge_completions: number;
  shares: number;
  sharers: number;
  follows: number;
  gifts_sent: number;
  gifts_received: number;
  item_purchases: number;
  missions_completed: number;
  referrals_activated: number;
  pwa_installs: number;
  push_subscriptions: number;
  bug_reports: number;
  public_result_views: number;
  public_result_votes: number;
  public_battle_views: number;
  public_battle_votes: number;
  pro_checkout_opens: number;
  active_pro_users: number;
  new_pro_users: number;
  coins_earned: number;
  coins_spent: number;
  analytics_errors: number;
}

export interface DashboardDaily {
  day: string;
  web_visits: number;
  landing_views: number;
  cta_clicks: number;
  registrations: number;
  first_scans: number;
  scans: number;
  challenges: number;
  shares: number;
  active_users: number;
}

export interface DashboardSource {
  source: string;
  medium: string;
  campaign: string;
  visitors: number;
  attributed_users: number;
  signups: number;
  first_scanners: number;
  sharers: number;
}

export interface DashboardRecommendation {
  priority: 'high' | 'medium' | 'ok' | 'info';
  area: string;
  title: string;
  detail: string;
}

export interface AdminDashboardData {
  range: { start: string; end: string };
  kpis: DashboardKpis;
  rates: {
    landing_ctr: number;
    signup_completion_rate: number;
    signup_to_scan_rate: number;
    scan_completion_rate: number;
    challenge_accept_rate: number;
    share_rate: number;
  };
  daily: DashboardDaily[];
  sources: DashboardSource[];
  devices: Array<{ device: string; visitors: number }>;
  browsers: Array<{ browser: string; visitors: number }>;
  events: Array<{ event_name: string; count: number }>;
  recommendations: DashboardRecommendation[];
}

export async function getAdminDashboard(
  start: Date,
  end: Date,
): Promise<AdminDashboardData> {
  if (!supabase) throw new Error('Supabase no está configurado');

  const { data, error } = await supabase.rpc('get_admin_dashboard', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (error) throw error;
  if (!data) throw new Error('No se recibieron estadísticas');

  return data as AdminDashboardData;
}
