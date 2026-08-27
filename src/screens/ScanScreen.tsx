import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, spacing, typography } from '../theme/colors';
import { MainTabParamList, RootStackParamList } from '../types';

// This tab lives inside MainTabNavigator, but "Scan" is an action, not a
// destination — tapping through pushes the Upload/Capture flow onto the
// parent root stack, so the nav type is a composite of both.
type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Scan'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function ScanScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Ready to scan? 🎯</Text>
        <Text style={styles.subtitle}>Capture proof for your active challenge and earn XP.</Text>
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardText}>
          Tap below to open the capture flow, submit your proof, and see your result.
        </Text>
      </Card>

      <PrimaryButton label="Start scan" onPress={() => navigation.navigate('Upload')} />
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
  card: {
    marginBottom: spacing.lg,
  },
  cardText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
