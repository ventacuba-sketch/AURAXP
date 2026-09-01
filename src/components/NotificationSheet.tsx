import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  visible: boolean;
  onActivate: () => void;
  onDismiss: () => void;
}

/**
 * Pre-prompt PROPIO de notificaciones (F) -- nunca el prompt nativo del
 * browser directo. Solo se llega hasta acá cuando `pushService` ya
 * decidió que corresponde mostrarlo (soportado, permiso todavía
 * 'default', política de reaparición ok) -- este componente es puramente
 * visual, igual que InstallSheet.
 */
export function NotificationSheet({ visible, onActivate, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Activa avisos para enterarte cuando te desafíen ⚔️</Text>
          <PrimaryButton label="ACTIVAR" onPress={onActivate} />
          <PrimaryButton variant="text" label="AHORA NO" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
