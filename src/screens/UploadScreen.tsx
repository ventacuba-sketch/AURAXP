import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { colors, radius, spacing, typography } from '../theme/colors';

type CaptureMode = 'record' | 'upload';

const GUIDELINES = [
  'Máximo 8 segundos',
  'Procura que se vea la acción completa.',
  'AURAXP analiza el momento, no tu apariencia.',
];

export default function UploadScreen() {
  const navigation = useRootNavigation();
  // Mock "selected" state — no real camera/file picker wired up yet.
  const [selected, setSelected] = useState<CaptureMode | null>(null);

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>MUÉSTRANOS EL MOMENTO</Text>
        <Text style={styles.subtitle}>Entre 5 y 8 segundos funciona mejor.</Text>
      </View>

      {/* Fills the space between the header and the pinned CTA, centering
          the capture action in it instead of leaving a dead gap below. */}
      <View style={styles.middle}>
        <View style={styles.captureArea}>
          <Pressable
            onPress={() => setSelected('record')}
            style={styles.recordWrap}
            hitSlop={8}
          >
            <View style={[styles.recordCircle, selected === 'record' && styles.recordCircleActive]}>
              <View style={styles.recordDot} />
            </View>
            <Text style={[styles.recordLabel, selected === 'record' && styles.recordLabelActive]}>
              GRABAR VIDEO
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelected('upload')}
            style={[styles.uploadOption, selected === 'upload' && styles.uploadOptionActive]}
          >
            <Text style={[styles.uploadIcon, selected === 'upload' && styles.uploadTextActive]}>⬆</Text>
            <Text style={[styles.uploadLabel, selected === 'upload' && styles.uploadTextActive]}>
              SUBIR VIDEO
            </Text>
          </Pressable>
        </View>

        <View style={styles.guidelines}>
          {GUIDELINES.map((line) => (
            <Text key={line} style={styles.guideline}>
              •  {line}
            </Text>
          ))}
        </View>
      </View>

      <PrimaryButton
        label="ANALIZAR MI AURA"
        disabled={!selected}
        onPress={() => navigation.navigate('Analyzing')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.lg,
  },
  header: {
    marginTop: spacing.lg,
  },
  middle: {
    flex: 1,
    justifyContent: 'center',
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
  captureArea: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  recordWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  recordCircle: {
    width: 176,
    height: 176,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCircleActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  recordDot: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  recordLabel: {
    ...typography.subtitle,
    color: colors.textPrimary,
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  recordLabelActive: {
    color: colors.accent,
  },
  uploadOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  uploadOptionActive: {
    borderColor: colors.accent,
  },
  uploadIcon: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  uploadLabel: {
    ...typography.body,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  uploadTextActive: {
    color: colors.accent,
  },
  guidelines: {
    gap: spacing.xs,
  },
  guideline: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
