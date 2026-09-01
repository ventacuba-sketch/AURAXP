import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { logEvent } from '../services/analyticsService';
import { openProCheckout, PRO_MONTHLY_PRICE_USD, syncOwnProStatus } from '../services/planService';
import { colors, spacing, typography } from '../theme/colors';
import { useRootNavigation } from '../hooks/useRootNavigation';

const BENEFITS = [
  { emoji: '⚡', label: 'Scans ilimitados' },
  { emoji: '📊', label: 'Estadísticas avanzadas' },
  { emoji: '✨', label: 'Perks y cosméticos exclusivos' },
];

/**
 * Vende AURA VS PRO y abre el checkout externo (dLocal Go) -- ver
 * services/planService.ts. La suscripción NUNCA se activa acá por acción
 * del usuario -- no hay ningún botón "ya pagué". El único camino real es
 * sync-pro-subscriptions (ver planService.syncOwnProStatus): esta
 * pantalla lo dispara SOLA cuando la app vuelve a primer plano después de
 * haber abierto el checkout (AppState -> 'active'), que es el momento en
 * que alguien vuelve de haber pagado (o no) en la pestaña/app de dLocal.
 */
export default function ProScreen() {
  const navigation = useRootNavigation();
  const [checking, setChecking] = useState(false);
  const [activated, setActivated] = useState(false);
  const hasOpenedCheckoutRef = useRef(false);

  // Verificación silenciosa al entrar -- cubre el caso de alguien que ya
  // pagó antes y vuelve a esta pantalla más tarde (idempotente, no hace
  // nada nuevo si ya está PRO).
  useEffect(() => {
    syncOwnProStatus().then((ok) => {
      if (ok) setActivated(true);
    });
  }, []);

  // Verificación visible al volver del checkout externo -- se arma SOLO
  // después de tocar el CTA, así no dispara un "Verificando tu pago..."
  // falso la primera vez que la pantalla gana foco por cualquier otro motivo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !hasOpenedCheckoutRef.current) return;
      hasOpenedCheckoutRef.current = false;
      setChecking(true);
      syncOwnProStatus()
        .then((ok) => {
          if (ok) setActivated(true);
        })
        .finally(() => setChecking(false));
    });
    return () => sub.remove();
  }, []);

  function handleCheckoutPress() {
    hasOpenedCheckoutRef.current = true;
    logEvent('pro_checkout_opened');
    openProCheckout();
  }

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

        {activated && <Text style={styles.activatedBanner}>🎉 ¡Ya eres PRO! Scans ilimitados activados.</Text>}

        <Card style={styles.card}>
          {BENEFITS.map((b) => (
            <View key={b.label} style={styles.benefitRow}>
              <Text style={styles.benefitEmoji}>{b.emoji}</Text>
              <Text style={styles.benefitLabel}>{b.label}</Text>
            </View>
          ))}
        </Card>

        <View style={styles.actions}>
          {activated ? (
            <PrimaryButton label="VOLVER" onPress={() => navigation.navigate('MainTabs')} />
          ) : (
            <>
              <PrimaryButton
                label={
                  checking
                    ? 'VERIFICANDO TU PAGO...'
                    : `PASAR A PRO — US$${PRO_MONTHLY_PRICE_USD.toFixed(2)}/MES`
                }
                disabled={checking}
                onPress={handleCheckoutPress}
              />
              <Text style={styles.microcopy}>Suscripción mensual. Cancela cuando quieras.</Text>
              <PrimaryButton label="VOLVER" variant="text" disabled={checking} onPress={() => navigation.goBack()} />
            </>
          )}
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
  activatedBanner: {
    ...typography.subtitle,
    color: colors.accent,
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
