import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { XPBar } from '../components/XPBar';
import { useChallenges } from '../hooks/useChallenges';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { colors, spacing, typography } from '../theme/colors';

export default function HomeScreen() {
  const { user } = useCurrentUser();
  const { challenges } = useChallenges();
  const activeChallenges = challenges.filter((c) => c.status === 'active');

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hey {user?.username ?? '...'} {user?.avatarEmoji}</Text>
        <Text style={styles.streak}>🔥 {user?.streakDays ?? 0} day streak</Text>
      </View>

      <Card style={styles.xpCard}>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </Card>

      <Text style={styles.sectionTitle}>Active challenges</Text>
      {activeChallenges.map((challenge) => (
        <Card key={challenge.id} style={styles.challengeCard}>
          <Text style={styles.challengeEmoji}>{challenge.emoji}</Text>
          <View style={styles.challengeText}>
            <Text style={styles.challengeTitle}>{challenge.title}</Text>
            <Text style={styles.challengeDescription}>{challenge.description}</Text>
          </View>
          <Text style={styles.challengeXP}>+{challenge.xpReward}</Text>
        </Card>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  greeting: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  streak: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  xpCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  challengeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  challengeEmoji: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  challengeText: {
    flex: 1,
  },
  challengeTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  challengeDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  challengeXP: {
    ...typography.subtitle,
    color: colors.accent,
  },
});
