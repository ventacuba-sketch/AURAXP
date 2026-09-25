import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { fetchMyReferralInfo, fetchMyReferralStats, ReferralInfo, ReferralStats } from '../services/referralService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { shareText } from '../utils/share';

/** Invitar amigos (bloque referidos) -- código propio + link, ver
 * attribute_referral (atribución) y el trigger de activación en la
 * migración (premio real solo cuando el referido completa su primer
 * Scan). */
export default function InviteScreen() {
  const goBack = useSmartBack();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [stats, setStats] = useState<ReferralStats>({ totalReferred: 0, totalActivated: 0 });
  // P1-1 (auditoría pre-lanzamiento): un rechazo real de red se comía el
  // .then() entero -- acá se traducía en "INVITAR AMIGOS" deshabilitado
  // para siempre (depende de `info`), sin ningún mensaje ni forma de
  // reintentar.
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([fetchMyReferralInfo(), fetchMyReferralStats()])
      .then(([i, s]) => {
        if (cancelled) return;
        setInfo(i);
        setStats(s);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  async function handleInvite() {
    if (!info) return;
    logEvent('referral_sent');
    await shareText('Te invito a AURA VS -- mide tu Aura y gana Coins con tu primer Scan ⚡', info.shareUrl);
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>INVITAR AMIGOS</Text>
      <Text style={styles.subtitle}>Tú ganas 5.000 Coins y tu amigo 2.500, apenas haga su primer Scan.</Text>

      {info && (
        <Card style={styles.codeCard}>
          <Text style={styles.codeLabel}>TU CÓDIGO</Text>
          <Text style={styles.code}>{info.code}</Text>
        </Card>
      )}

      {loadError && !info && (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>No pudimos cargar tu código. Revisa tu conexión.</Text>
          <PrimaryButton label="REINTENTAR" variant="ghost" onPress={load} />
        </View>
      )}

      <PrimaryButton label="INVITAR AMIGOS 🎉" onPress={handleInvite} disabled={!info} />

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalReferred}</Text>
          <Text style={styles.statLabel}>INVITADOS</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalActivated}</Text>
          <Text style={styles.statLabel}>ACTIVADOS</Text>
        </Card>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  codeCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderColor: colors.accent,
  },
  errorBlock: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  codeLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  code: {
    ...typography.hero,
    color: colors.accent,
    letterSpacing: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.md,
  },
  statValue: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
