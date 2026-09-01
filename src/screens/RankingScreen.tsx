import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import {
  AuraLeaderboardEntry,
  fetchAuraLeaderboard,
  fetchMyAuraRank,
  fetchMyXpRank,
  fetchXpLeaderboard,
  LeaderboardEntry,
} from '../services/statsService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { shareText } from '../utils/share';
import { formatSignedXP, formatXP } from '../utils/format';

const TOP_N = 20;
type Tab = 'xp' | 'aura';

/**
 * "TOP AURA" -- dos rankings, ambos lifetime (no semanal: no hay tabla de
 * eventos con fecha todavía, ver la migración de stats/leaderboard) y
 * ambos razonablemente anti-farming sin trabajo nuevo:
 * - XP: reusa el tope diario de XP + el dedupe de video que ya rigen cómo
 *   se gana ese XP.
 * - Mejor Aura: un MÁXIMO por usuario, no una suma -- no se puede
 *   "farmear" reintentando, cada intento compite contra tu propio mejor
 *   resultado, nunca lo suma.
 * Tocar una fila (menos la propia) lleva al perfil público de esa persona.
 */
export default function RankingScreen() {
  const goBack = useSmartBack();
  const navigation = useRootNavigation();
  const { user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('xp');
  const [xpEntries, setXpEntries] = useState<LeaderboardEntry[]>([]);
  const [auraEntries, setAuraEntries] = useState<AuraLeaderboardEntry[]>([]);
  const [myXpRank, setMyXpRank] = useState<number | null>(null);
  const [myAuraRank, setMyAuraRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([
        fetchXpLeaderboard(TOP_N),
        fetchMyXpRank(),
        fetchAuraLeaderboard(TOP_N),
        fetchMyAuraRank(),
      ]).then(([xp, xpRank, aura, auraRank]) => {
        if (cancelled) return;
        setXpEntries(xp);
        setMyXpRank(xpRank);
        setAuraEntries(aura);
        setMyAuraRank(auraRank);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  function openProfile(username: string) {
    if (username === user?.username) return;
    navigation.navigate('PublicProfile', { username });
  }

  // K: estado vacío con CTA útil -- acá lo que falta es GENTE, no un Scan
  // propio (el usuario puede ya tener Scans y aun así ver esto si es de
  // los primeros), así que la acción con sentido es invitar, no escanear.
  function handleInviteFriends() {
    shareText('Compito por el Top Aura en AURAXP -- ¿te animas? 🏆', 'https://auravs.app');
  }

  const entries = tab === 'xp' ? xpEntries : auraEntries;
  const myRank = tab === 'xp' ? myXpRank : myAuraRank;
  const inTop = user ? entries.some((e) => e.username === user.username) : false;

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>TOP AURA 🏆</Text>

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('xp')} style={[styles.tab, tab === 'xp' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'xp' && styles.tabTextActive]}>XP</Text>
        </Pressable>
        <Pressable onPress={() => setTab('aura')} style={[styles.tab, tab === 'aura' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'aura' && styles.tabTextActive]}>MEJOR AURA</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.empty}>Todavía no hay suficientes jugadores para un ranking.</Text>
          <PrimaryButton label="INVITAR AMIGOS" variant="ghost" onPress={handleInviteFriends} />
        </View>
      ) : (
        <>
          <Card style={styles.list}>
            {entries.map((entry) => {
              const isMe = user?.username === entry.username;
              const value = tab === 'xp' ? formatXP((entry as LeaderboardEntry).xp) : formatSignedXP((entry as AuraLeaderboardEntry).bestAuraScore);
              return (
                <Pressable key={entry.rank} onPress={() => openProfile(entry.username)}>
                  <View style={[styles.row, isMe && styles.rowMe]}>
                    <Text style={styles.rank}>#{entry.rank}</Text>
                    <Text style={styles.avatar}>{entry.avatarEmoji}</Text>
                    <Text style={[styles.username, isMe && styles.usernameMe]} numberOfLines={1}>
                      @{entry.username}{isMe ? ' (tú)' : ''}
                    </Text>
                    <Text style={styles.value}>{value}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>

          {!inTop && myRank != null && <Text style={styles.myRankText}>Tu posición: #{myRank}</Text>}
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
    marginBottom: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tabActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  tabText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  tabTextActive: {
    color: colors.accent,
  },
  center: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptyBlock: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
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
  value: {
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
