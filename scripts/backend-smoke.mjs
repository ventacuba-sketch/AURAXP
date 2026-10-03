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
// Public battle voting is intentionally anonymous. A missing battle and an invalid vote must fail cleanly,
// proving the RPC exists and validates input without mutating a real battle.
await rpc('vote_public_battle',{p_token:'__smoke_missing__',p_vote:'creator',p_voter_key:'smoke-voter-key'},[400]);
await rpc('vote_public_battle',{p_token:'__smoke_missing__',p_vote:'invalid',p_voter_key:'smoke-voter-key'},[400]);
// Auth-only RPCs called anonymously must fail cleanly or return their controlled not_authenticated result.
await rpc('create_direct_challenge',{p_source_scan_id:'00000000-0000-0000-0000-000000000000',p_target_username:'__smoke__'},[200,401,403]);
await rpc('accept_challenge',{p_share_token:'__smoke_missing__'},[200,401,403]);
await rpc('respond_direct_challenge',{p_challenge_id:'00000000-0000-0000-0000-000000000000',p_accept:true},[200,401,403]);
await rpc('expire_stale_challenges',{},[200,401,403]);

// AURA LIVE (sección 37) -- la migración 20261004000000_aura_live_mvp.sql
// TODAVÍA NO está aplicada al proyecto real a propósito (ver
// docs/aura-live.md -- "no apliques migraciones a producción" manda sobre
// "agrega smoke tests para los RPC nuevos"). Por eso este bloque es
// BEST-EFFORT, no un gate duro: una falla acá se loguea como advertencia
// y nunca bloquea el deploy de Preview (que sigue sirviendo Chat V2/
// Battles/etc., features ya reales, sin relación con que AURA LIVE tenga
// su migración aplicada o no). Una vez que `supabase db push` corra de
// verdad, conviene revisar este log y, si hace falta, volver esto un
// throw real -- por ahora, exactamente los códigos esperados quedan
// documentados en cada comentario para esa revisión futura. Ninguno de
// estos checks crea un LIVE real ni toca una cuenta real: ids inventados/
// fijos, título literal '__smoke__'.
async function restGet(path,allowed){
 const r=await fetch(url+'/rest/v1/'+path,{headers:h});
 const t=await r.text();
 if(!allowed.includes(r.status)) throw new Error(path+' HTTP '+r.status+' '+t.slice(0,300));
 if(/column reference .* ambiguous/i.test(t)) throw new Error(path+' ambiguous SQL: '+t);
 console.log(path,'OK',r.status);
}
async function bestEffort(label,fn){
 try{ await fn(); }
 catch(e){ console.warn('AURA LIVE smoke (best-effort, not blocking):',label,String(e&&e.message||e)); }
}
// Listar LIVE públicos + slug inexistente: 200 con un array (posiblemente
// vacío) una vez desplegado; 404 (PGRST205, tabla ausente) mientras no lo
// esté -- nunca un error de SQL/parser real.
await bestEffort('list live_rooms',()=>restGet('live_rooms?select=id,slug,status,title&status=eq.live&limit=5',[200,404]));
await bestEffort('missing slug',()=>restGet('live_rooms?select=id&slug=eq.__smoke_missing_slug__',[200,404]));
// Token sin sesión ni guestId: 400 (falta guestId, caso real desplegado y
// configurado), 503 (función desplegada pero LIVEKIT_API_KEY/SECRET
// todavía no son secrets reales -- estado intermedio esperado del
// rollout), 404 (función todavía no desplegada). Nunca 200 -- sin
// guestId jamás debe emitir un token, y nunca se crea una sala real acá.
await bestEffort('livekit-token (no room/guestId)',async()=>{
 const r=await fetch(url+'/functions/v1/livekit-token',{method:'POST',headers:h,body:JSON.stringify({roomId:'00000000-0000-0000-0000-000000000000'})});
 if(![400,404,503].includes(r.status)) throw new Error('livekit-token HTTP '+r.status+' '+(await r.text()).slice(0,300));
 console.log('livekit-token (no room) OK',r.status);
});
// Host sin permiso / comentario anónimo: auth-only, anon debe fallar
// limpio (401/403) o -- antes de desplegar la migración -- 404.
await bestEffort('create_live_room (anon)',()=>rpc('create_live_room',{p_title:'__smoke__'},[200,401,403,404]));
await bestEffort('send_live_comment (anon)',()=>rpc('send_live_comment',{p_room_id:'00000000-0000-0000-0000-000000000000',p_body:'__smoke__'},[200,401,403,404]));
// send_live_reaction (auditoría GPT hallazgo #5): sin guestId y sin
// sesión, debe fallar limpio con 'guest_id_required' (200, ok:false) o
// 404 si la migración todavía no está aplicada -- NUNCA un 500 de SQL
// roto, y nunca toca una sala real (room_id inventado).
await bestEffort('send_live_reaction (anon, no guestId)',()=>rpc('send_live_reaction',{p_room_id:'00000000-0000-0000-0000-000000000000',p_emoji:'🔥'},[200,404]));

console.log('Production backend + battle contracts OK (AURA LIVE checks are best-effort until the migration is deployed)');
