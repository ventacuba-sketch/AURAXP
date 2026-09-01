import React, { useEffect, useRef, useState } from 'react';
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
import { createDirectChallenge } from '../services/challengeService';
import { fetchMyLatestValidScanId } from '../services/scanService';
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
  // Guard de doble tap (J) SINCRÓNICO -- a diferencia de `challenging`
  // (estado de React, solo se refleja en el render SIGUIENTE), un ref se
  // lee/escribe inmediatamente: dos toques que lleguen antes de que React
  // repinte el botón disabled igual no pueden disparar dos RPCs. La
  // idempotencia real (mismo target + 'pending' -> devuelve el existente)
  // vive en el RPC (ver migración de hardening) -- esto es la primera
  // línea de defensa, no la única.
  const challengingRef = useRef(false);

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
   * en esta persona, y le manda una notificación in-app real. El Challenge
   * clásico por link (createChallenge, sin target) sigue intacto y es un
   * camino totalmente separado.
   *
   * BUG REAL encontrado auditando esto (causa confirmada, no una
   * suposición): el scanId salía de `api.fetchLatestReplay()`, pensada
   * para la card "ÚLTIMO REPLAY" de Home -- tiene un fallback a un scan
   * MOCK (id `"s_001"`, no un uuid real) para cuando no hay sesión/
   * Supabase configurado, que es el comportamiento correcto PARA ESA
   * pantalla pero no acá: un id no-uuid nunca puede pasar el chequeo de
   * `create_direct_challenge`, y Postgres devuelve un error de
   * casteo/validación que el catch-all mostraba como el mensaje genérico
   * -- exactamente la "sospecha principal" (scanId incorrecto/mock).
   * Fix: `scanService.fetchMyLatestValidScanId()`, de propósito único,
   * sin fallback a nada -- `null` siempre que no haya un scan real y
   * válido del usuario autenticado.
   */
  async function handleChallengeDirect() {
    if (challengingRef.current) return; // doble tap (J) -- ver comentario del ref arriba
    challengingRef.current = true;
    setChallenging(true);
    setNotice(null);
    try {
      const scanId = await fetchMyLatestValidScanId();
      // scan_status/scan_owner ya están implícitos acá (F): fetchMyLatestValidScanId
      // filtra exactamente por status='done' AND user_id=auth.uid() -- un
      // scanId no-null que salió de ahí YA es, por construcción, done y
      // del usuario actual, no hace falta un segundo round-trip para
      // loguear lo que la propia query ya garantizó.
      console.log(
        JSON.stringify({
          src: 'handleChallengeDirect',
          event: 'scan_resolved',
          source_scan_id: scanId,
          scan_status: scanId ? 'done' : null,
          target_username: params.username,
        }),
      );
      if (!scanId) {
        setNotice('__NEEDS_SCAN__');
        return;
      }
      const result = await createDirectChallenge(scanId, params.username);
      if (result.ok && result.shareToken) {
        navigation.navigate('Challenge', { challengeToken: result.shareToken });
        return;
      }
      // Mensajes útiles según error_code (I) -- nunca el texto crudo de
      // Postgres (eso queda solo en la consola, ver createDirectChallenge).
      switch (result.errorCode) {
        case 'cannot_challenge_self':
          setNotice('No puedes desafiarte a ti mismo.');
          break;
        case 'target_not_found':
          setNotice('No encontramos a este usuario.');
          break;
        case 'invalid_scan':
          setNotice('__NEEDS_SCAN__');
          break;
        case 'not_authenticated':
          setNotice('Tu sesión expiró. Vuelve a iniciar sesión.');
          break;
        case 'network':
          setNotice('No pudimos conectar. Intenta de nuevo.');
          break;
        default:
          // 'unexpected backend' (I): mensaje neutro al usuario, el detalle
          // técnico (rpc_error.code/message) ya quedó en la consola --
          // ver createDirectChallenge.
          setNotice('No pudimos crear el desafío. Intenta de nuevo.');
      }
    } catch (e) {
      console.error(JSON.stringify({ src: 'handleChallengeDirect', event: 'unexpected_error', message: String(e) }));
      setNotice('No pudimos crear el desafío. Intenta de nuevo.');
    } finally {
      challengingRef.current = false;
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

      {notice && notice !== '__NEEDS_SCAN__' && <Text style={styles.notice}>{notice}</Text>}

      {!isMe && notice === '__NEEDS_SCAN__' ? (
        // (B) Sin Scan válido -- CTA directo a hacerlo, nunca un Challenge
        // inválido.
        <View style={styles.needsScan}>
          <Text style={styles.notice}>Necesitas un Scan antes de desafiar.</Text>
          <PrimaryButton label="HACER MI SCAN" onPress={() => navigation.navigate('Upload')} />
        </View>
      ) : (
        !isMe && (
          <PrimaryButton
            label={challenging ? 'CREANDO DESAFÍO...' : `DESAFIAR A @${profile.username}`}
            disabled={challenging}
            onPress={handleChallengeDirect}
          />
        )
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
  needsScan: {
    gap: spacing.sm,
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
