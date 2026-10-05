import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const platforms=['facebook','instagram','tiktok'] as const;
type Platform=(typeof platforms)[number];

Deno.serve(async(req)=>{
 if(req.method!=='POST') return json({ok:false,error:'method_not_allowed'},405);
 const auth=req.headers.get('authorization');
 if(!auth) return json({ok:false,error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user},error}=await userClient.auth.getUser();
 if(error||!user) return json({ok:false,error:'unauthorized'},401);
 const admin=createClient(url,service);
 const body=await req.json().catch(()=>({}));
 const action=String(body.action||'list');
 if(action==='list'){
   const {data,error:e}=await admin.from('social_connections').select('platform,status,external_account_name,connected_at,token_expires_at,last_error_code,updated_at').eq('user_id',user.id).order('platform');
   if(e) return json({ok:false,error:'list_failed'},500);
   return json({ok:true,connections:data??[]});
 }
 const platform=String(body.platform||'') as Platform;
 if(!platforms.includes(platform)) return json({ok:false,error:'invalid_platform'},400);
 if(action==='disconnect'){
   const {error:e}=await admin.from('social_connections').upsert({user_id:user.id,platform,status:'revoked',connected_at:null,last_error_code:null,updated_at:new Date().toISOString()},{onConflict:'user_id,platform'});
   return e?json({ok:false,error:'disconnect_failed'},500):json({ok:true});
 }
 if(action==='begin') return json({ok:false,error:'provider_not_configured',platform},409);
 return json({ok:false,error:'invalid_action'},400);
});
