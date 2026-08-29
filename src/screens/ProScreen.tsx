import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { colors, spacing, typography } from '../theme/colors';

const BENEFITS = [
  { emoji: '⚡', label: 'Más Scans diarios' },
  { emoji: '📊', label: 'Estadísticas avanzadas' },
  { emoji: '✨', label: 'Perks y cosméticos exclusivos' },
];

/**
 * Placeholder de beneficios PRO -- el único punto de entrada hoy es el CTA
 * "PASAR A PRO" de DailyScanCounter, cuando se acerca o llega al límite
 * diario. Sin checkout todavía: el botón de abajo no cobra nada, solo
 * vuelve. Cuando exista un flujo de pago real, este es el único archivo
 * que necesita cambiar.
 */
export default function ProScreen() {
  const navigation = useRootNavigation();

  return (
    <ScreenContainer style={styles.center}>
      <Text style={styles.eyebrow}>AURA VS PRO</Text>
      <Text style={styles.headline}>Llevá tu Aura al siguiente nivel</Text>

      <Card style={styles.card}>
        {BENEFITS.map((b) => (
          <View key={b.label} style={styles.benefitRow}>
            <Text style={styles.benefitEmoji}>{b.emoji}</Text>
            <Text style={styles.benefitLabel}>{b.label}</Text>
          </View>
        ))}
      </Card>

      <Text style={styles.comingSoon}>Los pagos todavía no están disponibles -- muy pronto.</Text>

      <PrimaryButton label="VOLVER" variant="ghost" onPress={() => navigation.goBack()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.accent,
  },
  headline: {
    ...typography.hero,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    gap: spacing.md,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  benefitEmoji: {
    fontSize: 24,
  },
  benefitLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  comingSoon: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
