import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useSmartBack } from '../hooks/useSmartBack';
import { fetchMyXpRank, fetchXpLeaderboard, LeaderboardEntry } from '../services/statsService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatXP } from '../utils/format';

const TOP_N = 20;

/**
 * "TOP AURA" -- ranking simple por XP acumulado, ver la migración
 * 20260831120000_challenge_stats_and_leaderboard.sql para por qué es
 * lifetime (no semanal, no hay tabla de eventos de XP con fecha todavía) y
 * por qué es razonablemente anti-farming sin trabajo nuevo (reusa el
 * mismo tope diario de XP y el dedupe de video que ya rigen cómo se gana
 * ese XP en primer lugar).
 */
export default function RankingScreen() {
  const goBack = useSmartBack();
  const { user } = useCurrentUser();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([fetchXpLeaderboard(TOP_N), fetchMyXpRank()]).then(([top, rank]) => {
        if (cancelled) return;
        setEntries(top);
        setMyRank(rank);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const inTop = user ? entries.some((e) => e.username === user.username) : false;

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>TOP AURA 🏆</Text>
      <Text style={styles.subtitle}>Ranking por XP acumulado.</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : entries.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay suficientes jugadores para un ranking.</Text>
      ) : (
        <>
          <Card style={styles.list}>
            {entries.map((entry) => {
              const isMe = user?.username === entry.username;
              return (
                <View key={entry.rank} style={[styles.row, isMe && styles.rowMe]}>
                  <Text style={styles.rank}>#{entry.rank}</Text>
                  <Text style={styles.avatar}>{entry.avatarEmoji}</Text>
                  <Text style={[styles.username, isMe && styles.usernameMe]} numberOfLines={1}>
                    @{entry.username}{isMe ? ' (tú)' : ''}
                  </Text>
                  <Text style={styles.xp}>{formatXP(entry.xp)}</Text>
                </View>
              );
            })}
          </Card>

          {!inTop && myRank != null && (
            <Text style={styles.myRankText}>Tu posición: #{myRank}</Text>
          )}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  center: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  rowMe: {
    backgroundColor: colors.surfaceAlt,
  },
  rank: {
    ...typography.caption,
    color: colors.textMuted,
    width: 36,
    fontWeight: '800',
  },
  avatar: {
    fontSize: 22,
  },
  username: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  usernameMe: {
    color: colors.accent,
    fontWeight: '700',
  },
  xp: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  myRankText: {
    ...typography.subtitle,
    color: colors.secondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
