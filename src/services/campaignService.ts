import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

const STORAGE_KEY='auraxp_utm_params';
const VISITOR_KEY='auraxp_campaign_visitor_id';
export interface UtmParams {utm_source?:string;utm_medium?:string;utm_campaign?:string;utm_content?:string;utm_term?:string;}
const KEYS:(keyof UtmParams)[]=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
async function visitorId(){let v=await AsyncStorage.getItem(VISITOR_KEY);if(!v){v='v_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);await AsyncStorage.setItem(VISITOR_KEY,v);}return v;}
export function captureUtmFromUrl():void{
 if(Platform.OS!=='web'||typeof window==='undefined')return;
 try{const q=new URLSearchParams(window.location.search);const p:UtmParams={};for(const k of KEYS){const v=q.get(k);if(v)p[k]=v;}if(!Object.keys(p).length)return;
 AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(p)).then(async()=>{if(!supabase)return;const id=await visitorId();await supabase.rpc('capture_campaign_attribution',{p_visitor_id:id,p_source:p.utm_source??null,p_medium:p.utm_medium??null,p_campaign:p.utm_campaign??null,p_content:p.utm_content??null,p_term:p.utm_term??null,p_path:window.location.pathname});});}catch{}
}
export async function getStoredUtmParams():Promise<UtmParams|null>{try{const r=await AsyncStorage.getItem(STORAGE_KEY);return r?JSON.parse(r):null;}catch{return null;}}
export async function linkCampaignToCurrentUser():Promise<void>{try{if(!supabase)return;const p=await getStoredUtmParams();if(!p)return;const id=await visitorId();await supabase.rpc('capture_campaign_attribution',{p_visitor_id:id,p_source:p.utm_source??null,p_medium:p.utm_medium??null,p_campaign:p.utm_campaign??null,p_content:p.utm_content??null,p_term:p.utm_term??null,p_path:null});}catch{}}
