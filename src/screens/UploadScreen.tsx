import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Upload'>;

export default function UploadScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Prove it 📸</Text>
        <Text style={styles.subtitle}>Upload a photo or video for your active challenge.</Text>
      </View>

      <Card style={styles.dropZone}>
        <Text style={styles.dropIcon}>⬆️</Text>
        <Text style={styles.dropText}>Tap to select media</Text>
        <Text style={styles.dropHint}>(placeholder — no upload wired up yet)</Text>
      </Card>

      <PrimaryButton
        label="Submit for scoring"
        onPress={() => navigation.navigate('ScanResult', undefined)}
      />
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
  dropZone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.lg,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
  },
  dropIcon: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  dropText: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  dropHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
