import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { useChallenges } from '../hooks/useChallenges';
import { colors, radius, spacing, typography } from '../theme/colors';
import { ChallengeStatus } from '../types';

const statusStyle: Record<ChallengeStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: colors.accent },
  completed: { label: 'Done', color: colors.success },
  locked: { label: 'Locked', color: colors.textMuted },
};

export default function ChallengeScreen() {
  const { challenges } = useChallenges();

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Challenges</Text>
        <Text style={styles.subtitle}>Complete them, prove it, earn Aura XP.</Text>
      </View>

      {challenges.map((challenge) => {
        const status = statusStyle[challenge.status];
        return (
          <Card key={challenge.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.emoji}>{challenge.emoji}</Text>
              <View style={styles.textBlock}>
                <Text style={styles.cardTitle}>{challenge.title}</Text>
                <Text style={styles.cardDescription}>{challenge.description}</Text>
              </View>
            </View>
            <View style={styles.footerRow}>
              <View style={[styles.badge, { borderColor: status.color }]}>
                <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
              </View>
              <Text style={styles.xpReward}>+{challenge.xpReward} XP</Text>
            </View>
          </Card>
        );
      })}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  card: {
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  emoji: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  textBlock: {
    flex: 1,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  cardDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  xpReward: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
