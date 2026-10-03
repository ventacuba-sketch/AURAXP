import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { LiveHostProfile, LiveRoom, canCurrentUserHostLive, fetchLiveHostProfiles, fetchLiveRoomsNow } from '../services/liveService';
import { colors, radius, spacing, typography } from '../theme/colors';

const AURA_LIVE_ENABLED = process.env.EXPO_PUBLIC_AURA_LIVE_ENABLED === 'true';

/**
 * "EN VIVO AHORA" -- convierte el lobby de Chat V2 en la puerta de
 * entrada a AURA LIVE (sección 15 del pedido). Componente propio
 * (no inline en ChatScreen.tsx) a propósito -- sección 30: "evita
 * convertir ChatScreen.tsx en un archivo gigantesco con toda la lógica
 * de video". Nunca muestra datos falsos: sin LIVEs activos, no renderiza
 * nada (ni el título de la sección).
 */
export function LiveLobbyCard() {
  const navigation = useRootNavigation();
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [hostProfiles, setHostProfiles] = useState<Record<string, LiveHostProfile>>({});
  const [canHost, setCanHost] = useState(false);

  const load = useCallback(async () => {
    if (!AURA_LIVE_ENABLED) return;
    const list = await fetchLiveRoomsNow();
    setRooms(list);
    const profiles = await fetchLiveHostProfiles(list.map((r) => r.hostUserId));
    setHostProfiles(profiles);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!AURA_LIVE_ENABLED) return;
    canCurrentUserHostLive().then(setCanHost);
  }, []);

  if (!AURA_LIVE_ENABLED) return null;
  if (!rooms.length && !canHost) return null;

  function openRoom(room: LiveRoom) {
    logEvent('live_lobby_viewed', { live_room_id: room.id });
    navigation.navigate('LiveRoom', { slug: room.slug });
  }

  return (
    <View style={styles.container}>
      {rooms.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>🔴 EN VIVO AHORA</Text>
          <FlatList
            horizontal
            data={rooms}
            keyExtractor={(r) => r.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable style={styles.card} onPress={() => openRoom(item)}>
                <Text style={styles.cardBadge}>🔴 EN VIVO</Text>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardHost}>@{hostProfiles[item.hostUserId]?.username ?? '...'}</Text>
                <Text style={styles.cardViewers}>👁 {item.peakViewers}</Text>
                <View style={styles.cardCta}>
                  <Text style={styles.cardCtaText}>ENTRAR</Text>
                </View>
              </Pressable>
            )}
          />
        </>
      )}
      {canHost && (
        <Pressable style={styles.startButton} onPress={() => navigation.navigate('LiveCreate')}>
          <Text style={styles.startButtonText}>+ Iniciar LIVE</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  sectionLabel: {
    ...typography.eyebrow,
    color: colors.danger,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    width: 150,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 2,
  },
  cardBadge: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '800',
    fontSize: 10,
  },
  cardTitle: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  cardHost: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  cardViewers: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  cardCta: {
    marginTop: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 4,
    alignItems: 'center',
  },
  cardCtaText: {
    ...typography.caption,
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: 11,
  },
  startButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  startButtonText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
  },
});
