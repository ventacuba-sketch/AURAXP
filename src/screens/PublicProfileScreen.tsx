import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatTile } from '../components/StatTile';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { fetchLatestReplay } from '../services/api';
import { createDirectChallenge } from '../services/challengeService';
import {
  fetchPublicProfile,
  fetchPublicRecentResults,
  fetchPublicXpRank,
  PublicProfile,
  PublicRecentResult,
} from '../services/statsService';
import { colors, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';
import { formatLevel, formatRelativeTime, formatSignedXP, formatXP } from '../utils/format';

type PublicProfileRoute = RouteProp<RootStackParamList, 'PublicProfile'>;

/**
 * Perfil público de OTRO usuario (o el propio visto desde afuera, p. ej.
 * tocando tu propia fila en el Ranking) -- solo datos ya aprobados como
 * públicos (ver get_public_profile/get_public_xp_rank/get_public_recent_
 * results: username/avatar/nivel/XP/mejor Aura/stats de Challenge/rank/
 * últimos resultados, nunca email/plan/id técnico/videos).
 */
export default function PublicProfileScreen() {
  const { params } = useRoute<PublicProfileRoute>();
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { user: me } = useCurrentUser();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [recentResults, setRecentResults] = useState<PublicRecentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    Promise.all([
      fetchPublicProfile(params.username),
      fetchPublicXpRank(params.username),
      fetchPublicRecentResults(params.username, 5),
    ]).then(([profileResult, rankResult, resultsResult]) => {
      if (cancelled) return;
      if (profileResult) {
        setProfile(profileResult);
        setRank(rankResult);
        setRecentResults(resultsResult);
        logEvent('profile_viewed', { username: params.username });
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [params.username]);

  const isMe = me?.username === params.username;
  const winRate = profile && profile.challengesCompleted > 0 ? Math.round((profile.wins / profile.challengesCompleted) * 100) : null;

  /**
   * Challenge DIRECTO real (A) -- vía create_direct_challenge (SECURITY
   * DEFINER): el backend crea el Challenge YA con target_user_id fijado
   * en esta persona, y le manda una notificación in-app real. Nada de
   * "compartir un link con su nombre en el texto" (así funcionaba antes) --
   * ahora es un Challenge genuinamente dirigido, que SOLO esta persona
   * puede aceptar o rechazar (lo hace cumplir el RPC, ver esa migración).
   * El Challenge clásico por link (createChallenge, sin target) sigue
   * intacto y es un camino totalmente separado.
   */
  async function handleChallengeDirect() {
    setChallenging(true);
    setNotice(null);
    try {
      const latest = await fetchLatestReplay();
      if (!latest) {
        setNotice('Hacé tu primer Scan antes de desafiar a alguien.');
        return;
      }
      const result = await createDirectChallenge(latest.id, params.username);
      if (result.ok && result.shareToken) {
        navigation.navigate('Challenge', { challengeToken: result.shareToken });
        return;
      }
      switch (result.errorCode) {
        case 'cannot_challenge_self':
          setNotice('No puedes desafiarte a ti mismo.');
          break;
        case 'target_not_found':
          setNotice('Este usuario ya no existe.');
          break;
        case 'invalid_scan':
          setNotice('Tu último Scan no es válido para desafiar. Hacé uno nuevo.');
          break;
        default:
          setNotice('No pudimos crear el desafío. Intenta de nuevo.');
      }
    } catch (e) {
      console.warn('handleChallengeDirect failed', e);
      setNotice('No pudimos crear el desafío. Intenta de nuevo.');
    } finally {
      setChallenging(false);
    }
  }

  if (loading) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  if (notFound || !profile) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <Text style={styles.notFound}>Este perfil no existe.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <View style={styles.avatarBlock}>
        <Text style={styles.avatar}>{profile.avatarEmoji}</Text>
        <Text style={styles.username}>@{profile.username}</Text>
        <Text style={styles.level}>
          {formatLevel(profile.level)} · {formatXP(profile.xp)}
          {rank != null ? ` · #${rank} en el ranking` : ''}
        </Text>
      </View>

      {profile.bestAuraScore != null && (
        <Card style={styles.bestAuraCard}>
          <Text style={styles.bestAuraLabel}>MEJOR AURA</Text>
          <Text style={styles.bestAuraValue}>{formatSignedXP(profile.bestAuraScore)}</Text>
        </Card>
      )}

      <View style={styles.statsGrid}>
        <StatTile label="CHALLENGES" value={String(profile.challengesCompleted)} />
        <StatTile label="GANADOS" value={String(profile.wins)} />
        <StatTile label="PERDIDOS" value={String(profile.losses)} />
        <StatTile label="WIN RATE" value={winRate != null ? `${winRate}%` : '—'} />
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {!isMe && (
        <PrimaryButton
          label={challenging ? 'CREANDO DESAFÍO...' : `DESAFIAR A @${profile.username}`}
          disabled={challenging}
          onPress={handleChallengeDirect}
        />
      )}

      {recentResults.length > 0 && (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>ÚLTIMAS BATALLAS</Text>
          {recentResults.map((r, i) => (
            <View key={i} style={styles.recentRow}>
              <Text style={styles.recentAvatar}>{r.rivalAvatarEmoji}</Text>
              <View style={styles.recentInfo}>
                <Text style={styles.recentText}>
                  {r.isTie ? '🤝' : r.iWon ? '🏆' : '💀'} vs @{r.rivalUsername}
                </Text>
                <Text style={styles.recentDate}>{formatRelativeTime(r.resolvedAt)}</Text>
              </View>
              {r.myScore != null && r.rivalScore != null && (
                <Text style={styles.recentScore}>
                  {formatSignedXP(r.myScore)} / {formatSignedXP(r.rivalScore)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  level: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  bestAuraCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderColor: colors.accent,
  },
  bestAuraLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  bestAuraValue: {
    ...typography.display,
    color: colors.accent,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  notice: {
    ...typography.caption,
    color: colors.success,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  notFound: {
    ...typography.body,
    color: colors.textSecondary,
  },
  recentSection: {
    marginTop: spacing.xl,
  },
  recentTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recentAvatar: {
    fontSize: 22,
  },
  recentInfo: {
    flex: 1,
  },
  recentText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  recentDate: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  recentScore: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});
