import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReplayPlaceholder } from '../components/ReplayPlaceholder';
import { ScreenContainer } from '../components/ScreenContainer';
import { XPBar } from '../components/XPBar';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useLatestChallengeResult } from '../hooks/useLatestChallengeResult';
import { useMyTurnChallengeCount } from '../hooks/useMyTurnChallengeCount';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { fetchLatestReplay } from '../services/api';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatSignedXP, formatXP } from '../utils/format';

const RESULT_EVENT_COPY: Record<'won' | 'lost' | 'tie', (rival: string) => string> = {
  won: (rival) => `🏆 Le ganaste a @${rival}`,
  lost: (rival) => `💀 @${rival} te ganó`,
  tie: (rival) => `🤝 Empataste con @${rival}`,
};

export default function HomeScreen() {
  const { user } = useCurrentUser();
  const { data: latestReplay } = useAsyncData(fetchLatestReplay);
  const myTurnCount = useMyTurnChallengeCount();
  const latestResult = useLatestChallengeResult();
  const navigation = useRootNavigation();

  return (
    <ScreenContainer scroll>
      <View style={styles.topRow}>
        <Text style={styles.wordmark}>AURAXP</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.headline}>¿CUÁNTA AURA TIENES?</Text>
        <Text style={styles.heroSubtitle}>
          Sube un momento. AURAXP te dice dónde ganaste o perdiste Aura.
        </Text>
        <PrimaryButton label="ESCANEAR MI AURA" onPress={() => navigation.navigate('Upload')} />
      </View>

      <DailyScanCounter />

      {/* Loop de retención: Challenge pendiente/revancha antes que el XP --
          reemplaza la card "Carlos te desafió" que era mock puro (ningún
          dato real detrás, y su botón ACEPTAR ni siquiera llevaba a un
          Challenge real -- ver auditoría). Esta sí consulta Challenges de
          verdad (challengeService.countMyTurnChallenges) y solo muestra un
          número cuando hay algo real que mostrar. */}
      <Pressable onPress={() => navigation.navigate('MyChallenges')}>
        <Card style={styles.myChallengesCard}>
          <View style={styles.myChallengesRow}>
            <Text style={styles.myChallengesTitle}>MIS DESAFÍOS ⚔️</Text>
            <Text style={styles.myChallengesArrow}>›</Text>
          </View>
          {myTurnCount != null && myTurnCount > 0 && (
            <Text style={styles.myChallengesBadge}>
              ⚔️ {myTurnCount} desafío{myTurnCount === 1 ? '' : 's'} pendiente{myTurnCount === 1 ? '' : 's'} de tu Scan
            </Text>
          )}
          {/* Notificación in-app mínima (I) -- el último resultado real,
              derivado de `challenges` sin tabla nueva (ver
              useLatestChallengeResult). Solo el más reciente, no un inbox. */}
          {latestResult && (
            <Text style={styles.myChallengesResult}>
              {RESULT_EVENT_COPY[latestResult.kind](latestResult.rivalUsername)}
            </Text>
          )}
        </Card>
      </Pressable>

      <View style={styles.auraSection}>
        <Text style={styles.eyebrow}>TU AURA</Text>
        <Text style={styles.auraScore}>{user ? formatXP(user.xp) : '—'}</Text>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </View>

      {latestReplay && (
        <Card style={styles.replayCard}>
          <Text style={styles.eyebrow}>ÚLTIMO REPLAY</Text>
          <View style={styles.replayRow}>
            <ReplayPlaceholder size="sm" />
            <View style={styles.replayInfo}>
              <Text style={styles.replayXP}>{formatSignedXP(latestReplay.xpDelta)} AURA</Text>
              <Text style={styles.replayLabel}>{latestReplay.momentLabel}</Text>
              <Text style={styles.replayTimestamp}>{latestReplay.timestamp}</Text>
            </View>
          </View>
          <PrimaryButton
            label="Ver replay"
            variant="text"
            onPress={() => navigation.navigate('ScanResult', { scanId: latestReplay.id })}
          />
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  wordmark: {
    ...typography.title,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  hero: {
    marginBottom: spacing.xl,
  },
  headline: {
    ...typography.hero,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  auraSection: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: spacing.xs,
  },
  auraScore: {
    ...typography.display,
    color: colors.accent,
    marginBottom: spacing.md,
  },
  replayCard: {
    marginBottom: spacing.md,
  },
  replayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  replayInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
  replayXP: {
    ...typography.subtitle,
    color: colors.accent,
  },
  replayLabel: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: 2,
  },
  replayTimestamp: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  myChallengesCard: {
    marginBottom: spacing.xl,
    borderColor: colors.secondary,
  },
  myChallengesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  myChallengesTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  myChallengesArrow: {
    ...typography.title,
    color: colors.textMuted,
  },
  myChallengesBadge: {
    ...typography.caption,
    color: colors.secondary,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  myChallengesResult: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
