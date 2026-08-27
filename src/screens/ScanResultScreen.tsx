import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReplayPlaceholder } from '../components/ReplayPlaceholder';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatTile } from '../components/StatTile';
import { TimelineRow } from '../components/TimelineRow';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { mockScanResult } from '../services/mockData';
import { colors, spacing, typography } from '../theme/colors';
import { formatSignedXP } from '../utils/format';
import { shareText } from '../utils/share';

export default function ScanResultScreen() {
  // Placeholder result — a real scan will come from the AI scoring service.
  const result = mockScanResult;
  const navigation = useRootNavigation();

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>AURA REPLAY</Text>
        <Text style={styles.score}>{formatSignedXP(result.xpEarned)} AURA</Text>
        <Text style={styles.verdict}>{result.verdictHeadline}</Text>
        <Text style={styles.disclaimer}>Puntuamos lo que hiciste, no cómo te ves.</Text>
      </View>

      <ReplayPlaceholder size="lg" style={styles.replay} />

      <Text style={styles.sectionLabel}>DESGLOSE</Text>
      <Card style={styles.timelineCard}>
        {result.timeline.map((event, index) => (
          <React.Fragment key={event.time}>
            <TimelineRow {...event} />
            {index < result.timeline.length - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </Card>

      <View style={styles.statsGrid}>
        <StatTile label="CONFIANZA" value={result.stats.confidence.toFixed(1)} />
        <StatTile label="ESTILO" value={result.stats.style.toFixed(1)} />
        <StatTile label="TIMING" value={result.stats.timing.toFixed(1)} />
        <StatTile label="RIESGO CRINGE" value={result.stats.cringeRisk.toFixed(1)} />
      </View>

      <View style={styles.actions}>
        <PrimaryButton label="DESAFIAR A UN AMIGO" onPress={() => navigation.navigate('Challenge')} />
        <PrimaryButton
          label="COMPARTIR RESULTADO"
          variant="ghost"
          onPress={() =>
            shareText(`Acabo de sacar ${formatSignedXP(result.xpEarned)} AURA en AURAXP. Supéralo si puedes. 👀`)
          }
        />
        <PrimaryButton label="ESCANEAR DE NUEVO" variant="text" onPress={() => navigation.navigate('Upload')} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: spacing.sm,
  },
  score: {
    ...typography.display,
    color: colors.accent,
  },
  verdict: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  replay: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  timelineCard: {
    marginBottom: spacing.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
});
