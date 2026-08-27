import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { XPBar } from '../components/XPBar';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { colors, spacing, typography } from '../theme/colors';

export default function ProfileScreen() {
  const { user } = useCurrentUser();

  return (
    <ScreenContainer>
      <View style={styles.avatarBlock}>
        <Text style={styles.avatar}>{user?.avatarEmoji ?? '🙂'}</Text>
        <Text style={styles.username}>@{user?.username ?? 'you'}</Text>
      </View>

      <Card style={styles.card}>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </Card>

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{user?.streakDays ?? 0}</Text>
          <Text style={styles.statLabel}>Day streak 🔥</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{user?.level ?? 0}</Text>
          <Text style={styles.statLabel}>Level</Text>
        </Card>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  avatarBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  avatar: {
    fontSize: 56,
    marginBottom: spacing.sm,
  },
  username: {
    ...typography.title,
    color: colors.textPrimary,
  },
  card: {
    marginBottom: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.hero,
    color: colors.accent,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
