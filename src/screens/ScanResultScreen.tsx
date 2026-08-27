import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { mockScanResult } from '../services/mockData';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatPercent, formatXP } from '../utils/format';

const verdictLabel: Record<string, string> = {
  verified: '✅ Verified',
  pending: '⏳ Pending review',
  rejected: '❌ Rejected',
};

export default function ScanResultScreen() {
  // Placeholder result — a real scan will come from the AI scoring service.
  const result = mockScanResult;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Scan result</Text>
        <Text style={styles.subtitle}>{result.challengeTitle}</Text>
      </View>

      <Card style={styles.verdictCard}>
        <Text style={styles.verdict}>{verdictLabel[result.verdict]}</Text>
        <Text style={styles.xpEarned}>+{formatXP(result.xpEarned)}</Text>
        <View style={styles.confidenceRow}>
          <Text style={styles.confidenceLabel}>AI confidence</Text>
          <Text style={styles.confidenceValue}>{formatPercent(result.confidence)}</Text>
        </View>
      </Card>

      <Text style={styles.footnote}>This is placeholder data — real AI scoring isn't connected yet.</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  verdictCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  verdict: {
    ...typography.title,
    color: colors.success,
    marginBottom: spacing.sm,
  },
  xpEarned: {
    ...typography.hero,
    color: colors.accent,
    marginBottom: spacing.md,
  },
  confidenceRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  confidenceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  confidenceValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
