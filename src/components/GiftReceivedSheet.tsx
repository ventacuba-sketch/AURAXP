import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';
import { formatRelativeTime } from '../utils/format';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  visible: boolean;
  giftName: string;
  giftAssetRef: string | null;
  senderUsername: string;
  senderAvatarEmoji: string | null;
  createdAt: string;
  onViewProfile: () => void;
  onDismiss: () => void;
}

/**
 * Bug UX corregido: la notificación gift_received nunca mostraba QUÉ
 * regalo llegó -- tocarla iba directo al perfil del remitente sin
 * ningún rastro del regalo. Esta es la "vista mínima" pedida: un sheet
 * simple (mismo patrón Modal/backdrop que InstallSheet, nada nuevo en
 * navegación) que muestra el regalo con su nombre/emoji reales del
 * catálogo, resueltos server-side vía gift_id (ver notificationService.
 * fetchNotifications) -- nunca el genérico "un regalo" de antes.
 *
 * Puramente informativo: no toca Coins ni ningún saldo, solo lee datos
 * ya resueltos (ver notificationService.ts) y ofrece "VER PERFIL" como
 * salida opcional a lo que antes era el único destino.
 */
export function GiftReceivedSheet({
  visible,
  giftName,
  giftAssetRef,
  senderUsername,
  senderAvatarEmoji,
  createdAt,
  onViewProfile,
  onDismiss,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>REGALO RECIBIDO</Text>
          <Text style={styles.giftEmoji}>{giftAssetRef ?? '🎁'}</Text>
          <Text style={styles.giftName}>{giftName}</Text>
          <Text style={styles.fromLine}>
            {senderAvatarEmoji ?? '👤'} De @{senderUsername} · {formatRelativeTime(createdAt)}
          </Text>
          <PrimaryButton label={`VER PERFIL DE @${senderUsername}`} variant="ghost" onPress={onViewProfile} />
          <PrimaryButton label="CERRAR" variant="text" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.textMuted,
  },
  giftEmoji: {
    fontSize: 56,
    marginTop: spacing.xs,
  },
  giftName: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  fromLine: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
});
