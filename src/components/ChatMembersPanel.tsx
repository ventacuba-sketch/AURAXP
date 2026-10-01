import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatMember } from '../services/chatPrivateService';
import { colors, radius, spacing, typography } from '../theme/colors';

const STATUS_LABELS: Record<string, string> = {
  farming_aura: '🔥 Farmeando Aura',
  looking_rival: '⚡ Buscando rival',
  chill: '😎 Chill',
  top_aura: '👑 Top Aura',
};

/**
 * Lista de Integrantes (Chat V2 "Sala Social", punto 2-3 del pedido) --
 * componente puro: ChatScreen decide CÓMO se muestra (Modal/bottom-sheet
 * en mobile, columna lateral fija en desktop/tablet ancho, ver el
 * useWindowDimensions ahí) y le pasa exactamente los mismos props en
 * ambos casos, para no duplicar esta lista en dos lugares.
 *
 * Reutiliza EXACTAMENTE los servicios ya existentes de Profile/Follow/
 * Challenge (los handlers vienen del caller) -- este archivo no define
 * ninguna lógica de negocio nueva, solo el layout de cada fila.
 */
export interface ChatMembersPanelProps {
  members: ChatMember[];
  onlineUserIds: Set<string>;
  viewerUserId: string | null;
  viewerAuthed: boolean;
  activityLabel: string;
  onClose?: () => void;
  onViewProfile: (username: string) => void;
  onFollow: (username: string) => void;
  onChallenge: (username: string) => void;
  onPrivateMessage: (member: ChatMember) => void;
}

export function ChatMembersPanel({
  members,
  onlineUserIds,
  viewerUserId,
  viewerAuthed,
  activityLabel,
  onClose,
  onViewProfile,
  onFollow,
  onChallenge,
  onPrivateMessage,
}: ChatMembersPanelProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>👥 Integrantes</Text>
          <Text style={styles.activity}>{activityLabel}</Text>
        </View>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Nadie activo todavía -- ¡sé el primero! 👀</Text>}
        renderItem={({ item }) => {
          const isMe = item.id === viewerUserId;
          const online = onlineUserIds.has(item.id);
          return (
            <View style={styles.row}>
              <Pressable onPress={() => onViewProfile(item.username)} style={styles.rowMain} hitSlop={4}>
                <View style={styles.avatarWrap}>
                  <Text style={styles.avatar}>{item.avatarEmoji}</Text>
                  {online && <View style={styles.onlineDot} />}
                </View>
                <View style={styles.rowText}>
                  <View style={styles.nameLine}>
                    <Text style={styles.username}>
                      {item.username}
                      {isMe ? ' (tú)' : ''}
                    </Text>
                    <Text style={styles.level}>👑 Nivel {item.level}</Text>
                  </View>
                  <View style={styles.nameLine}>
                    {item.lastAuraScore != null && <Text style={styles.aura}>{item.lastAuraScore} Aura</Text>}
                    {item.chatStatus && <Text style={styles.status}>{STATUS_LABELS[item.chatStatus] ?? item.chatStatus}</Text>}
                  </View>
                </View>
              </Pressable>

              {!isMe && (
                <View style={styles.actions}>
                  <Pressable
                    style={styles.actionChip}
                    onPress={() => (viewerAuthed ? onFollow(item.username) : onViewProfile(item.username))}
                  >
                    <Text style={styles.actionChipText}>+ Seguir</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actionChip}
                    onPress={() => (viewerAuthed ? onChallenge(item.username) : onViewProfile(item.username))}
                  >
                    <Text style={styles.actionChipText}>⚔️ Desafiar</Text>
                  </Pressable>
                  <Pressable style={styles.actionChip} onPress={() => onPrivateMessage(item)}>
                    <Text style={styles.actionChipText}>💬</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  activity: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  close: {
    ...typography.title,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    fontSize: 18,
  },
  onlineDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  username: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  level: {
    ...typography.caption,
    color: colors.textMuted,
  },
  aura: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  status: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: 44,
  },
  actionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceAlt,
  },
  actionChipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 11,
  },
});
