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

export interface ChatDashboardKpis {
  chat_views: number;
  unique_chat_visitors: number;
  registered_chat_viewers: number;
  returning_chat_visitors: number;
  global_messages: number;
  global_unique_senders: number;
  registered_global_senders: number;
  guest_global_senders: number;
  avg_global_message_length: number | null;
  reactions: number;
  unique_reactors: number;
  hidden_global_messages: number;
  guest_created: number;
  guest_rewards_issued: number;
  guest_rewards_claimed: number;
  guest_reward_coins_issued: number;
  guest_reward_coins_claimed: number;
  signup_prompted: number;
  signup_started_visitors: number;
  signup_completed_visitors: number;
  first_scan_visitors: number;
  scan_cta_clicks: number;
  invite_clicks: number;
  members_opens: number;
  profile_opens: number;
  follow_clicks: number;
  private_inbox_opens: number;
  private_conversation_opens: number;
  private_requests: number;
  private_requests_accepted: number;
  private_requests_rejected: number;
  private_requests_cancelled: number;
  private_requests_pending: number;
  private_conversations_created: number;
  private_messages: number;
  private_unique_senders: number;
  private_active_conversations: number;
  avg_private_message_length: number | null;
  hidden_private_messages: number;
  blocks: number;
}

export interface ChatDashboardData {
  range: { start: string; end: string; timezone: string };
  kpis: ChatDashboardKpis;
  rates: {
    returning_visitor_rate: number;
    reactions_per_100_messages: number;
    messages_per_sender: number;
    private_accept_rate: number;
    private_response_rate: number;
    private_conversation_activation_rate: number;
    private_messages_per_active_conversation: number;
    guest_reward_claim_rate: number;
    chat_signup_completion_rate: number;
    chat_signup_to_first_scan_rate: number;
  };
  daily: Array<{
    day: string;
    views: number;
    unique_visitors: number;
    global_messages: number;
    private_messages: number;
    reactions: number;
    signup_completions: number;
    first_scans: number;
    private_requests: number;
  }>;
  hourly: Array<{ hour: number; views: number; global_messages: number; private_messages: number }>;
  top_global_users: Array<{ username: string; messages: number; hidden_messages: number }>;
  emojis: Array<{ emoji: string; count: number }>;
  signup_prompt_reasons: Array<{ reason: string; count: number }>;
}

export async function getAdminDashboard(start: Date, end: Date): Promise<AdminDashboardData> {
  if (!supabase) throw new Error('Supabase no está configurado');

  const { data, error } = await supabase.rpc('get_admin_dashboard', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (error) throw error;
  if (!data) throw new Error('No se recibieron estadísticas');
  return data as AdminDashboardData;
}

export async function getAdminChatDashboard(start: Date, end: Date): Promise<ChatDashboardData> {
  if (!supabase) throw new Error('Supabase no está configurado');

  const { data, error } = await supabase.rpc('get_admin_chat_dashboard', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (error) throw error;
  if (!data) throw new Error('No se recibieron estadísticas del chat');
  return data as ChatDashboardData;
}
