import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
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
import { RootStackParamList } from '../types';
import { colors, radius, spacing, typography } from '../theme/colors';

type ConversationRoute = RouteProp<RootStackParamList, 'ChatPrivateConversation'>;

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function emitPrivateSound(): void {
  if (Platform.OS !== 'web') return;
  const scope = globalThis as any;
  try {
    scope.dispatchEvent?.(new scope.CustomEvent('aura-chat-sound', { detail: { kind: 'private' } }));
  } catch {
    // El sonido es accesorio: nunca debe romper el chat.
  }
}

/**
 * Implementación web-first y conservadora del privado 1:1.
 * Evita VirtualizedList/FlatList y un segundo canal Presence mientras la
 * conversación está abierta: en Safari iOS la combinación anterior podía
 * derribar el árbol de React justo después de cargar una conversación vacía.
 * El backend, consentimiento, RLS, Realtime de mensajes, bloqueo y paginación
 * permanecen iguales; solo se simplifica la capa de render para estabilidad.
 */
export default function ChatPrivateConversationSafeScreen() {
  const route = useRoute<ConversationRoute>();
  const params = route.params;
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const scrollRef = useRef<ScrollView>(null);

  const conversationId = params?.conversationId ?? '';
  const peerId = params?.peerId ?? '';
  const peerUsername = params?.peerUsername ?? 'Usuario';
  const peerAvatarEmoji = params?.peerAvatarEmoji ?? '🙂';

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let active = true;
    void getSession().then((session) => {
      if (active) setMyUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const loadInitial = useCallback(async () => {
    if (!conversationId) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const { messages: recent, error } = await fetchPrivateMessages(conversationId);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setMessages([...recent].reverse());
    setHasMore(recent.length === PRIVATE_MESSAGE_PAGE_SIZE);
    setLoading(false);
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationId) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      void logEvent('chat_private_conversation_opened', { conversation_id: conversationId });
      void loadInitial();
      void markPrivateConversationRead(conversationId);
    }, [conversationId, loadInitial]),
  );

  useEffect(() => {
    if (!conversationId) return;
    return subscribeToPrivateMessages(conversationId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (myUserId && msg.senderId !== myUserId) emitPrivateSound();
      void markPrivateConversationRead(conversationId);
    });
  }, [conversationId, myUserId]);

  async function loadMore() {
    if (!conversationId || loadingMore || !hasMore || !messages.length) return;
    setLoadingMore(true);
    const { messages: older, error } = await fetchPrivateMessages(conversationId, messages[0].createdAt);
    setLoadingMore(false);
    if (error) return;
    setHasMore(older.length === PRIVATE_MESSAGE_PAGE_SIZE);
    setMessages((prev) => [...[...older].reverse(), ...prev]);
  }

  async function handleSend() {
    const body = draft.trim();
    if (!conversationId || !body || sending) return;
    setSending(true);
    setSendError(null);
    const result = await sendPrivateMessage(conversationId, body);
    setSending(false);
    if (!result.ok) {
      setSendError(
        result.errorCode === 'rate_limited'
          ? 'Vas muy rápido — espera unos segundos.'
          : result.errorCode === 'blocked'
            ? 'No puedes enviar mensajes en esta conversación.'
            : 'No pudimos enviar tu mensaje. Intenta de nuevo.',
      );
      return;
    }
    emitPrivateSound();
    setDraft('');
    void logEvent('chat_private_message_sent', { conversation_id: conversationId });
    await loadInitial();
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 0);
  }

  async function handleConfirmBlock() {
    setConfirmingBlock(false);
    const result = await blockUser(peerUsername);
    if (result.ok) {
      setBlocked(true);
      setSendError(null);
      void logEvent('chat_user_blocked');
    } else {
      setSendError('No pudimos bloquear a este usuario. Intenta de nuevo.');
    }
  }

  if (!conversationId || !peerId) {
    return (
      <ScreenContainer onBack={goBack}>
        <View style={styles.centerState}>
          <Text style={styles.muted}>No pudimos abrir esta conversación.</Text>
          <Pressable onPress={() => navigation.navigate('ChatPrivateInbox')}>
            <Text style={styles.retry}>VOLVER A PRIVADOS</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.screen} onBack={goBack}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <Text style={styles.headerName}>{peerAvatarEmoji} {peerUsername}</Text>
          <Text style={styles.headerStatus}>Conversación privada</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('PublicProfile', { username: peerUsername })} hitSlop={6}>
            <Text style={styles.headerActionText}>Perfil</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('PublicProfile', { username: peerUsername })} hitSlop={6}>
            <Text style={styles.headerActionText}>⚔️ Desafiar</Text>
          </Pressable>
          {!blocked && (
            <Pressable onPress={() => setConfirmingBlock(true)} hitSlop={6}>
              <Text style={styles.headerActionTextDanger}>🚫</Text>
            </Pressable>
          )}
        </View>
      </View>

      {confirmingBlock && (
        <View style={styles.confirmBlockRow}>
          <Text style={styles.confirmBlockText}>¿Bloquear a {peerUsername}? No podrán enviarse privados.</Text>
          <View style={styles.confirmBlockActions}>
            <Pressable onPress={() => void handleConfirmBlock()} hitSlop={6}>
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
          <Text style={styles.confirmBlockText}>Bloqueaste a {peerUsername}.</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.centerState}>
          <Text style={styles.muted}>No pudimos cargar la conversación.</Text>
          <Pressable onPress={() => void loadInitial()}>
            <Text style={styles.retry}>REINTENTAR</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.messagesScroll}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: false })}
          >
            {hasMore && messages.length > 0 && (
              <Pressable onPress={() => void loadMore()} style={styles.loadMore} disabled={loadingMore}>
                <Text style={styles.loadMoreText}>{loadingMore ? 'Cargando...' : 'Cargar mensajes anteriores'}</Text>
              </Pressable>
            )}

            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.muted}>Todavía no hay mensajes. ¡Rompe el hielo! 👀</Text>
              </View>
            ) : (
              messages.map((item) => {
                const isMine = item.senderId === myUserId;
                return (
                  <View key={item.id} style={[styles.messageRow, isMine && styles.messageRowMine]}>
                    <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text style={[styles.messageText, isMine && styles.messageTextMine]}>{item.body}</Text>
                      <Text style={[styles.timestamp, isMine && styles.timestampMine]}>{relativeTime(item.createdAt)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

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
              />
              <Pressable
                onPress={() => void handleSend()}
                disabled={sending || !draft.trim()}
                style={[styles.sendButton, (sending || !draft.trim()) && styles.sendButtonDisabled]}
              >
                <Text style={styles.sendButtonText}>{sending ? '...' : '➤'}</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerName: { ...typography.title, color: colors.textPrimary },
  headerStatus: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' },
  headerActionText: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  headerActionTextDanger: { ...typography.caption, color: colors.danger, fontWeight: '800' },
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
  confirmBlockText: { ...typography.caption, color: colors.textPrimary },
  confirmBlockActions: { flexDirection: 'row', gap: spacing.lg },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  retry: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  messagesScroll: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  emptyState: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  loadMore: { alignItems: 'center', paddingVertical: spacing.sm },
  loadMoreText: { ...typography.caption, color: colors.accent },
  messageRow: { marginBottom: spacing.sm, alignItems: 'flex-start' },
  messageRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleTheirs: { backgroundColor: colors.surfaceAlt },
  bubbleMine: { backgroundColor: colors.accent },
  messageText: { ...typography.body, color: colors.textPrimary },
  messageTextMine: { color: colors.onAccent },
  timestamp: { ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  timestampMine: { color: colors.onAccent },
  sendError: { ...typography.caption, color: colors.danger, paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
  sendButtonDisabled: { backgroundColor: colors.surfaceAlt },
  sendButtonText: { ...typography.subtitle, color: colors.onAccent },
});