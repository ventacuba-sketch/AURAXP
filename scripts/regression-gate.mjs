import fs from 'node:fs';
const checks=[
 ['src/services/challengeService.ts',[/create_direct_challenge/,/respond_direct_challenge/,/accept_challenge/,/expire_stale_challenges/,/targetUsername/]],
 ['src/services/publicAuraService.ts',[/create_scan_public_share/,/get_public_scan_result/,/vote_public_scan_result/]],
 ['src/services/publicBattleService.ts',[/get_public_battle_result/,/vote_public_battle/]],
 ['src/navigation/RootNavigator.tsx',[/PublicResult/,/PublicBattle/,/"r\/:token"|'r\/:token'/,/"b\/:token"|'b\/:token'/]],
 ['src/screens/ScanResultScreen.tsx',[/createPublicAuraShare/,/publicAuraUrl/]],
 ['src/screens/ChallengeScreen.tsx',[/publicBattleUrl/,/COMPARTIR RESULTADO/,/rematchTargetUsername/,/Esperando a @/]],
 ['src/screens/MyChallengesScreen.tsx',[/rematchTargetUsername/]],
 ['src/screens/AnalyzingScreen.tsx',[/rematchTargetUsername/,/createDirectChallenge/]],
 ['src/types/index.ts',[/rematchTargetUsername/,/targetUsername/,/LiveRoom: \{ slug: string \}/,/LiveCreate: undefined/]],
 ['src/services/analyticsService.ts',[/signup_viewed/,/scan_started/,/scan_completed/,/public_battle_voted/,/live_joined/,/live_ended/,/live_left/,/live_reconnect/,/live_guest_converted/]],
 ['src/components/WebMobileFrame.tsx',[/pathname\.startsWith\('\/chat'\)/,/desktopOuter/]],
 ['App.tsx',[/AuthenticatedAppShell/,/RootNavigator key=\{identityKey\}/]],
 // AURA LIVE -- sección 36 del pedido.
 ['src/navigation/RootNavigator.tsx',[/LiveRoom/,/LiveCreate/,/'live\/:slug'|"live\/:slug"/]],
 ['supabase/functions/livekit-token/index.ts',[/host_user_id/,/canPublish: isHost/,/canSubscribe: true/]],
 ['supabase/migrations/20261004000000_aura_live_mvp.sql',[/v_can_host is not true/,/live_rooms_select_all/,/for select using \(true\)/,/v_uid uuid := \(select auth\.uid\(\)\)/]],
 ['src/services/liveMediaService.web.ts',[/pub\.track\?\.stop\(\)/]],
];
let bad=[];
for(const [file,patterns] of checks){if(!fs.existsSync(file)){bad.push(file+' missing');continue;}const s=fs.readFileSync(file,'utf8');for(const p of patterns)if(!p.test(s))bad.push(file+' missing '+p);}

// AURA LIVE -- el secret de LiveKit jamás puede aparecer en código de
// cliente (sección 6/36: "secret no frontend"). Chequeo de AUSENCIA, no
// de presencia -- a diferencia del resto de este archivo, acá un match
// es el FALLO. Recorre src/ entero (nunca supabase/functions/, que SÍ
// puede y debe usar el secret real -- ver livekit-token/livekit-webhook).
function walk(dir){
  let out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=dir+'/'+entry.name;
    if(entry.isDirectory()) out=out.concat(walk(p));
    else if(/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}
if(fs.existsSync('src')){
  for(const file of walk('src')){
    const s=fs.readFileSync(file,'utf8');
    if(/LIVEKIT_API_SECRET/.test(s)) bad.push(file+' leaks LIVEKIT_API_SECRET into frontend code');
  }
}

if(bad.length){console.error('REGRESSION GATE FAILED\n'+bad.join('\n'));process.exit(1);}
console.log('Critical frontend + battle + Chat V2 + AURA LIVE contracts OK:',checks.length,'files');
