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
import { fetchLatestReplay } from '../services/api';
import { challengeShareUrl, createChallenge } from '../services/challengeService';
import { fetchPublicProfile, PublicProfile } from '../services/statsService';
import { colors, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';
import { formatLevel, formatSignedXP, formatXP } from '../utils/format';
import { shareText } from '../utils/share';

type PublicProfileRoute = RouteProp<RootStackParamList, 'PublicProfile'>;

/**
 * Perfil público de OTRO usuario (o el propio visto desde afuera, p. ej.
 * tocando tu propia fila en el Ranking) -- solo datos ya aprobados como
 * públicos (ver get_public_profile: username/avatar/nivel/XP/mejor Aura/
 * stats de Challenge, nunca email/plan/id técnico).
 */
export default function PublicProfileScreen() {
  const { params } = useRoute<PublicProfileRoute>();
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { user: me } = useCurrentUser();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetchPublicProfile(params.username).then((result) => {
      if (cancelled) return;
      if (result) setProfile(result);
      else setNotFound(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [params.username]);

  const isMe = me?.username === params.username;

  /**
   * "Challenge directo" (item 5) -- reutiliza el Challenge clásico por
   * link 100%: crea un Challenge normal desde mi Scan más reciente
   * (createChallenge, la MISMA función que usa ScanResult/revancha) y
   * comparte el link con el texto pre-dirigido a esta persona. No agrega
   * ningún concepto nuevo de "invitado específico" al backend -- el link
   * lo puede aceptar cualquiera que lo reciba, exactamente como hoy;
   * "directo" es solo que el texto del share ya viene con su @username.
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
      const token = await createChallenge(latest.id);
      const result = await shareText(`@${params.username}, ¿aceptás mi desafío en AURA VS? ⚔️`, challengeShareUrl(token));
      if (result === 'copied') setNotice('Enlace copiado -- mandáselo a @' + params.username);
      navigation.navigate('Challenge', { challengeToken: token });
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
        <Text style={styles.level}>{formatLevel(profile.level)} · {formatXP(profile.xp)}</Text>
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
        <StatTile label="EMPATES" value={String(profile.ties)} />
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {!isMe && (
        <PrimaryButton
          label={challenging ? 'CREANDO DESAFÍO...' : `DESAFIAR A @${profile.username}`}
          disabled={challenging}
          onPress={handleChallengeDirect}
        />
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
});
