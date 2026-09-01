import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { CoinTransaction, fetchTransactionHistory, fetchWallet, Wallet } from '../services/walletService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatRelativeTime } from '../utils/format';

const TYPE_LABEL: Record<string, string> = {
  signup_bonus: 'Bono de bienvenida',
  mission_reward: 'Misión completada',
  streak_bonus: 'Racha',
  referral_referrer_bonus: 'Referido activado',
  referral_referred_bonus: 'Bono por invitación',
  pro_monthly_bonus: 'PRO mensual',
  store_purchase: 'Compra en tienda',
  gift_sent: 'Regalo enviado',
};

/** Saldo + historial (bloque Wallet/Economía) -- de solo lectura: acá no
 * se toca ningún saldo, todo movimiento real pasa por apply_coin_
 * transaction() server-side (ver walletService.ts). */
export default function WalletScreen() {
  const goBack = useSmartBack();
  const navigation = useRootNavigation();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([fetchWallet(), fetchTransactionHistory()]).then(([w, tx]) => {
        if (cancelled) return;
        setWallet(w);
        setTransactions(tx);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>MI WALLET</Text>

      <Card style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>SALDO</Text>
        <Text style={styles.balanceValue}>{loading ? '···' : (wallet?.balance ?? 0).toLocaleString('es')}</Text>
        <Text style={styles.balanceUnit}>Coins</Text>
      </Card>

      <PrimaryButton label="IR A LA TIENDA 🛍️" onPress={() => navigation.navigate('Store')} />

      <Text style={styles.sectionTitle}>HISTORIAL</Text>
      {!loading && transactions.length === 0 && <Text style={styles.empty}>Todavía no hay movimientos.</Text>}
      {transactions.map((tx) => (
        <View key={tx.id} style={styles.txRow}>
          <View style={styles.txInfo}>
            <Text style={styles.txType}>{TYPE_LABEL[tx.type] ?? tx.type}</Text>
            <Text style={styles.txDate}>{formatRelativeTime(tx.createdAt)}</Text>
          </View>
          <Text style={[styles.txAmount, tx.amount >= 0 ? styles.txPositive : styles.txNegative]}>
            {tx.amount >= 0 ? '+' : ''}
            {tx.amount.toLocaleString('es')}
          </Text>
        </View>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  balanceCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderColor: colors.accent,
  },
  balanceLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  balanceValue: {
    ...typography.display,
    color: colors.accent,
  },
  balanceUnit: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txInfo: {
    flex: 1,
  },
  txType: {
    ...typography.body,
    color: colors.textPrimary,
  },
  txDate: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  txAmount: {
    ...typography.subtitle,
    fontWeight: '700',
  },
  txPositive: {
    color: colors.success,
  },
  txNegative: {
    color: colors.danger,
  },
});
