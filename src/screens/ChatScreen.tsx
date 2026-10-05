import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { ChatMembersPanel } from '../components/ChatMembersPanel';
import { LiveLobbyCard } from '../components/LiveLobbyCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { getSession } from '../services/authService';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  CHAT_REACTION_EMOJIS,
  CHAT_STATUS_OPTIONS,
  ChatMessage,
  ChatReactionEmoji,
  ChatReactionSummary,
  ChatSenderProfile,
  ChatStatusKey,
  fetchReactionSummaries,
  fetchRecentMessages,
  fetchSenderProfiles,
  fireChatFirstScanCompletedIfPending,
  getGuestRewardStatus,
  getGuestId,
  markChatSignupIntent,
  sendChatMessage,
  setChatStatus,
  subscribeToNewMessages,
  subscribeToReactionChanges,
  toggleChatReaction,
} from '../services/chatService';
import { ChatPresenceState, joinChatPresence } from '../services/chatPresenceService';
import { ChatMember, fetchChatMembers, fetchTotalUnreadPrivateCount, requestPrivateChat } from '../services/chatPrivateService';
import { followUser } from '../services/followService';
import { fetchMyReferralInfo } from '../services/referralService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { shareText } from '../utils/share';

/** Punto 10 del pedido (mobile-first): a partir de este ancho, Integrantes
 * puede mostrarse como columna lateral permanente en vez de bottom-sheet
 * -- mismo umbral de "ancho real de tablet/desktop" ya usado en
 * AdminDashboardScreen (useWindowDimensions). */
const WIDE_LAYOUT_BREAKPOINT = 800;

interface Viewer {
  authed: boolean;
  userId: string | null;
  guestId: string | null;
}

type PromptReason = 'follow' | 'scan' | 'invite' | 'reward' | 'privateMessage';

const PROMPT_COPY: Record<PromptReason, { title: string; body: string }> = {
  follow: { title: 'Crea tu cuenta para seguir', body: 'Seguir a otros usuarios es parte de tu perfil AURA VS -- se guarda cuando te registras.' },
  scan: { title: 'Crea tu cuenta para medir tu Aura', body: 'Tu Scan y tu resultado quedan guardados en tu cuenta, listos para compartir y desafiar.' },
  invite: { title: 'Crea tu cuenta para invitar amigos', body: 'Tu link de invitación es parte de tu perfil -- necesitas una cuenta para generarlo.' },
  reward: { title: 'Tienes Coins esperando', body: 'Crea tu cuenta para guardarlos en tu Wallet.' },
  // Chat V2 "Sala Social" (punto 4 del pedido): "Un invitado que toque
  // 'Mensaje privado' debe recibir CTA de registro/login" -- nunca una
  // solicitud real sale de una cuenta de invitado.
  privateMessage: {
    title: 'Crea tu cuenta para chatear en privado',
    body: 'Los mensajes privados son solo entre cuentas registradas -- crea la tuya para pedirle a alguien chatear 1:1.',
  },
};

/** Error legible para el toast de abajo tras pedir un chat privado --
 * mismo criterio que sendError en el composer: nunca un código crudo. */
const PRIVATE_REQUEST_ERROR_COPY: Record<string, string> = {
  cannot_request_self: 'No puedes pedirte chat privado a ti mismo.',
  blocked: 'No puedes contactar a esta persona.',
  rate_limited: 'Mandaste muchas solicitudes seguidas -- espera un momento.',
  pending_incoming_exists: 'Esa persona ya te pidió chatear -- respóndele desde Privados.',
  already_requested: 'Ya le mandaste una solicitud a esta persona.',
  cooldown: 'Esta persona rechazó tu solicitud hace poco -- intenta de nuevo más tarde.',
  target_not_found: 'No encontramos a ese usuario.',
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function guestLabel(guestId: string): string {
  return `Invitado #${guestId.slice(-4).toUpperCase()}`;
}

/**
 * Chat V1 -- sala global única. Cubre AMBOS accesos (invitado sin sesión
 * vía el root stack, autenticado vía el tab de MainTabs, ver
 * RootNavigator/MainTabNavigator) resolviendo acá adentro si hay sesión o
 * no, en vez de duplicar la pantalla.
 */
export default function ChatScreen() {
  const navigation = useRootNavigation();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= WIDE_LAYOUT_BREAKPOINT;
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [myProfile, setMyProfile] = useState<ChatSenderProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ChatSenderProfile>>({});
  const [reactions, setReactions] = useState<Record<string, ChatReactionSummary[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [promptReason, setPromptReason] = useState<PromptReason | null>(null);
  const [pendingCoins, setPendingCoins] = useState<number | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);

  // Chat V2 "Sala Social" -- Integrantes (punto 2/3/9 del pedido).
  const [membersOpen, setMembersOpen] = useState(false);
  const [chatMembers, setChatMembers] = useState<ChatMember[]>([]);
  const [presence, setPresence] = useState<ChatPresenceState>({ subscribed: false, onlineCount: 0, onlineUserIds: new Set() });
  const [unreadPrivateCount, setUnreadPrivateCount] = useState(0);
  const [memberActionMessage, setMemberActionMessage] = useState<string | null>(null);

  // Identidad del viewer -- sesión real si existe, si no el visitor_id ya
  // existente (ver getGuestId -- nunca un segundo identificador ni un
  // auth.users nuevo por invitado).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (session) {
        const map = await fetchSenderProfiles([session.user.id]);
        if (cancelled) return;
        setMyProfile(map[session.user.id] ?? null);
        setViewer({ authed: true, userId: session.user.id, guestId: null });
      } else {
        const guestId = await getGuestId();
        if (cancelled) return;
        setViewer({ authed: false, userId: null, guestId });
        logEvent('chat_guest_created');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    logEvent('chat_viewed');
    // Atribución chat -> primer Scan (ver chatService.ts): chequea cada
    // vez que se vuelve a esta pantalla, no solo al loguearse, porque el
    // Scan real pasa DESPUÉS, en otra pantalla.
    if (viewer?.authed) void fireChatFirstScanCompletedIfPending();
  }, [isFocused, viewer?.authed]);

  // Presencia real (punto 9) -- un único canal Realtime Presence para
  // toda la sala, cubre tanto autenticados como invitados (cada quien se
  // identifica con su propio user_id o guest_id). `presence.subscribed`
  // en false es la señal honesta de "no se pudo confirmar" -- ver
  // chatPresenceService.ts y el fallback de `activityLabel` más abajo.
  useEffect(() => {
    if (!viewer) return;
    return joinChatPresence({ userId: viewer.userId, guestId: viewer.guestId }, setPresence);
  }, [viewer]);

  // Badge de no-leídos de Privados -- solo autenticado (un invitado nunca
  // tiene conversaciones privadas, ver request_private_chat server-side).
  // Se refresca cada vez que la pantalla gana foco, igual criterio que
  // fetchUnreadNotificationCount en BottomNavBar.
  useEffect(() => {
    if (!isFocused || !viewer?.authed) return;
    fetchTotalUnreadPrivateCount().then(setUnreadPrivateCount);
  }, [isFocused, viewer?.authed]);

  // Fallback honesto de "activos recientemente" (punto 1/9 del pedido):
  // SOLO se usa cuando Presence no confirmó su propia suscripción --
  // nunca se mezcla con un conteo real de Presence ni se presenta como
  // "conectados". Se calcula de los mensajes YA cargados (sin query
  // extra): remitentes autenticados distintos con un mensaje en los
  // últimos 10 minutos.
  const recentActiveUserIds = useCallback(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    const ids = new Set<string>();
    for (const m of messages) {
      if (m.userId && new Date(m.createdAt).getTime() > cutoff) ids.add(m.userId);
    }
    return ids;
  }, [messages]);

  const effectiveMemberIds = presence.subscribed ? presence.onlineUserIds : recentActiveUserIds();
  const activityLabel = presence.subscribed
    ? `● ${presence.onlineCount} conectado${presence.onlineCount === 1 ? '' : 's'}`
    : `~ ${effectiveMemberIds.size} activo${effectiveMemberIds.size === 1 ? '' : 's'} recientemente`;

  useEffect(() => {
    if (!membersOpen) return;
    fetchChatMembers([...effectiveMemberIds]).then(setChatMembers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersOpen, presence.subscribed, presence.onlineUserIds.size, messages.length]);

  function openMembersPanel() {
    setMembersOpen(true);
    logEvent('chat_members_opened');
  }

  function openPrivadosInbox() {
    if (!viewer?.authed) {
      openSignupPrompt('privateMessage');
      return;
    }
    navigation.navigate('ChatPrivateInbox');
  }

  function handleMemberViewProfile(username: string) {
    logEvent('chat_member_profile_opened');
    if (!viewer?.authed) {
      openSignupPrompt('follow');
      return;
    }
    setMembersOpen(false);
    navigation.navigate('PublicProfile', { username });
  }

  async function handleMemberFollow(username: string) {
    await followUser(username);
  }

  function handleMemberChallenge(username: string) {
    // Reusa la pantalla de perfil público, que ya tiene el flujo real de
    // Desafiar (elegir el propio Scan válido, confirmar, crear el
    // Challenge directo vía create_direct_challenge) -- nunca se duplica
    // esa lógica acá (punto 3 del pedido: "Reutilizar los servicios
    // existentes... No duplicar lógica existente").
    setMembersOpen(false);
    navigation.navigate('PublicProfile', { username });
  }

  async function handleMemberPrivateMessage(member: ChatMember) {
    if (!viewer?.authed) {
      openSignupPrompt('privateMessage');
      return;
    }
    const result = await requestPrivateChat(member.username);
    if (result.ok) {
      setMemberActionMessage(`Solicitud enviada a ${member.username} -- te avisamos si la acepta.`);
    } else {
      setMemberActionMessage(PRIVATE_REQUEST_ERROR_COPY[result.errorCode ?? ''] ?? 'No pudimos enviar la solicitud.');
    }
    setTimeout(() => setMemberActionMessage(null), 4000);
  }

  const hydrateExtras = useCallback(
    async (list: ChatMessage[]) => {
      const userIds = list.map((m) => m.userId).filter((v): v is string => Boolean(v));
      const [profileMap, reactionMap] = await Promise.all([
        fetchSenderProfiles(userIds),
        fetchReactionSummaries(
          list.map((m) => m.id),
          { userId: viewer?.userId ?? null, guestId: viewer?.guestId ?? null },
        ),
      ]);
      setProfiles((prev) => ({ ...prev, ...profileMap }));
      setReactions((prev) => ({ ...prev, ...reactionMap }));
    },
    [viewer],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { messages: recent, error } = await fetchRecentMessages();
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    const ordered = [...recent].reverse();
    setMessages(ordered);
    setHasMore(recent.length === CHAT_PAGE_SIZE);
    await hydrateExtras(ordered);
    setLoading(false);
  }, [hydrateExtras]);

  useEffect(() => {
    if (viewer) void loadInitial();
    // Solo cuando `viewer` queda resuelto (sesión o guest_id listo) --
    // hydrateExtras necesita saber quién soy para marcar reactedByMe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(viewer)]);

  // Espejo de `messages` en un ref -- para que el listener de reacciones
  // (abajo) siempre lea la lista actual sin tener que reinscribirse cada
  // vez que `messages` cambia (eso reabriría el canal de Realtime en cada
  // mensaje nuevo, justo lo que la sección de performance pide evitar).
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Realtime: nuevos mensajes + cambios de reacciones -- puramente
  // aditivo (ver chatService, si la tabla no está en la publicación esto
  // simplemente nunca dispara, nada se rompe). Un solo listener de cada
  // tipo durante toda la vida de la pantalla, limpiado al desmontar.
  useEffect(() => {
    const unsubMessages = subscribeToNewMessages(
      (msg) => {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (msg.userId) void hydrateExtras([msg]);
      },
      (hiddenId) => {
        setMessages((prev) => prev.filter((m) => m.id !== hiddenId));
      },
    );
    const unsubReactions = subscribeToReactionChanges(() => {
      void fetchReactionSummaries(
        messagesRef.current.map((m) => m.id),
        { userId: viewer?.userId ?? null, guestId: viewer?.guestId ?? null },
      ).then((map) => setReactions((old) => ({ ...old, ...map })));
    });
    return () => {
      unsubMessages();
      unsubReactions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  async function loadMore() {
    if (loadingMore || !hasMore || !messages.length) return;
    setLoadingMore(true);
    const { messages: older, error } = await fetchRecentMessages(messages[0].createdAt);
    setLoadingMore(false);
    if (error) return; // best-effort -- el usuario puede reintentar tocando "cargar más" de nuevo.
    setHasMore(older.length === CHAT_PAGE_SIZE);
    const ordered = [...older].reverse();
    setMessages((prev) => [...ordered, ...prev]);
    await hydrateExtras(ordered);
  }

  /** Llamar después de un mensaje/reacción real del invitado -- la fila
   * de recompensa la crea el SERVIDOR como efecto de esa acción ya
   * validada (ver send_chat_message/toggle_chat_reaction), esto solo
   * refresca el banner leyendo el estado resultante. */
  async function refreshGuestReward() {
    if (!viewer || viewer.authed) return;
    const reward = await getGuestRewardStatus(viewer.guestId!);
    if (reward && !reward.claimed) setPendingCoins(reward.amount);
  }

  async function handleSend() {
    if (!viewer || sending) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    const result = await sendChatMessage(body, viewer.guestId);
    setSending(false);
    if (!result.ok) {
      setSendError(
        result.errorCode === 'rate_limited'
          ? 'Vas muy rápido -- espera unos segundos.'
          : 'No pudimos enviar tu mensaje. Intenta de nuevo.',
      );
      return;
    }
    setDraft('');
    await refreshGuestReward();
    // Realtime es best-effort: si la tabla todavía no está en la publicación
    // o el evento tarda, refrescamos explícitamente para que el mensaje recién
    // enviado aparezca de inmediato también en Preview/producción.
    await loadInitial();
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  async function handleReact(messageId: string, emoji: ChatReactionEmoji) {
    if (!viewer) return;
    await toggleChatReaction(messageId, emoji, viewer.guestId);
    await refreshGuestReward();
    const map = await fetchReactionSummaries([messageId], { userId: viewer.userId, guestId: viewer.guestId });
    setReactions((prev) => ({ ...prev, ...map }));
  }

  function openSignupPrompt(reason: PromptReason) {
    setPromptReason(reason);
    logEvent('chat_signup_prompted', { reason });
  }

  function handleSignupFromPrompt() {
    logEvent('chat_signup_started', { reason: promptReason });
    setPromptReason(null);
    void markChatSignupIntent();
    navigation.navigate('Auth', { initialMode: 'signUp', context: 'measure_aura' });
  }

  function handleOpenProfile(userId: string, username: string) {
    logEvent('chat_profile_opened');
    if (!viewer?.authed) {
      openSignupPrompt('follow');
      return;
    }
    navigation.navigate('PublicProfile', { username });
  }

  async function handleFollowClick(username: string) {
    logEvent('chat_follow_clicked');
    if (!viewer?.authed) {
      openSignupPrompt('follow');
      return;
    }
    await followUser(username);
  }

  function handleScanCta() {
    logEvent('chat_scan_cta_clicked');
    if (!viewer?.authed) {
      openSignupPrompt('scan');
      return;
    }
    navigation.navigate('Upload');
  }

  async function handleInviteCta() {
    logEvent('chat_invite_clicked');
    if (!viewer?.authed) {
      openSignupPrompt('invite');
      return;
    }
    const info = await fetchMyReferralInfo();
    if (info) await shareText('Mide tu Aura conmigo en AURA VS 👀', info.shareUrl);
  }

  async function handleSetStatus(status: ChatStatusKey | null) {
    setStatusPickerOpen(false);
    if (!viewer?.authed) return;
    const ok = await setChatStatus(status);
    if (ok) setMyProfile((prev) => (prev ? { ...prev, chatStatus: status } : prev));
  }

  const statusLabel = (key: ChatStatusKey | null | undefined) =>
    CHAT_STATUS_OPTIONS.find((o) => o.key === key)?.label ?? null;

  function renderMessage({ item }: { item: ChatMessage }) {
    const isMine = (viewer?.userId && item.userId === viewer.userId) || (viewer?.guestId && item.guestId === viewer.guestId);
    const sender = item.userId ? profiles[item.userId] : null;
    const name = item.userId ? sender?.username ?? '...' : guestLabel(item.guestId ?? '');
    const avatar = item.userId ? sender?.avatarEmoji ?? '🙂' : '👤';
    const status = item.userId ? statusLabel(sender?.chatStatus) : null;
    const messageReactions = reactions[item.id] ?? [];
    const showFollow = Boolean(item.userId) && !isMine && name !== '...';

    return (
      <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
        <Pressable
          onPress={() => item.userId && name !== '...' && handleOpenProfile(item.userId, name)}
          hitSlop={6}
          style={styles.avatarWrap}
        >
          <Text style={styles.avatar}>{avatar}</Text>
        </Pressable>
        <View style={styles.messageBody}>
          <View style={styles.messageHeader}>
            <Text style={styles.senderName}>{name}</Text>
            {status && <Text style={styles.statusTag}>{status}</Text>}
            {showFollow && (
              <Pressable onPress={() => handleFollowClick(name)} hitSlop={6}>
                <Text style={styles.followTag}>+ Seguir</Text>
              </Pressable>
            )}
            <Text style={styles.timestamp}>{relativeTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.messageText}>{item.body}</Text>
          <View style={styles.reactionRow}>
            {CHAT_REACTION_EMOJIS.map((emoji) => {
              const summary = messageReactions.find((r) => r.emoji === emoji);
              return (
                <Pressable
                  key={emoji}
                  onPress={() => handleReact(item.id, emoji)}
                  style={[styles.reactionChip, summary?.reactedByMe && styles.reactionChipActive]}
                  hitSlop={4}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                  {!!summary?.count && <Text style={styles.reactionCount}>{summary.count}</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  const membersPanel = (
    <ChatMembersPanel
      members={chatMembers}
      onlineUserIds={presence.onlineUserIds}
      viewerUserId={viewer?.userId ?? null}
      viewerAuthed={Boolean(viewer?.authed)}
      activityLabel={activityLabel}
      onClose={isWideLayout ? undefined : () => setMembersOpen(false)}
      onViewProfile={handleMemberViewProfile}
      onFollow={handleMemberFollow}
      onChallenge={handleMemberChallenge}
      onPrivateMessage={handleMemberPrivateMessage}
    />
  );

  return (
    <View style={[styles.rootRow, isWideLayout && styles.rootRowWide]}>
      <ScreenContainer style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <Text style={styles.logo}>🔥 SALA GLOBAL · AURA VS</Text>
          <Text style={styles.activityLine}>{activityLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={openMembersPanel} hitSlop={6}>
            <Text style={styles.headerActionText}>👥 Integrantes</Text>
          </Pressable>
          <Pressable onPress={openPrivadosInbox} hitSlop={6}>
            <Text style={styles.headerActionText}>
              💬 Privados{unreadPrivateCount > 0 ? ` (${unreadPrivateCount})` : ''}
            </Text>
          </Pressable>
          {viewer?.authed && (
            <Pressable onPress={() => setStatusPickerOpen(true)} style={styles.statusButton} hitSlop={8}>
              <Text style={styles.statusButtonText}>{statusLabel(myProfile?.chatStatus) ?? 'Mi status'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {memberActionMessage && (
        <View style={styles.actionToast}>
          <Text style={styles.actionToastText}>{memberActionMessage}</Text>
        </View>
      )}

      {/* AURA LIVE -- "EN VIVO AHORA" (sección 15 del pedido): el Chat es
          el lobby, LIVE es el espectáculo. Componente propio, puramente
          aditivo -- ver LiveLobbyCard.tsx, nunca datos falsos si no hay
          ningún LIVE activo. */}
      <LiveLobbyCard />

      {!viewer?.authed && (
        <View style={styles.guestBanner}>
          <Text style={styles.guestBannerText}>
            {pendingCoins
              ? `Ya tienes ${pendingCoins} Coins pendientes ⚡ Crea tu cuenta para guardarlos.`
              : 'Estás chateando como invitado.'}
          </Text>
          <Pressable onPress={() => openSignupPrompt('reward')} hitSlop={6}>
            <Text style={styles.guestBannerCta}>Crear cuenta</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.centerState}>
          <Text style={styles.muted}>No pudimos cargar el chat. Desliza para reintentar.</Text>
          <PrimaryButton label="REINTENTAR" variant="ghost" onPress={() => void loadInitial()} />
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
                <Text style={styles.muted}>Todavía no hay mensajes. ¡Sé el primero! 👀</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />

          <View style={styles.ctaRow}>
            <Pressable style={styles.ctaChip} onPress={handleScanCta}>
              <Text style={styles.ctaChipText}>🎯 Haz tu primer Scan</Text>
            </Pressable>
            <Pressable style={styles.ctaChip} onPress={handleInviteCta}>
              <Text style={styles.ctaChipText}>➕ Invitar</Text>
            </Pressable>
          </View>

          {sendError && <Text style={styles.sendError}>{sendError}</Text>}
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribe algo..."
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
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
        </KeyboardAvoidingView>
      )}

      <Modal visible={!!promptReason} transparent animationType="fade" onRequestClose={() => setPromptReason(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {promptReason && (
              <>
                <Text style={styles.modalTitle}>{PROMPT_COPY[promptReason].title}</Text>
                <Text style={styles.modalBody}>{PROMPT_COPY[promptReason].body}</Text>
              </>
            )}
            <PrimaryButton label="CREAR CUENTA" onPress={handleSignupFromPrompt} />
            <PrimaryButton label="Ahora no" variant="text" onPress={() => setPromptReason(null)} />
          </View>
        </View>
      </Modal>

      <Modal visible={statusPickerOpen} transparent animationType="fade" onRequestClose={() => setStatusPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tu status en el Chat</Text>
            {CHAT_STATUS_OPTIONS.map((option) => (
              <Pressable key={option.key} style={styles.statusOption} onPress={() => handleSetStatus(option.key)}>
                <Text style={styles.statusOptionText}>{option.label}</Text>
              </Pressable>
            ))}
            <PrimaryButton label="Quitar status" variant="text" onPress={() => handleSetStatus(null)} />
          </View>
        </View>
      </Modal>
      </ScreenContainer>

      {/* Punto 10 del pedido (mobile-first): en ancho de tablet/desktop,
          Integrantes es una columna lateral permanente (sibling fijo,
          nunca divide la sala global en mobile); en mobile es un
          bottom-sheet que se abre/cierra encima, la sala global sigue
          ocupando prácticamente todo el ancho (punto 10). */}
      {isWideLayout ? (
        <View style={styles.sidebar}>{membersPanel}</View>
      ) : (
        <Modal visible={membersOpen} transparent animationType="slide" onRequestClose={() => setMembersOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <View style={styles.sheetCard}>{membersPanel}</View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Punto 10 del pedido (mobile-first): en mobile es solo una columna
  // (rootRowWide nunca se aplica), la sala global sigue usando
  // prácticamente todo el ancho -- Integrantes vive en un Modal encima,
  // no divide la pantalla. En desktop/tablet ancho, `rootRowWide` vuelve
  // esto una fila de 2 columnas (sala + sidebar fijo de Integrantes).
  rootRow: {
    flex: 1,
  },
  rootRowWide: {
    flexDirection: 'row',
  },
  sidebar: {
    width: 320,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetCard: {
    height: '75%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  screen: {
    paddingHorizontal: 0,
  },
  flexFill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerIdentity: {
    width: '100%',
    flexShrink: 0,
  },
  logo: {
    ...typography.title,
    color: colors.textPrimary,
    fontSize: 16,
  },
  activityLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  headerActionText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
  },
  actionToast: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionToastText: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  statusButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  statusButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  guestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  guestBannerText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    marginRight: spacing.sm,
  },
  guestBannerCta: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
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
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  messageRowMine: {
    opacity: 1,
  },
  avatarWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    fontSize: 16,
  },
  messageBody: {
    flex: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  senderName: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  statusTag: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  followTag: {
    ...typography.caption,
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  timestamp: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    marginLeft: 'auto',
  },
  messageText: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: 2,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  reactionChipActive: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  ctaChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  ctaChipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  modalBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  statusOption: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusOptionText: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
