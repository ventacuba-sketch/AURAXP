import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export type PublicBattleResult = {
  challengeId:string; creatorUsername:string; creatorAvatarEmoji:string; creatorScore:number;
  opponentUsername:string; opponentAvatarEmoji:string; opponentScore:number;
  aiWinner:'creator'|'opponent'|'tie'; creatorVotes:number; opponentVotes:number;
};
function firstRow<T>(data:T|T[]|null):T|null { if(!data)return null; return Array.isArray(data)?(data[0]??null):data; }
async function voterKey(){ const k='aura_public_voter_key_v1'; let v=await AsyncStorage.getItem(k); if(!v){v='v_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); await AsyncStorage.setItem(k,v);} return v; }
export async function fetchPublicBattle(token:string):Promise<PublicBattleResult|null>{
  if(!isSupabaseConfigured||!supabase)return null;
  const {data,error}=await supabase.rpc('get_public_battle_result',{p_token:token}); if(error)throw error;
  const r:any=firstRow(data as any); if(!r)return null;
  return {challengeId:r.challenge_id,creatorUsername:r.creator_username,creatorAvatarEmoji:r.creator_avatar_emoji??'⚡',creatorScore:Number(r.creator_score??0),opponentUsername:r.opponent_username,opponentAvatarEmoji:r.opponent_avatar_emoji??'⚡',opponentScore:Number(r.opponent_score??0),aiWinner:r.ai_winner,creatorVotes:Number(r.creator_votes??0),opponentVotes:Number(r.opponent_votes??0)};
}
export async function votePublicBattle(token:string,vote:'creator'|'opponent'){
  if(!isSupabaseConfigured||!supabase)throw new Error('Supabase no configurado');
  const {data,error}=await supabase.rpc('vote_public_battle',{p_token:token,p_vote:vote,p_voter_key:await voterKey()}); if(error)throw error;
  const r:any=firstRow(data as any); return {creatorVotes:Number(r?.creator_votes??0),opponentVotes:Number(r?.opponent_votes??0)};
}
export function publicBattleUrl(token:string){return `https://auravs.app/b/${encodeURIComponent(token)}`;}
