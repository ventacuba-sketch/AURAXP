import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

const STORAGE_KEY = 'auraxp_utm_params';
const VISITOR_KEY = 'auraxp_campaign_visitor_id';
const META_CONTEXT_KEY = 'auraxp_meta_context';
const VISITOR_COOKIE = 'auravs_vid';

export interface UtmParams { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string; }
export interface AttributionMetadata extends UtmParams { visitor_id: string; fbclid?: string; fbc?: string; fbp?: string; landing_ts?: string; user_agent?: string; }
export interface VisitContext extends UtmParams { visitor_id: string; referrer_host?: string; device_type?: string; browser?: string; os_name?: string; path?: string; }
const KEYS: (keyof UtmParams)[] = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const hit = document.cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
}
function writeVisitorCookie(value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${VISITOR_COOKIE}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
}
function newVisitorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
}
async function visitorId(): Promise<string> {
  let value = await AsyncStorage.getItem(VISITOR_KEY);
  if (!value && Platform.OS === 'web') value = readCookie(VISITOR_COOKIE);
  if (!value) value = newVisitorId();
  await AsyncStorage.setItem(VISITOR_KEY, value);
  if (Platform.OS === 'web') writeVisitorCookie(value);
  return value;
}
export async function getCampaignVisitorId(): Promise<string | null> { if (Platform.OS !== 'web') return null; try { return await visitorId(); } catch { return null; } }

function detectDevice(): string { if (typeof navigator === 'undefined') return 'unknown'; const ua=navigator.userAgent.toLowerCase(); if (/ipad|tablet/.test(ua)) return 'tablet'; if (/mobile|iphone|android/.test(ua)) return 'mobile'; return 'desktop'; }
function detectBrowser(): string { if (typeof navigator === 'undefined') return 'unknown'; const ua=navigator.userAgent; if (/FBAN|FBAV|Instagram/i.test(ua)) return 'Meta In-App'; if (/edg\//i.test(ua)) return 'Edge'; if (/opr\//i.test(ua)) return 'Opera'; if (/chrome\//i.test(ua)&&!/edg\//i.test(ua)) return 'Chrome'; if (/safari\//i.test(ua)&&!/chrome\//i.test(ua)) return 'Safari'; if (/firefox\//i.test(ua)) return 'Firefox'; return 'Other'; }
function detectOs(): string { if (typeof navigator === 'undefined') return 'unknown'; const ua=navigator.userAgent; if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'; if (/android/i.test(ua)) return 'Android'; if (/mac os x/i.test(ua)) return 'macOS'; if (/windows/i.test(ua)) return 'Windows'; if (/linux/i.test(ua)) return 'Linux'; return 'Other'; }
function referrerHost(): string|undefined { if (typeof document==='undefined'||!document.referrer) return undefined; try { return new URL(document.referrer).hostname.replace(/^www\./,''); } catch { return undefined; } }

export async function captureWebVisit(): Promise<VisitContext|null> {
  if (Platform.OS !== 'web'||typeof window==='undefined') return null;
  try {
    const q=new URLSearchParams(window.location.search); const utm:UtmParams={};
    for (const key of KEYS) { const value=q.get(key); if(value) utm[key]=value; }
    const id=await visitorId();
    const storedUtm=await getStoredUtmParams();
    const mergedUtm={...(storedUtm??{}),...utm};
    if(Object.keys(mergedUtm).length) await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(mergedUtm));
    const fbclid=q.get('fbclid')??undefined;
    const existingRaw=await AsyncStorage.getItem(META_CONTEXT_KEY); const existing=existingRaw?JSON.parse(existingRaw):{};
    const landingTs=existing.landing_ts??new Date().toISOString();
    // First-touch fbc: prefer what we already captured, then Meta's _fbc cookie,
    // and only synthesize from fbclid when neither exists. Never regenerate it.
    const fbc=existing.fbc??readCookie('_fbc')??(fbclid?`fb.1.${Date.now()}.${fbclid}`:undefined);
    const fbp=readCookie('_fbp')??existing.fbp;
    const meta={...existing,...mergedUtm,...(fbclid&&!existing.fbclid?{fbclid}:{}),...(fbc?{fbc}:{}),...(fbp?{fbp}:{}),landing_ts:landingTs,user_agent:navigator.userAgent};
    await AsyncStorage.setItem(META_CONTEXT_KEY,JSON.stringify(meta));
    const context:VisitContext={...mergedUtm,visitor_id:id,referrer_host:referrerHost(),device_type:detectDevice(),browser:detectBrowser(),os_name:detectOs(),path:window.location.pathname};
    if(supabase) await supabase.rpc('capture_campaign_attribution',{p_visitor_id:id,p_source:mergedUtm.utm_source??null,p_medium:mergedUtm.utm_medium??null,p_campaign:mergedUtm.utm_campaign??null,p_content:mergedUtm.utm_content??null,p_term:mergedUtm.utm_term??null,p_path:window.location.pathname,p_referrer_host:context.referrer_host??null,p_device_type:context.device_type??null,p_browser:context.browser??null,p_os_name:context.os_name??null});
    return context;
  } catch { return null; }
}
export function captureUtmFromUrl():void { void captureWebVisit(); }
export async function getStoredUtmParams():Promise<UtmParams|null>{try{const value=await AsyncStorage.getItem(STORAGE_KEY);return value?JSON.parse(value):null;}catch{return null;}}
export async function getAttributionMetadata():Promise<AttributionMetadata|null>{
  if(Platform.OS!=='web') return null;
  try { const id=await visitorId(); const utm=await getStoredUtmParams(); const raw=await AsyncStorage.getItem(META_CONTEXT_KEY); const meta=raw?JSON.parse(raw):{}; return {visitor_id:id,...(utm??{}),...meta}; } catch { return null; }
}
export async function linkCampaignToCurrentUser():Promise<void>{try{if(Platform.OS!=='web'||!supabase)return;const params=await getStoredUtmParams();const id=await visitorId();await supabase.rpc('capture_campaign_attribution',{p_visitor_id:id,p_source:params?.utm_source??null,p_medium:params?.utm_medium??null,p_campaign:params?.utm_campaign??null,p_content:params?.utm_content??null,p_term:params?.utm_term??null,p_path:typeof window!=='undefined'?window.location.pathname:null,p_referrer_host:referrerHost()??null,p_device_type:detectDevice(),p_browser:detectBrowser(),p_os_name:detectOs()});}catch{}}
export async function getVisitorId():Promise<string>{return visitorId();}
