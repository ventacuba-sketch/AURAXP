import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAsyncData } from '../hooks/useAsyncData';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { fetchAuraChain, fetchFriendChallenge } from '../services/api';
import { mockScanResult, mockUser } from '../services/mockData';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatSignedXP } from '../utils/format';
import { shareText } from '../utils/share';

export default function ChallengeScreen() {
  const { data: friendChallenge } = useAsyncData(fetchFriendChallenge);
  const { data: chain } = useAsyncData(fetchAuraChain);
  const navigation = useRootNavigation();

  const yourScore = mockScanResult.xpEarned;
  const friendScore = friendChallenge?.friendScore ?? 0;
  const friendName = friendChallenge?.friendName ?? '...';

  return (
    <ScreenContainer scroll>
      <Text style={styles.headline}>BEAT MY AURA</Text>

      <View style={styles.versusRow}>
        <View style={styles.player}>
          <Text style={styles.playerName}>YOU</Text>
          <Text style={[styles.playerScore, styles.youColor]}>{formatSignedXP(yourScore)}</Text>
        </View>

        <View style={styles.vsBadge}>
          <Text style={styles.vsText}>VS</Text>
        </View>

        <View style={styles.player}>
          <Text style={styles.playerName}>{friendName.toUpperCase()}</Text>
          <Text style={[styles.playerScore, styles.friendColor]}>{formatSignedXP(friendScore)}</Text>
        </View>
      </View>

      <Text style={styles.copy}>Upload your version and beat this score.</Text>

      <View style={styles.actions}>
        <PrimaryButton label="TAKE THE CHALLENGE" onPress={() => navigation.navigate('Upload')} />
        <PrimaryButton
          label="SHARE CHALLENGE LINK"
          variant="ghost"
          onPress={() => shareText(`${mockUser.username} is challenging you on AURAXP. Beat ${formatSignedXP(yourScore)} AURA. 🔥`)}
        />
      </View>

      <Card style={styles.chainCard}>
        <Badge label={`AURA CHAIN x${chain?.names.length ?? 0}`} tone="secondary" />
        <Text style={styles.chainNames}>{chain?.names.join(' → ') ?? ''}</Text>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headline: {
    ...typography.hero,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  versusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  player: {
    flex: 1,
    alignItems: 'center',
  },
  playerName: {
    ...typography.eyebrow,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  playerScore: {
    ...typography.hero,
  },
  youColor: {
    color: colors.accent,
  },
  friendColor: {
    color: colors.secondary,
  },
  vsBadge: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.sm,
  },
  vsText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  copy: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  actions: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  chainCard: {
    alignItems: 'center',
  },
  chainNames: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
