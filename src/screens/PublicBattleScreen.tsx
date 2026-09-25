import React,{useEffect,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,View} from 'react-native';
import {RouteProp,useRoute} from '@react-navigation/native';
import {Card} from '../components/Card';
import {PrimaryButton} from '../components/PrimaryButton';
import {ScreenContainer} from '../components/ScreenContainer';
import {useCurrentUser} from '../hooks/useCurrentUser';
import {useRootNavigation} from '../hooks/useRootNavigation';
import {logEvent} from '../services/analyticsService';
import {fetchPublicBattle,PublicBattleResult,votePublicBattle} from '../services/publicBattleService';
import {colors,spacing,typography} from '../theme/colors';
import {RootStackParamList} from '../types';
import {formatSignedXP} from '../utils/format';
type R=RouteProp<RootStackParamList,'PublicBattle'>;
export default function PublicBattleScreen(){
 const {params}=useRoute<R>(); const nav=useRootNavigation(); const {user}=useCurrentUser();
 const [battle,setBattle]=useState<PublicBattleResult|null>(null); const [loading,setLoading]=useState(true); const [voting,setVoting]=useState(false); const [voted,setVoted]=useState(false);
 useEffect(()=>{fetchPublicBattle(params.token).then(r=>{setBattle(r);if(r)logEvent('public_battle_viewed',{challenge_id:r.challengeId});}).finally(()=>setLoading(false));},[params.token]);
 async function vote(choice:'creator'|'opponent'){if(!battle||voting)return;setVoting(true);try{const counts=await votePublicBattle(params.token,choice);setBattle({...battle,...counts});setVoted(true);logEvent('public_battle_voted',{challenge_id:battle.challengeId,vote:choice});}finally{setVoting(false);}}
 if(loading)return <ScreenContainer style={s.center}><ActivityIndicator color={colors.accent} size="large"/></ScreenContainer>;
 if(!battle)return <ScreenContainer style={s.center}><Text style={s.body}>Esta batalla ya no está disponible.</Text></ScreenContainer>;
 const total=battle.creatorVotes+battle.opponentVotes; const cp=total?Math.round(battle.creatorVotes/total*100):0; const op=total?100-cp:0;
 const ai=battle.aiWinner==='tie'?'EMPATE':battle.aiWinner==='creator'?'@'+battle.creatorUsername:'@'+battle.opponentUsername;
 const people=total===0?'AÚN SIN VOTOS':battle.creatorVotes===battle.opponentVotes?'EMPATE':battle.creatorVotes>battle.opponentVotes?'@'+battle.creatorUsername:'@'+battle.opponentUsername;
 return <ScreenContainer scroll style={s.screen}>
  <Text style={s.wordmark}>AURA VS</Text><Text style={s.title}>⚔️ BATALLA DE AURA</Text>
  <View style={s.row}><Card style={s.side}><Text style={s.avatar}>{battle.creatorAvatarEmoji}</Text><Text style={s.user}>@{battle.creatorUsername}</Text><Text style={s.score}>{formatSignedXP(battle.creatorScore)}</Text><Text style={s.aura}>AURA</Text></Card><Text style={s.vs}>VS</Text><Card style={s.side}><Text style={s.avatar}>{battle.opponentAvatarEmoji}</Text><Text style={s.user}>@{battle.opponentUsername}</Text><Text style={s.score}>{formatSignedXP(battle.opponentScore)}</Text><Text style={s.aura}>AURA</Text></Card></View>
  <Card style={s.verdict}><Text style={s.label}>LA IA ELIGIÓ</Text><Text style={s.winner}>{ai}</Text><Text style={s.label}>LA GENTE ELIGE</Text><Text style={s.winner}>{people}</Text></Card>
  <Text style={s.prompt}>¿QUIÉN TIENE MÁS AURA?</Text>
  <View style={s.buttons}><View style={s.flex}><PrimaryButton label={'⚡ @'+battle.creatorUsername} disabled={voting} onPress={()=>vote('creator')}/></View><View style={s.flex}><PrimaryButton label={'⚡ @'+battle.opponentUsername} variant="ghost" disabled={voting} onPress={()=>vote('opponent')}/></View></View>
  <Text style={s.counts}>{total?`${cp}% @${battle.creatorUsername} · ${op}% @${battle.opponentUsername} · ${total} votos`:'Sé el primero en votar'}</Text>
  {voted&&<Card style={s.cta}><Text style={s.ctaTitle}>¿Y TÚ CUÁNTA AURA TIENES?</Text><Text style={s.body}>Graba 8 segundos. La IA decide.</Text><PrimaryButton label="⚡ MEDIR MI AURA GRATIS" onPress={()=>{logEvent('public_battle_cta_clicked',{challenge_id:battle.challengeId}); user?nav.navigate('Upload'):nav.navigate('Auth',{initialMode:'signUp',context:'measure_aura'});}}/></Card>}
 </ScreenContainer>;
}
const s=StyleSheet.create({screen:{paddingTop:spacing.xl},center:{alignItems:'center',justifyContent:'center'},wordmark:{...typography.eyebrow,color:colors.secondary,textAlign:'center'},title:{...typography.hero,color:colors.textPrimary,textAlign:'center',marginVertical:spacing.lg},row:{flexDirection:'row',alignItems:'center',gap:spacing.sm},side:{flex:1,alignItems:'center'},avatar:{fontSize:36},user:{...typography.subtitle,color:colors.textPrimary,textAlign:'center'},score:{...typography.display,color:colors.accent},aura:{...typography.eyebrow,color:colors.textMuted},vs:{...typography.title,color:colors.secondary},verdict:{marginTop:spacing.lg,alignItems:'center',gap:spacing.xs},label:{...typography.eyebrow,color:colors.textMuted},winner:{...typography.title,color:colors.accent,marginBottom:spacing.sm},prompt:{...typography.title,color:colors.textPrimary,textAlign:'center',marginTop:spacing.xl,marginBottom:spacing.sm},buttons:{flexDirection:'row',gap:spacing.sm},flex:{flex:1},counts:{...typography.caption,color:colors.textSecondary,textAlign:'center',marginTop:spacing.sm,marginBottom:spacing.xl},cta:{gap:spacing.md,borderColor:colors.secondary},ctaTitle:{...typography.title,color:colors.textPrimary,textAlign:'center'},body:{...typography.body,color:colors.textSecondary,textAlign:'center'}});
