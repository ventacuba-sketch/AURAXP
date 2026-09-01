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

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([fetchMyReferralInfo(), fetchMyReferralStats()]).then(([i, s]) => {
        if (cancelled) return;
        setInfo(i);
        setStats(s);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  async function handleInvite() {
    if (!info) return;
    logEvent('referral_sent');
    await shareText('Te invito a AURAXP -- medí tu Aura y ganá Coins con tu primer Scan ⚡', info.shareUrl);
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>INVITAR AMIGOS</Text>
      <Text style={styles.subtitle}>Vos ganás 5.000 Coins y tu amigo 2.500, apenas haga su primer Scan.</Text>

      {info && (
        <Card style={styles.codeCard}>
          <Text style={styles.codeLabel}>TU CÓDIGO</Text>
          <Text style={styles.code}>{info.code}</Text>
        </Card>
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
