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
 ['src/types/index.ts',[/rematchTargetUsername/,/targetUsername/]],
 ['src/services/analyticsService.ts',[/signup_viewed/,/scan_started/,/scan_completed/,/public_battle_voted/]],
 ['src/components/WebMobileFrame.tsx',[/pathname\.startsWith\('\/chat'\)/,/desktopOuter/]],
 ['App.tsx',[/AuthenticatedAppShell/,/RootNavigator key=\{identityKey\}/]]
];
let bad=[];
for(const [file,patterns] of checks){if(!fs.existsSync(file)){bad.push(file+' missing');continue;}const s=fs.readFileSync(file,'utf8');for(const p of patterns)if(!p.test(s))bad.push(file+' missing '+p);}
if(bad.length){console.error('REGRESSION GATE FAILED\n'+bad.join('\n'));process.exit(1);}
console.log('Critical frontend + battle + Chat V2 contracts OK:',checks.length,'files');
