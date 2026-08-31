import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import {
  AppNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatRelativeTime } from '../utils/format';

const COPY: Record<string, (rival: string) => string> = {
  challenge_accepted: (rival) => `@${rival} aceptó tu desafío`,
  challenge_completed_won: (rival) => `🏆 Le ganaste a @${rival}`,
  challenge_completed_lost: (rival) => `💀 @${rival} te ganó`,
  challenge_completed_tie: (rival) => `🤝 Empataste con @${rival}`,
};

function notificationText(n: AppNotification): string {
  const rival = n.rivalUsername ?? 'alguien';
  if (n.kind === 'challenge_accepted') return COPY.challenge_accepted(rival);
  if (n.result === 'won') return COPY.challenge_completed_won(rival);
  if (n.result === 'lost') return COPY.challenge_completed_lost(rival);
  return COPY.challenge_completed_tie(rival);
}

export default function NotificationsScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchNotifications().then((result) => {
      setItems(result);
      setLoading(false);
    });
  }, []);

  useFocusEffect(load);

  const hasUnread = items.some((n) => !n.read);

  async function handlePress(n: AppNotification) {
    if (!n.read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      markNotificationRead(n.id);
    }
    if (n.challengeShareToken) {
      navigation.navigate('Challenge', { challengeToken: n.challengeShareToken });
    }
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await markAllNotificationsRead();
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <View style={styles.header}>
        <Text style={styles.title}>NOTIFICACIONES 🔔</Text>
        {hasUnread && (
          <Pressable onPress={handleMarkAll} hitSlop={6}>
            <Text style={styles.markAll}>Marcar todas leídas</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Sin notificaciones todavía.</Text>
          <Text style={styles.emptySubtext}>
            Cuando alguien acepte tu desafío o termine una batalla, aparece acá.
          </Text>
          <PrimaryButton label="MIS DESAFÍOS" variant="ghost" onPress={() => navigation.navigate('MyChallenges')} />
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((n) => (
            <Pressable key={n.id} onPress={() => handlePress(n)}>
              <Card style={n.read ? styles.row : StyleSheet.flatten([styles.row, styles.rowUnread])}>
                <Text style={styles.rivalAvatar}>{n.rivalAvatarEmoji ?? '🔔'}</Text>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowText}>{notificationText(n)}</Text>
                  <Text style={styles.rowDate}>{formatRelativeTime(n.createdAt)}</Text>
                </View>
                {!n.read && <View style={styles.unreadDot} />}
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  markAll: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  center: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  emptyText: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowUnread: {
    borderColor: colors.secondary,
  },
  rivalAvatar: {
    fontSize: 28,
  },
  rowInfo: {
    flex: 1,
  },
  rowText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rowDate: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});
