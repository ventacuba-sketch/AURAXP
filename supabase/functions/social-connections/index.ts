import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders,'content-type':'application/json'}});
const platforms=['facebook','instagram','tiktok'] as const; type Platform=(typeof platforms)[number];
const hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
 const auth=req.headers.get('authorization'); if(!auth)return json({ok:false,error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const uc=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user},error}=await uc.auth.getUser(); if(error||!user)return json({ok:false,error:'unauthorized'},401);
 const admin=createClient(url,service); const body=await req.json().catch(()=>({})); const action=String(body.action||'list');
 if(action==='list'){
  const {data,error:e}=await admin.from('social_connections').select('platform,status,external_account_name,connected_at,token_expires_at,last_error_code,updated_at').eq('user_id',user.id).order('platform');
  return e?json({ok:false,error:'list_failed'},500):json({ok:true,connections:data??[]});
 }
 const platform=String(body.platform||'') as Platform; if(!platforms.includes(platform))return json({ok:false,error:'invalid_platform'},400);
 if(action==='disconnect'){
  await admin.from('social_connection_secrets').delete().eq('user_id',user.id).eq('platform',platform);
  const {error:e}=await admin.from('social_connections').upsert({user_id:user.id,platform,status:'revoked',connected_at:null,last_error_code:null,updated_at:new Date().toISOString()},{onConflict:'user_id,platform'});
  return e?json({ok:false,error:'disconnect_failed'},500):json({ok:true});
 }
 if(action==='begin'){
  if(platform!=='facebook')return json({ok:false,error:'provider_not_configured',platform},409);
  const appId=Deno.env.get('META_APP_ID'); if(!appId)return json({ok:false,error:'provider_not_configured',platform},409);
  const raw=crypto.randomUUID()+crypto.randomUUID(); const stateHash=await hex(raw); const expires=new Date(Date.now()+10*60*1000).toISOString();
  const {error:e}=await admin.from('social_oauth_states').insert({state_hash:stateHash,user_id:user.id,platform,expires_at:expires}); if(e)return json({ok:false,error:'state_create_failed'},500);
  const redirect=`${url}/functions/v1/social-oauth-callback`; const au=new URL('https://www.facebook.com/v24.0/dialog/oauth');
  au.searchParams.set('client_id',appId); au.searchParams.set('redirect_uri',redirect); au.searchParams.set('state',raw); au.searchParams.set('scope','public_profile'); au.searchParams.set('response_type','code');
  return json({ok:true,authorizeUrl:au.toString()});
 }
 return json({ok:false,error:'invalid_action'},400);
});