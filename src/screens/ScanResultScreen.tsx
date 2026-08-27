import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuraScanner } from '../components/AuraScanner';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatMeter } from '../components/StatMeter';
import { TimelineRow } from '../components/TimelineRow';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { mockScanResult } from '../services/mockData';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatSignedXP } from '../utils/format';
import { shareText } from '../utils/share';

export default function ScanResultScreen() {
  // Placeholder result — a real scan will come from the AI scoring service.
  const result = mockScanResult;
  const navigation = useRootNavigation();

  return (
    <ScreenContainer scroll>
      {/* The shareable "poster" — everything a Story/TikTok export would need. */}
      <Card style={styles.heroCard}>
        <Text style={styles.eyebrow}>AURA REPLAY</Text>
        <Badge label={result.verdictTag} tone="accent" style={styles.verdictBadge} />
        <Text style={styles.score}>{formatSignedXP(result.xpEarned)} AURA</Text>
        <Text style={styles.verdict}>{result.verdictHeadline}</Text>

        <View style={styles.videoBox}>
          <AuraScanner progress={1} size={120}>
            <Text style={styles.playGlyph}>▶</Text>
          </AuraScanner>
        </View>

        <Text style={styles.disclaimer}>Puntuamos lo que hiciste, no cómo te ves.</Text>
      </Card>

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
        <StatMeter label="CONFIANZA" value={result.stats.confidence} />
        <StatMeter label="ESTILO" value={result.stats.style} />
        <StatMeter label="TIMING" value={result.stats.timing} />
        <StatMeter label="RIESGO CRINGE" value={result.stats.cringeRisk} tone="danger" />
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
  heroCard: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderColor: colors.secondary,
    alignItems: 'center',
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: spacing.sm,
  },
  verdictBadge: {
    alignSelf: 'center',
  },
  score: {
    ...typography.display,
    color: colors.accent,
    marginTop: spacing.md,
  },
  verdict: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  videoBox: {
    width: '100%',
    aspectRatio: 9 / 12,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    ...typography.title,
    color: colors.textPrimary,
    marginLeft: spacing.xs / 2,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
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
