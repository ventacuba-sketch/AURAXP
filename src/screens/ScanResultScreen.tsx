import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { AuraScanner } from '../components/AuraScanner';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatMeter } from '../components/StatMeter';
import { TimelineRow } from '../components/TimelineRow';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useScanResult } from '../hooks/useScanResult';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';
import { formatSignedXP } from '../utils/format';
import { shareText } from '../utils/share';

type ScanResultRoute = RouteProp<RootStackParamList, 'ScanResult'>;

export default function ScanResultScreen() {
  const { params } = useRoute<ScanResultRoute>();
  const { result, loading } = useScanResult(params?.scanId);
  const navigation = useRootNavigation();

  if (loading || !result) {
    return (
      <ScreenContainer style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      {/* The shareable "poster" — everything a Story/TikTok export would need. */}
      <Card style={styles.heroCard}>
        <Text style={styles.eyebrow}>AURA REPLAY</Text>
        <Badge label={result.verdictTag} tone="accent" style={styles.verdictBadge} />
        <Text style={styles.score}>{formatSignedXP(result.auraScore)} AURA</Text>
        <Text style={styles.verdict}>{result.verdictHeadline}</Text>

        <View style={styles.videoBox}>
          <AuraScanner progress={1} size={120}>
            <Text style={styles.playGlyph}>▶</Text>
          </AuraScanner>
        </View>

        <Text style={styles.disclaimer}>Puntuamos lo que hiciste, no cómo te ves.</Text>
      </Card>

      {result.xpAwarded > 0 && (
        <Text style={styles.xpLine}>+{result.xpAwarded} XP a tu progreso</Text>
      )}

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
        <PrimaryButton
          label="DESAFIAR A UN AMIGO"
          onPress={() => navigation.navigate('Challenge', { scanId: result.id })}
        />
        <PrimaryButton
          label="COMPARTIR RESULTADO"
          variant="ghost"
          onPress={() =>
            shareText(`Acabo de sacar ${formatSignedXP(result.auraScore)} AURA en AURAXP. Supéralo si puedes. 👀`)
          }
        />
        <PrimaryButton label="ESCANEAR DE NUEVO" variant="text" onPress={() => navigation.navigate('Upload')} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  xpLine: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
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
