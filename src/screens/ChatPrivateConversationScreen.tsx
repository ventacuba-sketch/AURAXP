import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { getSession } from '../services/authService';
import {
  PRIVATE_MESSAGE_MAX_LENGTH,
  PRIVATE_MESSAGE_PAGE_SIZE,
  PrivateMessage,
  blockUser,
  fetchPrivateMessages,
  markPrivateConversationRead,
  sendPrivateMessage,
  subscribeToPrivateMessages,
} from '../services/chatPrivateService';
import { ChatPresenceState, derivePeerStatusLabel, joinChatPresence } from '../services/chatPresenceService';
import { RootStackParamList } from '../types';
import { colors, radius, spacing, typography } from '../theme/colors';

type ConversationRoute = RouteProp<RootStackParamList, 'ChatPrivateConversation'>;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Conversación privada 1:1 (Chat V2 "Sala Social", punto 5 del pedido) --
 * pantalla completa (mobile-first, punto 10), solo llega acá alguien con
 * una conversación YA aceptada (ver ChatPrivateInboxScreen/
 * respond_private_chat_request). Mismo patrón de Realtime + fallback
 * explícito que Chat V1: el refresh tras enviar nunca depende
 * exclusivamente de que el canal entregue el evento.
 */
export default function ChatPrivateConversationScreen() {
  const { params } = useRoute<ConversationRoute>();
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const listRef = useRef<FlatList<PrivateMessage>>(null);

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [presence, setPresence] = useState<ChatPresenceState>({ subscribed: false, onlineCount: 0, onlineUserIds: new Set() });
  // Punto 8 del pedido (bloqueo) -- confirmación inline de 2 pasos en vez
  // de Alert.alert (no-op real en react-native-web, ver el mismo
  // comentario en UploadScreen.tsx -- AURAXP es web-first).
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    getSession().then((s) => setMyUserId(s?.user.id ?? null));
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { messages: recent, error } = await fetchPrivateMessages(params.conversationId);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setMessages([...recent].reverse());
    setHasMore(recent.length === PRIVATE_MESSAGE_PAGE_SIZE);
    setLoading(false);
  }, [params.conversationId]);

  useFocusEffect(
    useCallback(() => {
      logEvent('chat_private_conversation_opened', { conversation_id: params.conversationId });
      loadInitial();
      void markPrivateConversationRead(params.conversationId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.conversationId]),
  );

  useEffect(() => {
    if (!myUserId) return;
    return joinChatPresence({ userId: myUserId, guestId: null }, setPresence);
  }, [myUserId]);

  useEffect(() => {
    const unsub = subscribeToPrivateMessages(params.conversationId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      void markPrivateConversationRead(params.conversationId);
    });
    return unsub;
  }, [params.conversationId]);

  async function loadMore() {
    if (loadingMore || !hasMore || !messages.length) return;
    setLoadingMore(true);
    const { messages: older, error } = await fetchPrivateMessages(params.conversationId, messages[0].createdAt);
    setLoadingMore(false);
    if (error) return;
    setHasMore(older.length === PRIVATE_MESSAGE_PAGE_SIZE);
    setMessages((prev) => [...[...older].reverse(), ...prev]);
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    const result = await sendPrivateMessage(params.conversationId, body);
    setSending(false);
    if (!result.ok) {
      setSendError(
        result.errorCode === 'rate_limited'
          ? 'Vas muy rápido -- espera unos segundos.'
          : result.errorCode === 'blocked'
            ? 'No puedes enviar mensajes en esta conversación.'
            : 'No pudimos enviar tu mensaje. Intenta de nuevo.',
      );
      return;
    }
    setDraft('');
    // Realtime es best-effort (igual límite honesto que Chat V1) -- este
    // refresh explícito garantiza que el mensaje recién enviado aparezca
    // de inmediato aunque el canal tarde o no esté disponible.
    await loadInitial();
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  const lastPeerMessageAt = [...messages].reverse().find((m) => m.senderId === params.peerId)?.createdAt ?? null;
  const statusLabel = derivePeerStatusLabel(params.peerId, presence, lastPeerMessageAt);

  async function handleConfirmBlock() {
    setConfirmingBlock(false);
    const result = await blockUser(params.peerUsername);
    if (result.ok) {
      setBlocked(true);
      setSendError(null);
    } else {
      setSendError('No pudimos bloquear a este usuario. Intenta de nuevo.');
    }
  }

  function renderMessage({ item }: { item: PrivateMessage }) {
    const isMine = item.senderId === myUserId;
    return (
      <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={styles.messageText}>{item.body}</Text>
          <Text style={styles.timestamp}>{relativeTime(item.createdAt)}</Text>
        </View>
      </View>
    );
  }

  return (
    <ScreenContainer style={styles.screen} onBack={goBack}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerName}>
            {params.peerAvatarEmoji} {params.peerUsername}
          </Text>
          <Text style={styles.headerStatus}>{statusLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('PublicProfile', { username: params.peerUsername })} hitSlop={6}>
            <Text style={styles.headerActionText}>Ver perfil</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('PublicProfile', { username: params.peerUsername })} hitSlop={6}>
            <Text style={styles.headerActionText}>⚔️ Desafiar</Text>
          </Pressable>
          {!blocked && (
            <Pressable onPress={() => setConfirmingBlock(true)} hitSlop={6}>
              <Text style={styles.headerActionTextDanger}>🚫 Bloquear</Text>
            </Pressable>
          )}
        </View>
      </View>

      {confirmingBlock && (
        <View style={styles.confirmBlockRow}>
          <Text style={styles.confirmBlockText}>¿Bloquear a {params.peerUsername}? No podrán enviarse privados.</Text>
          <View style={styles.confirmBlockActions}>
            <Pressable onPress={handleConfirmBlock} hitSlop={6}>
              <Text style={styles.headerActionTextDanger}>Bloquear</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmingBlock(false)} hitSlop={6}>
              <Text style={styles.headerActionText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      )}

      {blocked && (
        <View style={styles.confirmBlockRow}>
          <Text style={styles.confirmBlockText}>Bloqueaste a {params.peerUsername}.</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.centerState}>
          <Text style={styles.muted}>No pudimos cargar la conversación. Desliza para reintentar.</Text>
          <Pressable onPress={() => void loadInitial()}>
            <Text style={styles.retry}>REINTENTAR</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flexFill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={80}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListHeaderComponent={
              hasMore ? (
                <Pressable onPress={loadMore} style={styles.loadMore} disabled={loadingMore}>
                  <Text style={styles.loadMoreText}>{loadingMore ? 'Cargando...' : 'Cargar mensajes anteriores'}</Text>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Text style={styles.muted}>Todavía no hay mensajes. ¡Rompe el hielo! 👀</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />

          {sendError && <Text style={styles.sendError}>{sendError}</Text>}
          {!blocked && (
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Escribe algo..."
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                maxLength={PRIVATE_MESSAGE_MAX_LENGTH}
                multiline
                onSubmitEditing={handleSend}
              />
              <Pressable
                onPress={handleSend}
                disabled={sending || !draft.trim()}
                style={[styles.sendButton, (sending || !draft.trim()) && styles.sendButtonDisabled]}
              >
                <Text style={styles.sendButtonText}>{sending ? '...' : '➤'}</Text>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 0,
  },
  flexFill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerName: {
    ...typography.title,
    color: colors.textPrimary,
  },
  headerStatus: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerActionText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
  },
  headerActionTextDanger: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '800',
  },
  confirmBlockRow: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  confirmBlockText: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  confirmBlockActions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  muted: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retry: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  loadMoreText: {
    ...typography.caption,
    color: colors.accent,
  },
  messageRow: {
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  messageRowMine: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceAlt,
  },
  bubbleMine: {
    backgroundColor: colors.accent,
  },
  messageText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  sendError: {
    ...typography.caption,
    color: colors.danger,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceAlt,
  },
  sendButtonText: {
    ...typography.subtitle,
    color: colors.onAccent,
  },
});
