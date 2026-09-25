import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { PrimaryButton } from './PrimaryButton';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { DailyScanStatus, fetchDailyScanStatus } from '../services/scanService';
import { colors, radius, spacing, typography } from '../theme/colors';

/**
 * "Scans de hoy: X / CAP" -- el dato sale siempre del backend real
 * (daily_scan_counts + profiles.plan vía get-daily-scan-status, ver
 * scanService.ts), nunca estimado ni recalculado acá. Se refresca cada vez
 * que la pantalla que lo contiene vuelve a foco: terminar un Scan siempre
 * termina volviendo a un tab (Home/Profile), lo que dispara este mismo
 * refetch sin necesitar un evento dedicado.
 *
 * Cuatro estados posibles, mutuamente excluyentes:
 * 1. Cuenta de prueba (UNLIMITED_TEST_USER_IDS) -- badge propio, sin
 *    número, sea cual sea su plan real.
 * 2. PRO -- "PRO · Scans ilimitados". El backend jamás manda el techo de
 *    fair-use (100) acá, así que ni por error se podría mostrar "14/100".
 * 3. FREE cerca/en el límite -- tono violeta (pocos restantes) o rojo
 *    (límite alcanzado) + CTA "PASAR A PRO" más presente.
 * 4. FREE normal -- contador neutro, con el badge de bienvenida si todavía
 *    está en la ventana de los primeros 15 días.
 *
 * Sin sesión/Supabase no configurado: fetchDailyScanStatus() devuelve
 * null y este componente no renderiza nada (mejor eso que un número
 * inventado).
 */
export function DailyScanCounter() {
  const navigation = useRootNavigation();
  const [status, setStatus] = useState<DailyScanStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchDailyScanStatus().then((result) => {
        if (!cancelled && result) setStatus(result);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (!status) return null;

  // Aviso no bloqueante -- ver migración system_status. En 'normal' (hoy el
  // único modo que existe) esto no renderiza nada; solo aparece si alguna
  // vez se activa a mano desde el Dashboard.
  const systemNotice =
    status.systemMode === 'emergency'
      ? status.systemMessage ?? 'Los análisis están pausados temporalmente. Intenta más tarde.'
      : status.systemMode === 'high_demand'
        ? status.systemMessage ?? 'Alta demanda: los análisis pueden tardar más de lo usual.'
        : null;

  if (status.unlimited) {
    // Limpieza pre-lanzamiento: antes decía "(TEST)" -- una cuenta de
    // prueba puede seguir existiendo internamente (UNLIMITED_TEST_USER_IDS,
    // ver dailyLimit.ts), pero ningún texto visible debe delatarla como
    // tal. El estilo propio (styles.testText, distinto del de PRO)
    // sigue diferenciando este caso visualmente sin necesitar la palabra.
    return (
      <View style={styles.wrapper}>
        {systemNotice && <Text style={styles.systemNotice}>{systemNotice}</Text>}
        <View style={[styles.row, styles.badgeRow]}>
          <Text style={styles.testText}>Scans ilimitados</Text>
        </View>
      </View>
    );
  }

  if (status.plan === 'pro') {
    return (
      <View style={styles.wrapper}>
        {systemNotice && <Text style={styles.systemNotice}>{systemNotice}</Text>}
        <View style={[styles.row, styles.badgeRow, styles.proRow]}>
          <Text style={styles.proText}>PRO · Scans ilimitados</Text>
        </View>
      </View>
    );
  }

  const cap = status.cap ?? 0;
  const remaining = cap - status.count;
  const atLimit = remaining <= 0;
  // Umbral de "pocos restantes" proporcional al cap (5 -> queda <=2, 3 -> queda <=1)
  // en vez de un número fijo -- con un cap de 3 un fijo de "2" dispararía el
  // aviso desde el primer Scan, demasiado temprano.
  const lowThreshold = Math.max(1, Math.floor(cap * 0.4));
  const low = !atLimit && remaining <= lowThreshold;

  return (
    <View style={styles.wrapper}>
      {systemNotice && <Text style={styles.systemNotice}>{systemNotice}</Text>}
      {status.inLaunchWindow && (
        <View style={styles.launchBadge}>
          <Text style={styles.launchText}>
            ✨ Beneficio de bienvenida{status.launchDaysLeft > 0 ? ` · quedan ${status.launchDaysLeft} días` : ''}
          </Text>
        </View>
      )}

      <View style={[styles.row, low && styles.lowRow, atLimit && styles.atLimitRow]}>
        <View style={styles.textBlock}>
          <Text style={[styles.countText, low && styles.lowText, atLimit && styles.atLimitText]}>
            Scans de hoy: {status.count} / {cap}
          </Text>
          {atLimit && <Text style={styles.subText}>Alcanzaste tus Scans gratuitos de hoy.</Text>}
          {low && <Text style={styles.subText}>Te quedan pocos Scans hoy.</Text>}
        </View>
        <PrimaryButton
          label="PASAR A PRO"
          variant={atLimit ? 'primary' : 'ghost'}
          onPress={() => navigation.navigate('Pro')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.lg,
  },
  systemNotice: {
    ...typography.caption,
    color: colors.secondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  badgeRow: {
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  textBlock: {
    flexShrink: 1,
  },
  countText: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  subText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  lowRow: {
    borderColor: colors.secondary,
  },
  lowText: {
    color: colors.secondary,
  },
  atLimitRow: {
    borderColor: colors.danger,
  },
  atLimitText: {
    color: colors.danger,
  },
  testText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  proRow: {
    borderColor: colors.accent,
  },
  proText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  launchBadge: {
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  launchText: {
    ...typography.caption,
    color: colors.secondary,
    fontWeight: '600',
  },
});
