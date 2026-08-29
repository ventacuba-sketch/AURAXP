import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { PrimaryButton } from './PrimaryButton';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { DailyScanStatus, fetchDailyScanStatus } from '../services/scanService';
import { colors, radius, spacing, typography } from '../theme/colors';

// A partir de acá el tono pasa de "normal" a "pocos restantes" -- 2 Scans
// libres o menos, todavía sin haber llegado al límite.
const LOW_REMAINING_THRESHOLD = 2;

/**
 * "Scans de hoy: X / CAP" -- el dato sale siempre del backend real
 * (daily_scan_counts vía get-daily-scan-status, ver scanService.ts), nunca
 * estimado acá. Se refresca cada vez que la pantalla que lo contiene
 * vuelve a foco: terminar un Scan siempre termina volviendo a un tab
 * (Home/Profile), lo que dispara este mismo refetch sin necesitar un
 * evento dedicado.
 *
 * Cuenta de prueba (UNLIMITED_TEST_USER_IDS): se muestra un badge propio
 * ("Scans ilimitados (TEST)") en vez del contador -- nunca ambos mezclados,
 * para no confundir "sin límite" con "0 usados hoy".
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

  if (status.unlimited) {
    return (
      <View style={[styles.row, styles.unlimitedRow]}>
        <Text style={styles.unlimitedText}>Scans ilimitados (TEST)</Text>
      </View>
    );
  }

  const remaining = status.cap - status.count;
  const atLimit = remaining <= 0;
  const low = !atLimit && remaining <= LOW_REMAINING_THRESHOLD;

  return (
    <View style={[styles.row, low && styles.lowRow, atLimit && styles.atLimitRow]}>
      <View style={styles.textBlock}>
        <Text style={[styles.countText, low && styles.lowText, atLimit && styles.atLimitText]}>
          Scans de hoy: {status.count} / {status.cap}
        </Text>
        {atLimit && <Text style={styles.subText}>Alcanzaste tu límite diario.</Text>}
        {low && <Text style={styles.subText}>Te quedan pocos Scans hoy.</Text>}
      </View>
      <PrimaryButton
        label="PASAR A PRO"
        variant={atLimit ? 'primary' : 'ghost'}
        onPress={() => navigation.navigate('Pro')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  unlimitedRow: {
    justifyContent: 'center',
  },
  unlimitedText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
