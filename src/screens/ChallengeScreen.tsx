import React, { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
  const chainNames = chain?.names ?? [];

  return (
    <ScreenContainer scroll>
      <Text style={styles.headline}>¿PUEDES SUPERAR MI AURA?</Text>

      <View style={styles.versusRow}>
        <View style={styles.player}>
          <Text style={styles.playerName}>TÚ</Text>
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

      <Text style={styles.copy}>Sube tu versión e intenta superar este puntaje.</Text>

      {chainNames.length > 0 && (
        <Card style={styles.chainCard}>
          <Text style={styles.chainEyebrow}>AURA CHAIN</Text>
          <Text style={styles.chainCount}>x{chainNames.length}</Text>

          <View style={styles.chainAvatarRow}>
            {chainNames.map((name, index) => (
              <Fragment key={name}>
                <View style={[styles.chainAvatar, index === 0 && styles.chainAvatarYou]}>
                  <Text style={[styles.chainInitial, index === 0 && styles.chainInitialYou]}>
                    {name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                {index < chainNames.length - 1 && <Text style={styles.chainArrow}>›</Text>}
              </Fragment>
            ))}
          </View>

          <Text style={styles.chainNames}>{chainNames.join(' · ')}</Text>
        </Card>
      )}

      <View style={styles.actions}>
        <PrimaryButton label="ACEPTAR CHALLENGE" onPress={() => navigation.navigate('Upload')} />
        <PrimaryButton
          label="COMPARTIR CHALLENGE"
          variant="ghost"
          onPress={() => shareText(`${mockUser.username} te desafió en AURAXP. Supera sus ${formatSignedXP(yourScore)} AURA. 🔥`)}
        />
      </View>
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
  chainCard: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
    borderWidth: 2,
    borderColor: colors.secondary,
    backgroundColor: colors.surfaceAlt,
  },
  chainEyebrow: {
    ...typography.eyebrow,
    color: colors.secondary,
  },
  chainCount: {
    ...typography.hero,
    color: colors.textPrimary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  chainAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  chainAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.secondary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chainAvatarYou: {
    borderColor: colors.accent,
  },
  chainInitial: {
    ...typography.subtitle,
    color: colors.secondary,
  },
  chainInitialYou: {
    color: colors.accent,
  },
  chainArrow: {
    ...typography.title,
    color: colors.textMuted,
    marginHorizontal: 2,
  },
  chainNames: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
});
