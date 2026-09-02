import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { GiftReceivedSheet } from '../components/GiftReceivedSheet';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import {
  AppNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatRelativeTime } from '../utils/format';

const COPY: Record<string, (rival: string) => string> = {
  challenge_received: (rival) => `⚔️ @${rival} te desafió`,
  challenge_accepted: (rival) => `@${rival} aceptó tu desafío`,
  challenge_rejected: (rival) => `@${rival} rechazó tu desafío`,
  challenge_completed_won: (rival) => `🏆 Le ganaste a @${rival}`,
  challenge_completed_lost: (rival) => `💀 @${rival} te ganó`,
  challenge_completed_tie: (rival) => `🤝 Empataste con @${rival}`,
  // Bloque Wallet/Coins/Social -- faltaban acá (auditoría pre-lanzamiento):
  // sin estos casos, las 3 caían en el fallback de "empataste" de más
  // abajo -- texto directamente incorrecto para un referido activado, un
  // follower nuevo o un regalo recibido.
  referral_activated: (rival) => `🎉 @${rival} hizo su primer Scan -- ganaste 5.000 Coins`,
  new_follower: (rival) => `@${rival} empezó a seguirte`,
};

/** Bug UX corregido: antes siempre "te mandó un regalo", sin decir cuál.
 * Ahora usa el nombre/emoji reales del catálogo cuando la notificación
 * pudo resolverlos (ver fetchNotifications) -- p. ej. "👏 @Cubanito te
 * envió Aplausos". Una fila vieja sin gift_id (de antes de esta
 * corrección, ver migración 20260907000000) no tiene giftName: cae al
 * texto genérico de siempre, nunca rompe. */
function giftReceivedText(rival: string, giftName: string | null, giftAssetRef: string | null): string {
  if (!giftName) return `🎁 @${rival} te mandó un regalo`;
  return `${giftAssetRef ?? '🎁'} @${rival} te envió ${giftName}`;
}

function notificationText(n: AppNotification): string {
  const rival = n.rivalUsername ?? 'alguien';
  if (n.kind === 'challenge_received') return COPY.challenge_received(rival);
  if (n.kind === 'challenge_accepted') return COPY.challenge_accepted(rival);
  if (n.kind === 'challenge_rejected') return COPY.challenge_rejected(rival);
  if (n.kind === 'referral_activated') return COPY.referral_activated(rival);
  if (n.kind === 'new_follower') return COPY.new_follower(rival);
  if (n.kind === 'gift_received') return giftReceivedText(rival, n.giftName, n.giftAssetRef);
  if (n.result === 'won') return COPY.challenge_completed_won(rival);
  if (n.result === 'lost') return COPY.challenge_completed_lost(rival);
  return COPY.challenge_completed_tie(rival);
}

export default function NotificationsScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  // Bug UX (gift_received) -- ver GiftReceivedSheet.
  const [giftSheetFor, setGiftSheetFor] = useState<AppNotification | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchNotifications().then((result) => {
      setItems(result);
      setLoading(false);
    });
  }, []);

  useFocusEffect(load);

  const hasUnread = items.some((n) => !n.read);

  async function handlePress(n: AppNotification) {
    if (!n.read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      markNotificationRead(n.id);
    }
    if (n.kind === 'gift_received') {
      // Bug UX corregido: antes esto iba directo al perfil del
      // remitente sin mostrar el regalo en ningún lado. Si se pudo
      // resolver (ver fetchNotifications), muestra el sheet con el
      // regalo real -- "VER PERFIL" adentro sigue ofreciendo el destino
      // de antes para quien lo quiera. Una fila vieja sin gift_id
      // (giftName null) cae al comportamiento anterior tal cual, nunca
      // se queda sin hacer nada al tocarla.
      if (n.giftName && n.rivalUsername) {
        setGiftSheetFor(n);
      } else if (n.rivalUsername) {
        navigation.navigate('PublicProfile', { username: n.rivalUsername });
      }
      return;
    }
    if (n.challengeShareToken) {
      navigation.navigate('Challenge', { challengeToken: n.challengeShareToken });
    } else if (n.kind === 'referral_activated') {
      // Mismo destino natural que el push equivalente ("🎉 Coins ganados") --
      // ver el saldo recién acreditado.
      navigation.navigate('Wallet');
    } else if (n.kind === 'new_follower' && n.rivalUsername) {
      navigation.navigate('PublicProfile', { username: n.rivalUsername });
    }
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await markAllNotificationsRead();
  }

  return (
    <>
      {giftSheetFor && giftSheetFor.giftName && giftSheetFor.rivalUsername && (
        <GiftReceivedSheet
          visible
          giftName={giftSheetFor.giftName}
          giftAssetRef={giftSheetFor.giftAssetRef}
          senderUsername={giftSheetFor.rivalUsername}
          senderAvatarEmoji={giftSheetFor.rivalAvatarEmoji}
          createdAt={giftSheetFor.createdAt}
          onViewProfile={() => {
            const username = giftSheetFor.rivalUsername!;
            setGiftSheetFor(null);
            navigation.navigate('PublicProfile', { username });
          }}
          onDismiss={() => setGiftSheetFor(null)}
        />
      )}
      <ScreenContainer scroll onBack={goBack}>
      <View style={styles.header}>
        <Text style={styles.title}>NOTIFICACIONES 🔔</Text>
        {hasUnread && (
          <Pressable onPress={handleMarkAll} hitSlop={6}>
            <Text style={styles.markAll}>Marcar todas leídas</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Sin notificaciones todavía.</Text>
          <Text style={styles.emptySubtext}>
            Cuando alguien acepte tu desafío o termine una batalla, aparece aquí.
          </Text>
          <PrimaryButton label="MIS DESAFÍOS" variant="ghost" onPress={() => navigation.navigate('MyChallenges')} />
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((n) => (
            <Pressable key={n.id} onPress={() => handlePress(n)}>
              <Card style={n.read ? styles.row : StyleSheet.flatten([styles.row, styles.rowUnread])}>
                <Text style={styles.rivalAvatar}>{n.rivalAvatarEmoji ?? '🔔'}</Text>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowText}>{notificationText(n)}</Text>
                  <Text style={styles.rowDate}>{formatRelativeTime(n.createdAt)}</Text>
                </View>
                {!n.read && <View style={styles.unreadDot} />}
              </Card>
            </Pressable>
          ))}
        </View>
      )}
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  markAll: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  center: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  emptyText: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowUnread: {
    borderColor: colors.secondary,
  },
  rivalAvatar: {
    fontSize: 28,
  },
  rowInfo: {
    flex: 1,
  },
  rowText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rowDate: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});
