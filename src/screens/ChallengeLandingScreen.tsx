import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAuth } from '../hooks/useAuth';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { fetchChallengePreview } from '../services/challengeService';
import { colors, spacing, typography } from '../theme/colors';
import { ChallengePreview, RootStackParamList } from '../types';
import { formatSignedXP } from '../utils/format';

type LandingRoute = RouteProp<RootStackParamList, 'ChallengeLanding'>;

/**
 * Landing pública del Challenge — alcanzable por deep link (con la app
 * instalada) o por URL web (Expo Web, sin instalar nada). No requiere
 * sesión: si el visitante no tiene cuenta, "ACEPTAR CHALLENGE" lo manda
 * a registrarse ahí mismo — nada de infraestructura de landing aparte.
 */
export default function ChallengeLandingScreen() {
  const { params } = useRoute<LandingRoute>();
  const navigation = useRootNavigation();
  const { session } = useAuth();
  const [preview, setPreview] = useState<ChallengePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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

  function handleAccept() {
    if (session) {
      navigation.navigate('Upload', { challengeToken: params.token });
    } else {
      navigation.navigate('Auth');
    }
  }

  if (loading) {
    return (
      <ScreenContainer style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  if (notFound || !preview) {
    return (
      <ScreenContainer style={styles.center}>
        <Text style={styles.wordmark}>AURAXP</Text>
        <Text style={styles.notFound}>Este challenge ya no está disponible.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.center}>
      <Text style={styles.wordmark}>AURAXP</Text>

      <Card style={styles.card}>
        <Text style={styles.avatar}>{preview.fromAvatarEmoji}</Text>
        <Text style={styles.challenger}>{preview.fromUsername} te desafió</Text>
        <Badge label={preview.verdictTag} tone="accent" style={styles.badge} />
        <Text style={styles.score}>{formatSignedXP(preview.auraScore)} AURA</Text>
        <Text style={styles.question}>¿Puedes superarlo?</Text>
      </Card>

      <PrimaryButton label="ACEPTAR CHALLENGE" onPress={handleAccept} />
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
});
