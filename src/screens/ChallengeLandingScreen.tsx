import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAuth } from '../hooks/useAuth';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { acceptChallenge, fetchChallengePreview } from '../services/challengeService';
import { setPendingChallengeToken } from '../services/pendingChallenge';
import { colors, spacing, typography } from '../theme/colors';
import { ChallengePreview, RootStackParamList } from '../types';
import { formatSignedXP } from '../utils/format';

type LandingRoute = RouteProp<RootStackParamList, 'ChallengeLanding'>;

const STATUS_COPY: Partial<Record<ChallengePreview['status'], string>> = {
  accepted: 'Este desafío ya fue aceptado por otra persona.',
  completed: 'Este desafío ya terminó.',
  cancelled: 'Este desafío fue cancelado.',
  expired: 'Este desafío ya expiró.',
};

/**
 * Landing pública del Challenge — alcanzable por deep link (con la app
 * instalada) o por URL web (https://auravs.app/c/:token), sin sesión.
 * Si el visitante no tiene cuenta, ACEPTAR lo manda a Auth guardando el
 * token pendiente primero (ver services/pendingChallenge.ts) -- RootNavigator
 * lo retoma solo apenas hay sesión, así el token nunca se pierde en el
 * camino por Auth.
 */
export default function ChallengeLandingScreen() {
  const { params } = useRoute<LandingRoute>();
  const navigation = useRootNavigation();
  const { session } = useAuth();
  const { user } = useCurrentUser();
  const [preview, setPreview] = useState<ChallengePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchChallengePreview(params.token).then((result) => {
      if (!mounted) return;
      if (result) setPreview(result);
      else setNotFound(true);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [params.token]);

  const isOwnChallenge = Boolean(session && user && preview && user.username === preview.fromUsername);

  // Navegación propia -- antes esta pantalla no tenía NINGUNA forma de
  // salir salvo el Back del navegador (bug real probado en iPhone). onBack
  // solo si hay algo real a lo que volver (si se llegó por un link externo
  // directo no hay historial in-app); onHome solo con sesión -- sin
  // sesión, MainTabs ni siquiera está registrado en el stack todavía (ver
  // RootNavigator), así que ofrecerlo sería un botón muerto.
  const canGoBack = navigation.canGoBack();
  const handleBack = canGoBack ? () => navigation.goBack() : undefined;
  const handleHome = session ? () => navigation.navigate('MainTabs') : undefined;

  async function handleAccept() {
    if (!session) {
      await setPendingChallengeToken(params.token);
      navigation.navigate('Auth');
      return;
    }

    setAccepting(true);
    setAcceptError(null);
    const result = await acceptChallenge(params.token);
    setAccepting(false);

    if (result.ok) {
      navigation.navigate('Challenge', { challengeToken: params.token });
      return;
    }

    switch (result.errorCode) {
      case 'cannot_accept_own':
        setAcceptError('No puedes aceptar tu propio desafío.');
        break;
      case 'already_taken':
        setAcceptError('Alguien más ya aceptó este desafío.');
        break;
      case 'expired':
        setAcceptError('Este desafío ya expiró.');
        break;
      case 'not_found':
        setAcceptError('Este desafío ya no existe.');
        break;
      default:
        setAcceptError('No pudimos aceptar el desafío. Intenta de nuevo.');
    }
  }

  if (loading) {
    return (
      <ScreenContainer style={styles.center} onBack={handleBack} onHome={handleHome}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  if (notFound || !preview) {
    return (
      <ScreenContainer style={styles.center} onBack={handleBack} onHome={handleHome}>
        <Text style={styles.wordmark}>AURA VS</Text>
        <Text style={styles.notFound}>Este desafío ya no está disponible.</Text>
      </ScreenContainer>
    );
  }

  // Link muerto/tomado: mostrar el motivo en vez de un botón que va a fallar.
  const deadReason = STATUS_COPY[preview.status];

  return (
    <ScreenContainer style={styles.center} onBack={handleBack} onHome={handleHome}>
      <Text style={styles.wordmark}>AURA VS</Text>

      <Card style={styles.card}>
        <Text style={styles.avatar}>{preview.fromAvatarEmoji}</Text>
        <Text style={styles.challenger}>@{preview.fromUsername} te desafía ⚔️</Text>
        <Badge label={preview.verdictTag} tone="accent" style={styles.badge} />
        <Text style={styles.score}>{formatSignedXP(preview.auraScore)} AURA</Text>
        <Text style={styles.question}>¿Tienes más Aura?</Text>
      </Card>

      {deadReason ? (
        <Text style={styles.deadReason}>{deadReason}</Text>
      ) : isOwnChallenge ? (
        <Text style={styles.deadReason}>Este es tu propio desafío -- compartilo para que alguien lo acepte.</Text>
      ) : (
        <>
          {acceptError && <Text style={styles.errorText}>{acceptError}</Text>}
          <PrimaryButton
            label={accepting ? 'ACEPTANDO...' : 'ACEPTAR DESAFÍO'}
            disabled={accepting}
            onPress={handleAccept}
          />
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  wordmark: {
    ...typography.title,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  card: {
    width: '100%',
    alignItems: 'center',
    padding: spacing.xl,
    borderColor: colors.secondary,
  },
  avatar: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  challenger: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  score: {
    ...typography.display,
    color: colors.accent,
  },
  question: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  notFound: {
    ...typography.body,
    color: colors.textSecondary,
  },
  deadReason: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
  },
});
