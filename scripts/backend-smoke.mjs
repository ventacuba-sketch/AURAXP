const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;
if(!url||!key) throw new Error('Missing Supabase smoke-test secrets');
const h={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function rpc(name,body,allowed){
 const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:h,body:JSON.stringify(body)});
 const t=await r.text();
 if(!allowed.includes(r.status)) throw new Error(name+' HTTP '+r.status+' '+t.slice(0,300));
 if(/column reference .* ambiguous/i.test(t)) throw new Error(name+' ambiguous SQL: '+t);
 console.log(name,'OK',r.status);
}
// Public RPCs: fake tokens must return clean empty/not-found behavior, never SQL/parser failures.
await rpc('get_public_scan_result',{p_token:'__smoke_missing__'},[200]);
await rpc('get_public_battle_result',{p_token:'__smoke_missing__'},[200]);
// Auth-only RPCs called anonymously must fail cleanly or return their controlled not_authenticated result.
await rpc('create_direct_challenge',{p_source_scan_id:'00000000-0000-0000-0000-000000000000',p_target_username:'__smoke__'},[200,401,403]);
await rpc('accept_challenge',{p_share_token:'__smoke_missing__'},[200,401,403]);
console.log('Production backend contracts OK');
