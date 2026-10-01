import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

const STORAGE_KEY = 'auraxp_utm_params';
const VISITOR_KEY = 'auraxp_campaign_visitor_id';

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export interface VisitContext extends UtmParams {
  visitor_id: string;
  referrer_host?: string;
  device_type?: string;
  browser?: string;
  os_name?: string;
  path?: string;
}

const KEYS: (keyof UtmParams)[] = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

async function visitorId(): Promise<string> {
  let value = await AsyncStorage.getItem(VISITOR_KEY);
  if (!value) {
    value = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    await AsyncStorage.setItem(VISITOR_KEY, value);
  }
  return value;
}

export async function getCampaignVisitorId(): Promise<string | null> {
  if (Platform.OS !== 'web') return null;
  try {
    return await visitorId();
  } catch {
    return null;
  }
}

function detectDevice(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|iphone|android/.test(ua)) return 'mobile';
  return 'desktop';
}

function detectBrowser(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\//i.test(ua)) return 'Opera';
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return 'Safari';
  if (/firefox\//i.test(ua)) return 'Firefox';
  return 'Other';
}

function detectOs(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function referrerHost(): string | undefined {
  if (typeof document === 'undefined' || !document.referrer) return undefined;
  try {
    return new URL(document.referrer).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * Reemplaza al viejo captureUtmFromUrl: antes solo se guardaba algo si la
 * URL traía utm_*, dejando sin atribuir todo el tráfico orgánico/directo.
 * Ahora corre SIEMPRE (haya o no utm_*) y además manda referrer/device/
 * browser/os -- lo que necesita el admin dashboard para desglosar fuente/
 * dispositivo/navegador (ver capture_campaign_attribution, migración
 * 20260930100000_admin_analytics_dashboard_v2.sql).
 */
export async function captureWebVisit(): Promise<VisitContext | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;

  try {
    const q = new URLSearchParams(window.location.search);
    const utm: UtmParams = {};
    for (const key of KEYS) {
      const value = q.get(key);
      if (value) utm[key] = value;
    }

    const id = await visitorId();
    if (Object.keys(utm).length) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(utm));
    }

    const context: VisitContext = {
      ...utm,
      visitor_id: id,
      referrer_host: referrerHost(),
      device_type: detectDevice(),
      browser: detectBrowser(),
      os_name: detectOs(),
      path: window.location.pathname,
    };

    if (supabase) {
      await supabase.rpc('capture_campaign_attribution', {
        p_visitor_id: id,
        p_source: utm.utm_source ?? null,
        p_medium: utm.utm_medium ?? null,
        p_campaign: utm.utm_campaign ?? null,
        p_content: utm.utm_content ?? null,
        p_term: utm.utm_term ?? null,
        p_path: window.location.pathname,
        p_referrer_host: context.referrer_host ?? null,
        p_device_type: context.device_type ?? null,
        p_browser: context.browser ?? null,
        p_os_name: context.os_name ?? null,
      });
    }

    return context;
  } catch {
    return null;
  }
}

/** Backward-compatible entry point used by the existing boot flow. */
export function captureUtmFromUrl(): void {
  void captureWebVisit();
}

export async function getStoredUtmParams(): Promise<UtmParams | null> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

/**
 * Re-liga la atribución guardada (utm + device/browser/os) a la cuenta ya
 * autenticada -- llamarlo UNA sola vez por sesión nueva (ver el efecto de
 * sesión en RootNavigator.tsx), nunca desde logEvent(): cada llamada es un
 * RPC completo, así que hacerlo en cada evento de analítica multiplicaría
 * las llamadas a Supabase sin ganar ningún dato nuevo en las repeticiones
 * (hallazgo H1 de la auditoría del dashboard de admin).
 */
export async function linkCampaignToCurrentUser(): Promise<void> {
  try {
    if (Platform.OS !== 'web' || !supabase) return;
    const params = await getStoredUtmParams();
    const id = await visitorId();
    await supabase.rpc('capture_campaign_attribution', {
      p_visitor_id: id,
      p_source: params?.utm_source ?? null,
      p_medium: params?.utm_medium ?? null,
      p_campaign: params?.utm_campaign ?? null,
      p_content: params?.utm_content ?? null,
      p_term: params?.utm_term ?? null,
      p_path: typeof window !== 'undefined' ? window.location.pathname : null,
      p_referrer_host: referrerHost() ?? null,
      p_device_type: detectDevice(),
      p_browser: detectBrowser(),
      p_os_name: detectOs(),
    });
  } catch {
    // Attribution is telemetry; it must never break the app.
  }
}
