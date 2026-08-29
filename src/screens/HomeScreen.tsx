import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReplayPlaceholder } from '../components/ReplayPlaceholder';
import { ScreenContainer } from '../components/ScreenContainer';
import { XPBar } from '../components/XPBar';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { fetchFriendChallenge, fetchLatestReplay } from '../services/api';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatNumber, formatSignedXP, formatXP } from '../utils/format';

export default function HomeScreen() {
  const { user } = useCurrentUser();
  const { data: latestReplay } = useAsyncData(fetchLatestReplay);
  const { data: friendChallenge } = useAsyncData(fetchFriendChallenge);
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

      {friendChallenge && (
        <Card style={styles.challengeCard}>
          <Text style={styles.challengeTitle}>{friendChallenge.friendName} te desafió</Text>
          <Text style={styles.challengeScore}>
            {friendChallenge.friendName}: {formatNumber(friendChallenge.friendScore)}
          </Text>
          <Text style={styles.challengePrompt}>{friendChallenge.prompt}</Text>
          <PrimaryButton label="ACEPTAR" onPress={() => navigation.navigate('Challenge')} />
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
  challengeCard: {
    borderColor: colors.secondary,
  },
  challengeTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  challengeScore: {
    ...typography.body,
    color: colors.secondary,
    marginBottom: spacing.xs,
  },
  challengePrompt: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
});
