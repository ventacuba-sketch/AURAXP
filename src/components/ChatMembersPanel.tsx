import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatMember } from '../services/chatPrivateService';
import { cancelPrivateChatRequest } from '../services/chatPrivateCancelService';
import { colors, radius, spacing, typography } from '../theme/colors';

const STATUS_LABELS: Record<string, string> = {
  farming_aura: '🔥 Farmeando Aura',
  looking_rival: '⚡ Buscando rival',
  chill: '😎 Chill',
  top_aura: '👑 Top Aura',
};

export interface ChatMembersPanelProps {
  members: ChatMember[];
  onlineUserIds: Set<string>;
  viewerUserId: string | null;
  viewerAuthed: boolean;
  activityLabel: string;
  followingByUsername: Record<string, boolean>;
  pendingPrivateUsernames: Set<string>;
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
  followingByUsername,
  pendingPrivateUsernames,
  onClose,
  onViewProfile,
  onFollow,
  onChallenge,
  onPrivateMessage,
}: ChatMembersPanelProps) {
  const [cancellingUsername, setCancellingUsername] = useState<string | null>(null);
  const [cancelErrorUsername, setCancelErrorUsername] = useState<string | null>(null);

  async function handlePrivateAction(member: ChatMember, privatePending: boolean) {
    if (!privatePending) {
      onPrivateMessage(member);
      return;
    }

    if (cancellingUsername) return;
    setCancellingUsername(member.username);
    setCancelErrorUsername(null);
    const result = await cancelPrivateChatRequest(member.username);
    setCancellingUsername(null);

    if (!result.ok) {
      setCancelErrorUsername(member.username);
      setTimeout(() => setCancelErrorUsername(null), 3500);
    }
  }

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
          const followStateKnown = Object.prototype.hasOwnProperty.call(followingByUsername, item.username);
          const isFollowing = followingByUsername[item.username] === true;
          const privatePending = pendingPrivateUsernames.has(item.username);
          const cancelling = cancellingUsername === item.username;
          const cancelError = cancelErrorUsername === item.username;

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
                  {followStateKnown && (
                    <Pressable style={styles.actionChip} onPress={() => (viewerAuthed ? onFollow(item.username) : onViewProfile(item.username))}>
                      <Text style={[styles.actionChipText, isFollowing && styles.followingText]}>{isFollowing ? '✓ Siguiendo' : '+ Seguir'}</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.actionChip} onPress={() => (viewerAuthed ? onChallenge(item.username) : onViewProfile(item.username))}>
                    <Text style={styles.actionChipText}>⚔️ Desafiar</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionChip, privatePending ? styles.cancelChip : styles.privateChip]}
                    onPress={() => void handlePrivateAction(item, privatePending)}
                    disabled={cancelling}
                  >
                    <Text style={privatePending ? styles.cancelChipText : styles.privateChipText}>
                      {privatePending ? (cancelling ? 'Cancelando...' : '✕ Cancelar invitación') : '💬 Privado'}
                    </Text>
                  </Pressable>
                  {cancelError && <Text style={styles.cancelError}>No se pudo cancelar. Intenta otra vez.</Text>}
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
  container: { flex: 1, backgroundColor: colors.surface },
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
  title: { ...typography.title, color: colors.textPrimary },
  activity: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  close: { ...typography.title, color: colors.textMuted, paddingHorizontal: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  row: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.xs },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { fontSize: 18 },
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
  rowText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  username: { ...typography.body, color: colors.textPrimary, fontWeight: '800' },
  level: { ...typography.caption, color: colors.textMuted },
  aura: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  status: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginLeft: 44 },
  actionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: colors.surfaceAlt,
  },
  actionChipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', fontSize: 11 },
  followingText: { color: colors.textSecondary },
  privateChip: { borderColor: colors.accent },
  privateChipText: { ...typography.caption, color: colors.accent, fontWeight: '800', fontSize: 11 },
  cancelChip: { borderColor: colors.danger },
  cancelChipText: { ...typography.caption, color: colors.danger, fontWeight: '800', fontSize: 11 },
  cancelError: { ...typography.caption, color: colors.danger, width: '100%', fontSize: 10 },
});
