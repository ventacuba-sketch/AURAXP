import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatTile } from '../components/StatTile';
import { XPBar } from '../components/XPBar';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { colors, spacing, typography } from '../theme/colors';
import { formatLevel } from '../utils/format';

export default function ProfileScreen() {
  const { user } = useCurrentUser();

  return (
    <ScreenContainer>
      <View style={styles.avatarBlock}>
        <Text style={styles.avatar}>{user?.avatarEmoji ?? '🙂'}</Text>
        <Text style={styles.username}>@{user?.username ?? 'you'}</Text>
        {user && <Badge label={`FOUNDER #${user.founderNumber}`} tone="accent" />}
      </View>

      <Card style={styles.card}>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </Card>

      <View style={styles.statsRow}>
        <StatTile label="DAY STREAK 🔥" value={String(user?.streakDays ?? 0)} />
        <StatTile label="LEVEL" value={formatLevel(user?.level ?? 0)} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  avatarBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.xs,
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
});
