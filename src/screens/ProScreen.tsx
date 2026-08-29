import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { openProCheckout, PRO_MONTHLY_PRICE_USD } from '../services/planService';
import { colors, spacing, typography } from '../theme/colors';
import { useRootNavigation } from '../hooks/useRootNavigation';

const BENEFITS = [
  { emoji: '⚡', label: 'Scans ilimitados' },
  { emoji: '📊', label: 'Estadísticas avanzadas' },
  { emoji: '✨', label: 'Perks y cosméticos exclusivos' },
];

/**
 * Vende AURA VS PRO y abre el checkout externo (dLocal Go) -- ver
 * services/planService.ts. La suscripción NO se activa acá ni al volver
 * del checkout: solo se activa server-side cuando llega confirmación real
 * de pago (ver supabase/functions/dlocal-webhook, todavía sin terminar de
 * conectar -- falta un identificador de usuario en el checkout/webhook de
 * dLocal). Por eso no hay ningún botón "ya pagué" acá: el único camino a
 * PRO es ese webhook.
 */
export default function ProScreen() {
  const navigation = useRootNavigation();

  return (
    // `scroll` no puede combinarse con alignItems/justifyContent en el
    // `style` de ScreenContainer -- eso va sobre el ScrollView mismo, y
    // react-native-web exige que el layout de los hijos viva en
    // contentContainerStyle, no ahí (ver ScreenContainer.tsx). El centrado
    // horizontal se hace acá adentro, en un View propio.
    <ScreenContainer scroll style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.eyebrow}>AURA VS PRO</Text>
        <Text style={styles.headline}>Lleva tu Aura al siguiente nivel</Text>
        <Text style={styles.price}>US$ {PRO_MONTHLY_PRICE_USD.toFixed(2)} / mes</Text>

        <Card style={styles.card}>
          {BENEFITS.map((b) => (
            <View key={b.label} style={styles.benefitRow}>
              <Text style={styles.benefitEmoji}>{b.emoji}</Text>
              <Text style={styles.benefitLabel}>{b.label}</Text>
            </View>
          ))}
        </Card>

        <View style={styles.actions}>
          <PrimaryButton
            label={`PASAR A PRO — US$${PRO_MONTHLY_PRICE_USD.toFixed(2)}/MES`}
            onPress={openProCheckout}
          />
          <Text style={styles.microcopy}>Suscripción mensual. Cancela cuando quieras.</Text>
          <PrimaryButton label="VOLVER" variant="text" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: spacing.xl,
  },
  center: {
    alignItems: 'center',
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
  price: {
    ...typography.display,
    color: colors.accent,
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
  actions: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  microcopy: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
