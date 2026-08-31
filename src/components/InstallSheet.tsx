import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  visible: boolean;
  variant: 'ios' | 'android';
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * Contenido visual puro de la invitación a instalar (R3/R4) -- sin
 * lógica de CUÁNDO mostrarse; eso vive en cada caller:
 * - InstallPrompt: el trigger automático de Home (R5/R6).
 * - ProfileScreen (AJUSTES -> "INSTALAR AURAXP", R7): el trigger manual,
 *   sin cooldown ni "value signal" -- alguien que entra a buscarlo a
 *   propósito no debería tener que cumplir ninguna condición.
 * Ambos comparten el mismo componente para que la invitación se vea y
 * lea exactamente igual sin importar por dónde se llegó.
 */
export function InstallSheet({ visible, variant, onInstall, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View style={styles.sheet}>
          {variant === 'android' ? (
            <>
              <Text style={styles.title}>INSTALAR AURAXP ⚡</Text>
              <Text style={styles.subtitle}>Ten AURAXP en tu pantalla de inicio y entra con un toque.</Text>
              <PrimaryButton label="INSTALAR" onPress={onInstall} />
              <PrimaryButton variant="text" label="Ahora no" onPress={onDismiss} />
            </>
          ) : (
            <>
              <Text style={styles.title}>LLEVA AURAXP CONTIGO ⚡</Text>
              <Text style={styles.subtitle}>Instálala en tu iPhone y entra con un toque.</Text>
              <View style={styles.steps}>
                <Step n={1} icon="⬆️" text="Toca Compartir" />
                <Step n={2} icon="➕" text='Selecciona "Añadir a pantalla de inicio"' />
                <Step n={3} icon="✅" text='Confirma "Añadir"' />
              </View>
              <PrimaryButton label="ENTENDIDO" onPress={onDismiss} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Step({ n, icon, text }: { n: number; icon: string; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNumber}>{n}</Text>
      </View>
      <Text style={styles.stepIcon}>{icon}</Text>
      <Text style={styles.stepText}>{text}</Text>
    </View>
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
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  steps: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.onAccent,
  },
  stepIcon: {
    fontSize: 18,
  },
  stepText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});
