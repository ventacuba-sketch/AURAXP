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
 * Contenido visual puro de la invitación a instalar (C/D/N) -- sin lógica
 * de CUÁNDO mostrarse; eso vive en cada caller:
 * - InstallInviteHost: el trigger automático centralizado (A/B), montado
 *   una sola vez a nivel raíz.
 * - ProfileScreen (card fija "📲 Instalar AURAXP", N): el trigger manual,
 *   sin política ni cooldown -- alguien que entra a buscarlo a propósito
 *   no debería tener que cumplir ninguna condición.
 * Ambos comparten el mismo componente para que la invitación se vea y
 * lea exactamente igual sin importar por dónde se llegó (N2).
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
              <Text style={styles.title}>LLEVA AURAXP A TU INICIO ⚡</Text>
              <Text style={styles.subtitle}>Entra con un toque, como una app.</Text>

              {/* Mockup CONCEPTUAL de la barra de Safari -- no un overlay
                  sobre la pantalla real ni una coordenada fija: Safari
                  puede tener su barra arriba o abajo según el iPhone/
                  versión de iOS, así que señalar un punto exacto de la
                  pantalla real rompería en la mitad de los casos. Estilo
                  deliberadamente gris/neutro (no lima/violeta de AURAXP)
                  para que se lea como "esto es del navegador", no de la
                  app -- la leyenda de abajo lo dice también en texto, sin
                  depender solo del color. */}
              <View style={styles.safariBar}>
                <View style={styles.safariBarUrl}>
                  <Text style={styles.safariBarUrlText} numberOfLines={1}>
                    🔒 auravs.app
                  </Text>
                </View>
                <View style={styles.safariShareIcon}>
                  <Text style={styles.safariShareIconGlyph}>⬆</Text>
                </View>
              </View>
              <Text style={styles.safariBarCaption}>
                El botón Compartir vive en la barra de Safari -- arriba o abajo según tu iPhone -- no dentro de AURAXP.
              </Text>

              <View style={styles.steps}>
                <Step n={1} icon="⬆️" text="Toca el botón Compartir de Safari" />
                <Step n={2} icon="👇" text="Desplázate hacia abajo" />
                <Step n={3} icon="➕" text='Toca "Añadir a pantalla de inicio"' />
                <Step n={4} icon="🌐" text='Si aparece, activa "Abrir como app web"' />
                <Step n={5} icon="✅" text='Toca "Añadir"' />
              </View>

              <Text style={styles.fallbackHint}>
                ¿No ves "Añadir a pantalla de inicio"? Desliza hasta el final y toca "Editar acciones" para agregarla.
              </Text>

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
  fallbackHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  // Mockup de barra de Safari -- gris neutro a propósito, ver comentario
  // en el JSX de arriba: nunca los colores propios de AURAXP acá, la
  // idea entera es que se lea como "otra interfaz", no como parte de la app.
  safariBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E8E8ED',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#C7C7CC',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  safariBarUrl: {
    flex: 1,
    backgroundColor: '#D6D6DC',
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  safariBarUrlText: {
    ...typography.caption,
    color: '#1C1C1E',
    textAlign: 'center',
  },
  safariShareIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  safariShareIconGlyph: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  safariBarCaption: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
});
