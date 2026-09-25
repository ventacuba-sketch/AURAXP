import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { fetchPublicAuraResult, PublicAuraResult, votePublicAuraResult } from '../services/publicAuraService';
import { colors, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';
import { formatSignedXP } from '../utils/format';

type PublicResultRoute = RouteProp<RootStackParamList, 'PublicResult'>;

export default function PublicResultScreen() {
  const { params } = useRoute<PublicResultRoute>();
  const navigation = useRootNavigation();
  const [result, setResult] = useState<PublicAuraResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState<'more' | 'less' | null>(null);

  useEffect(() => {
    fetchPublicAuraResult(params.token)
      .then((r) => {
        setResult(r);
        if (r) logEvent('public_result_viewed', { share_id: r.shareId });
      })
      .finally(() => setLoading(false));
  }, [params.token]);

  async function vote(choice: 'more' | 'less') {
    if (!result || voting) return;
    setVoting(true);
    try {
      const counts = await votePublicAuraResult(params.token, choice);
      setResult({ ...result, ...counts });
      setVoted(choice);
      logEvent('public_result_voted', { share_id: result.shareId, vote: choice });
    } finally {
      setVoting(false);
    }
  }

  if (loading) return <ScreenContainer style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></ScreenContainer>;
  if (!result) return <ScreenContainer style={styles.center}><Text style={styles.body}>Este resultado ya no está disponible.</Text></ScreenContainer>;

  const total = result.moreVotes + result.lessVotes;
  const morePct = total ? Math.round((result.moreVotes / total) * 100) : 0;
  const lessPct = total ? 100 - morePct : 0;

  return (
    <ScreenContainer scroll style={styles.screen}>
      <Text style={styles.wordmark}>AURA VS</Text>
      <Text style={styles.question}>¿LA IA ACERTÓ? 👀</Text>
      <Card style={styles.card}>
        <Text style={styles.user}>{result.avatarEmoji} @{result.username}</Text>
        <Text style={styles.score}>{formatSignedXP(result.auraScore)} AURA</Text>
        <Text style={styles.tag}>{result.verdictTag}</Text>
        <Text style={styles.body}>{result.verdictHeadline}</Text>
      </Card>

      <Text style={styles.prompt}>TÚ DECIDES</Text>
      <View style={styles.voteRow}>
        <View style={styles.voteButton}><PrimaryButton label="⚡ MÁS AURA" disabled={voting} onPress={() => vote('more')} /></View>
        <View style={styles.voteButton}><PrimaryButton label="👎 MENOS AURA" variant="ghost" disabled={voting} onPress={() => vote('less')} /></View>
      </View>
      <Text style={styles.counts}>{total ? `${morePct}% Más Aura · ${lessPct}% Menos Aura · ${total} votos` : 'Sé el primero en votar'}</Text>

      {voted && (
        <Card style={styles.ctaCard}>
          <Text style={styles.ctaTitle}>¿Y TÚ CUÁNTA AURA TIENES?</Text>
          <Text style={styles.body}>Graba 8 segundos y deja que la IA lo decida.</Text>
          <PrimaryButton label="⚡ MEDIR MI AURA GRATIS" onPress={() => {
            logEvent('public_vote_cta_clicked', { share_id: result.shareId });
            navigation.navigate('Auth', { initialMode: 'signUp', context: 'measure_aura' });
          }} />
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen:{paddingTop:spacing.xl},
  center:{alignItems:'center',justifyContent:'center'},
  wordmark:{...typography.eyebrow,color:colors.secondary,textAlign:'center',marginBottom:spacing.md},
  question:{...typography.hero,color:colors.textPrimary,textAlign:'center',marginBottom:spacing.lg},
  card:{alignItems:'center',borderColor:colors.accent,marginBottom:spacing.lg},
  user:{...typography.subtitle,color:colors.textPrimary},
  score:{...typography.display,color:colors.accent,marginVertical:spacing.sm},
  tag:{...typography.eyebrow,color:colors.secondary,marginBottom:spacing.sm},
  body:{...typography.body,color:colors.textSecondary,textAlign:'center'},
  prompt:{...typography.eyebrow,color:colors.textMuted,textAlign:'center',marginBottom:spacing.sm},
  voteRow:{flexDirection:'row',gap:spacing.sm},
  voteButton:{flex:1},
  counts:{...typography.caption,color:colors.textSecondary,textAlign:'center',marginTop:spacing.sm,marginBottom:spacing.xl},
  ctaCard:{gap:spacing.md,borderColor:colors.secondary},
  ctaTitle:{...typography.title,color:colors.textPrimary,textAlign:'center'},
});
