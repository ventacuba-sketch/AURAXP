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
      <View>
        <View style={styles.header}>
          <Text style={styles.title}>MUÉSTRANOS EL MOMENTO</Text>
          <Text style={styles.subtitle}>Entre 5 y 8 segundos funciona mejor.</Text>
        </View>

        <View style={styles.options}>
          <CaptureOption
            label="GRABAR VIDEO"
            icon="●"
            selected={selected === 'record'}
            onPress={() => setSelected('record')}
          />
          <CaptureOption
            label="SUBIR VIDEO"
            icon="⬆"
            selected={selected === 'upload'}
            onPress={() => setSelected('upload')}
          />
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

interface CaptureOptionProps {
  label: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
}

function CaptureOption({ label, icon, selected, onPress }: CaptureOptionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <Text style={[styles.optionIcon, selected && styles.optionIconSelected]}>{icon}</Text>
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
  },
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
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
  options: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  option: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  optionIcon: {
    fontSize: 28,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  optionIconSelected: {
    color: colors.accent,
  },
  optionLabel: {
    ...typography.subtitle,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  optionLabelSelected: {
    color: colors.accent,
  },
  guidelines: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  guideline: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
