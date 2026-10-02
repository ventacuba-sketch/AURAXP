import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { getSession } from '../services/authService';
import { cancelPrivateChatRequest } from '../services/chatPrivateCancelService';
import {
  IncomingPrivateRequest,
  PrivateConversationSummary,
  fetchIncomingPrivateRequests,
  listPrivateConversations,
  respondToPrivateChatRequest,
} from '../services/chatPrivateService';
import { fetchOutgoingPendingPrivateUsernames } from '../services/chatPrivateUxService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatRelativeTime } from '../utils/format';

export default function ChatPrivateInboxScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const [requests, setRequests] = useState<IncomingPrivateRequest[]>([]);
  const [outgoing, setOutgoing] = useState<string[]>([]);
  const [conversations, setConversations] = useState<PrivateConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [cancellingUsername, setCancellingUsername] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    (async () => {
      const session = await getSession();
      const uid = session?.user.id ?? null;
      const [reqs, outgoingUsernames, convs] = await Promise.all([
        uid ? fetchIncomingPrivateRequests(uid) : Promise.resolve([]),
        uid ? fetchOutgoingPendingPrivateUsernames(uid) : Promise.resolve([]),
        listPrivateConversations(),
      ]);
      setRequests(reqs);
      setOutgoing(outgoingUsernames);
      setConversations(convs);
      setLoading(false);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      logEvent('chat_private_inbox_opened');
      load();
    }, [load]),
  );

  async function handleRespond(request: IncomingPrivateRequest, accept: boolean) {
    setRespondingId(request.id);
    const result = await respondToPrivateChatRequest(request.id, accept);
    setRespondingId(null);
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
    if (accept && result.ok && result.conversationId) {
      navigation.navigate('ChatPrivateConversation', {
        conversationId: result.conversationId,
        peerId: request.requesterId,
        peerUsername: request.requesterUsername,
        peerAvatarEmoji: request.requesterAvatarEmoji,
      });
    } else {
      load();
    }
  }

  async function handleCancel(username: string) {
    if (cancellingUsername) return;
    setCancellingUsername(username);
    const result = await cancelPrivateChatRequest(username);
    setCancellingUsername(null);
    if (result.ok || result.errorCode === 'not_pending') {
      setOutgoing((prev) => prev.filter((name) => name !== username));
    }
    load();
  }

  function openConversation(c: PrivateConversationSummary) {
    navigation.navigate('ChatPrivateConversation', {
      conversationId: c.conversationId,
      peerId: c.peerId,
      peerUsername: c.peerUsername,
      peerAvatarEmoji: c.peerAvatarEmoji,
    });
  }

  const hasHeaderContent = requests.length > 0 || outgoing.length > 0;

  return (
    <ScreenContainer onBack={goBack}>
      <Text style={styles.title}>💬 PRIVADOS</Text>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.conversationId}
          ListHeaderComponent={
            hasHeaderContent ? (
              <View style={styles.requestsBlock}>
                {requests.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>INVITACIONES RECIBIDAS</Text>
                    {requests.map((r) => (
                      <View key={r.id} style={styles.requestCard}>
                        <Text style={styles.requestText}>
                          <Text style={styles.requestName}>{r.requesterUsername}</Text> quiere iniciar un chat privado contigo.
                        </Text>
                        <View style={styles.requestActions}>
                          <Pressable
                            style={[styles.requestButton, styles.requestAccept]}
                            disabled={respondingId === r.id}
                            onPress={() => handleRespond(r, true)}
                          >
                            <Text style={styles.requestAcceptText}>Aceptar</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.requestButton, styles.requestReject]}
                            disabled={respondingId === r.id}
                            onPress={() => handleRespond(r, false)}
                          >
                            <Text style={styles.requestRejectText}>Rechazar</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {outgoing.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>INVITACIONES ENVIADAS</Text>
                    {outgoing.map((username) => (
                      <View key={username} style={styles.outgoingCard}>
                        <View style={styles.outgoingBody}>
                          <Text style={styles.requestName}>{username}</Text>
                          <Text style={styles.outgoingStatus}>⏳ Esperando respuesta</Text>
                        </View>
                        <Pressable
                          style={styles.cancelButton}
                          disabled={cancellingUsername === username}
                          onPress={() => void handleCancel(username)}
                        >
                          <Text style={styles.cancelButtonText}>
                            {cancellingUsername === username ? 'Cancelando...' : 'Cancelar invitación'}
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </>
                )}

                <Text style={styles.sectionLabel}>CONVERSACIONES</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            !hasHeaderContent ? (
              <View style={styles.centerState}>
                <Text style={styles.muted}>Todavía no tienes conversaciones privadas.</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable style={styles.conversationRow} onPress={() => openConversation(item)}>
              <Text style={styles.conversationAvatar}>{item.peerAvatarEmoji}</Text>
              <View style={styles.conversationBody}>
                <View style={styles.conversationHeader}>
                  <Text style={styles.conversationName}>{item.peerUsername}</Text>
                  <Text style={styles.conversationTime}>{formatRelativeTime(item.lastMessageAt)}</Text>
                </View>
                <View style={styles.conversationFooter}>
                  <Text style={styles.conversationPreview} numberOfLines={1}>
                    {item.lastMessageBody ?? '...'}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  centerState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  list: { paddingBottom: spacing.xl },
  requestsBlock: { marginBottom: spacing.sm, gap: spacing.sm },
  sectionLabel: { ...typography.eyebrow, color: colors.textMuted, marginTop: spacing.sm },
  requestCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  requestText: { ...typography.body, color: colors.textPrimary },
  requestName: { ...typography.body, color: colors.textPrimary, fontWeight: '800' },
  requestActions: { flexDirection: 'row', gap: spacing.sm },
  requestButton: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill },
  requestAccept: { backgroundColor: colors.accent },
  requestAcceptText: { ...typography.caption, color: colors.onAccent, fontWeight: '800' },
  requestReject: { borderWidth: 1, borderColor: colors.border },
  requestRejectText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  outgoingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  outgoingBody: { flex: 1, gap: 2 },
  outgoingStatus: { ...typography.caption, color: colors.textSecondary },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cancelButtonText: { ...typography.caption, color: colors.danger, fontWeight: '800' },
  conversationRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  conversationAvatar: { fontSize: 24 },
  conversationBody: { flex: 1, gap: 2 },
  conversationHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  conversationName: { ...typography.body, color: colors.textPrimary, fontWeight: '800' },
  conversationTime: { ...typography.caption, color: colors.textMuted },
  conversationFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  conversationPreview: { ...typography.caption, color: colors.textSecondary, flex: 1, marginRight: spacing.sm },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: { ...typography.caption, color: colors.onAccent, fontWeight: '800', fontSize: 11 },
});
