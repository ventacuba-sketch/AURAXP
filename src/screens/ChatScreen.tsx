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
import {
  ChatMember,
  IncomingPrivateRequest,
  fetchChatMembers,
  fetchIncomingPrivateRequests,
  fetchTotalUnreadPrivateCount,
  requestPrivateChat,
  respondToPrivateChatRequest,
} from '../services/chatPrivateService';
import { fetchOutgoingPendingPrivateUsernames, subscribeToPrivateRequestChanges } from '../services/chatPrivateUxService';
import { fetchFollowStats, followUser, unfollowUser } from '../services/followService';
import { fetchMyReferralInfo } from '../services/referralService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { shareText } from '../utils/share';

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
  privateMessage: {
    title: 'Crea tu cuenta para chatear en privado',
    body: 'Los mensajes privados son solo entre cuentas registradas -- crea la tuya para pedirle a alguien chatear 1:1.',
  },
};

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
  const [followingByUsername, setFollowingByUsername] = useState<Record<string, boolean>>({});
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
  const [membersOpen, setMembersOpen] = useState(false);
  const [chatMembers, setChatMembers] = useState<ChatMember[]>([]);
  const [presence, setPresence] = useState<ChatPresenceState>({ subscribed: false, onlineCount: 0, onlineUserIds: new Set() });
  const [unreadPrivateCount, setUnreadPrivateCount] = useState(0);
  const [incomingPrivateRequests, setIncomingPrivateRequests] = useState<IncomingPrivateRequest[]>([]);
  const [pendingPrivateUsernames, setPendingPrivateUsernames] = useState<Set<string>>(new Set());
  const [privateRequestSentTo, setPrivateRequestSentTo] = useState<string | null>(null);
  const [respondingPrivateRequest, setRespondingPrivateRequest] = useState(false);
  const [memberActionMessage, setMemberActionMessage] = useState<string | null>(null);

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
    if (viewer?.authed) void fireChatFirstScanCompletedIfPending();
  }, [isFocused, viewer?.authed]);

  useEffect(() => {
    if (!viewer) return;
    return joinChatPresence({ userId: viewer.userId, guestId: viewer.guestId }, setPresence);
  }, [viewer]);

  const refreshPrivateState = useCallback(async () => {
    if (!viewer?.authed || !viewer.userId) return;
    const [incoming, outgoing, unread] = await Promise.all([
      fetchIncomingPrivateRequests(viewer.userId),
      fetchOutgoingPendingPrivateUsernames(viewer.userId),
      fetchTotalUnreadPrivateCount(),
    ]);
    setIncomingPrivateRequests(incoming);
    setPendingPrivateUsernames(new Set(outgoing));
    setUnreadPrivateCount(unread);
  }, [viewer?.authed, viewer?.userId]);

  useEffect(() => {
    if (!isFocused || !viewer?.authed) return;
    void refreshPrivateState();
  }, [isFocused, viewer?.authed, refreshPrivateState]);

  useEffect(() => {
    if (!viewer?.authed || !viewer.userId) return;
    const unsubscribe = subscribeToPrivateRequestChanges(viewer.userId, () => {
      void refreshPrivateState();
    });
    return unsubscribe;
  }, [viewer?.authed, viewer?.userId, refreshPrivateState]);

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
  const privateBadgeCount = unreadPrivateCount + incomingPrivateRequests.length;
  const activeIncomingRequest = incomingPrivateRequests[0] ?? null;

  const hydrateFollowing = useCallback(
    async (usernames: string[]) => {
      if (!viewer?.authed) return;
      const unique = [...new Set(usernames.filter((u) => Boolean(u) && u !== myProfile?.username))];
      if (!unique.length) return;
      const pairs = await Promise.all(
        unique.map(async (username) => {
          const stats = await fetchFollowStats(username);
          return [username, stats.isFollowing] as const;
        }),
      );
      setFollowingByUsername((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    },
    [viewer?.authed, myProfile?.username],
  );

  useEffect(() => {
    if (!membersOpen) return;
    let cancelled = false;
    (async () => {
      const members = await fetchChatMembers([...effectiveMemberIds]);
      if (cancelled) return;
      setChatMembers(members);
      void hydrateFollowing(members.map((m) => m.username));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersOpen, presence.subscribed, presence.onlineUserIds.size, messages.length, hydrateFollowing]);

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

  async function handleFollowClick(username: string) {
    logEvent('chat_follow_clicked');
    if (!viewer?.authed) {
      openSignupPrompt('follow');
      return;
    }
    const currentlyFollowing = followingByUsername[username] === true;
    const ok = currentlyFollowing ? await unfollowUser(username) : await followUser(username);
    if (ok) setFollowingByUsername((prev) => ({ ...prev, [username]: !currentlyFollowing }));
  }

  function handleMemberChallenge(username: string) {
    setMembersOpen(false);
    navigation.navigate('PublicProfile', { username });
  }

  async function handlePrivateMessage(username: string) {
    if (!viewer?.authed) {
      openSignupPrompt('privateMessage');
      return;
    }
    if (pendingPrivateUsernames.has(username)) return;

    const result = await requestPrivateChat(username);
    if (result.ok) {
      setPendingPrivateUsernames((prev) => new Set([...prev, username]));
      setPrivateRequestSentTo(username);
      setMemberActionMessage(null);
    } else {
      setMemberActionMessage(PRIVATE_REQUEST_ERROR_COPY[result.errorCode ?? ''] ?? 'No pudimos enviar la solicitud privada.');
      setTimeout(() => setMemberActionMessage(null), 4500);
    }
  }

  async function handleMemberPrivateMessage(member: ChatMember) {
    await handlePrivateMessage(member.username);
  }

  async function handleIncomingPrivateResponse(accept: boolean) {
    if (!activeIncomingRequest || respondingPrivateRequest) return;
    setRespondingPrivateRequest(true);
    const request = activeIncomingRequest;
    const result = await respondToPrivateChatRequest(request.id, accept);
    setRespondingPrivateRequest(false);

    if (!result.ok) {
      setMemberActionMessage('No pudimos responder la invitación. Intenta de nuevo.');
      setTimeout(() => setMemberActionMessage(null), 4500);
      await refreshPrivateState();
      return;
    }

    setIncomingPrivateRequests((prev) => prev.filter((item) => item.id !== request.id));
    await refreshPrivateState();

    if (accept && result.conversationId) {
      navigation.navigate('ChatPrivateConversation', {
        conversationId: result.conversationId,
        peerId: request.requesterId,
        peerUsername: request.requesterUsername,
        peerAvatarEmoji: request.requesterAvatarEmoji,
      });
    }
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
      void hydrateFollowing(Object.values(profileMap).map((p) => p.username));
    },
    [viewer, hydrateFollowing],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(viewer)]);

  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    if (error) return;
    setHasMore(older.length === CHAT_PAGE_SIZE);
    const ordered = [...older].reverse();
    setMessages((prev) => [...ordered, ...prev]);
    await hydrateExtras(ordered);
  }

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
      setSendError(result.errorCode === 'rate_limited' ? 'Vas muy rápido -- espera unos segundos.' : 'No pudimos enviar tu mensaje. Intenta de nuevo.');
      return;
    }
    setDraft('');
    await refreshGuestReward();
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

  const statusLabel = (key: ChatStatusKey | null | undefined) => CHAT_STATUS_OPTIONS.find((o) => o.key === key)?.label ?? null;

  function renderMessage({ item }: { item: ChatMessage }) {
    const isMine = (viewer?.userId && item.userId === viewer.userId) || (viewer?.guestId && item.guestId === viewer.guestId);
    const sender = item.userId ? profiles[item.userId] : null;
    const name = item.userId ? sender?.username ?? '...' : guestLabel(item.guestId ?? '');
    const avatar = item.userId ? sender?.avatarEmoji ?? '🙂' : '👤';
    const status = item.userId ? statusLabel(sender?.chatStatus) : null;
    const messageReactions = reactions[item.id] ?? [];
    const showSocialActions = Boolean(item.userId) && !isMine && name !== '...';
    const followStateKnown = Object.prototype.hasOwnProperty.call(followingByUsername, name);
    const isFollowing = followingByUsername[name] === true;
    const privatePending = pendingPrivateUsernames.has(name);

    return (
      <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
        <Pressable onPress={() => item.userId && name !== '...' && handleOpenProfile(item.userId, name)} hitSlop={6} style={styles.avatarWrap}>
          <Text style={styles.avatar}>{avatar}</Text>
        </Pressable>
        <View style={styles.messageBody}>
          <View style={styles.messageHeader}>
            <Text style={styles.senderName}>{name}</Text>
            {status && <Text style={styles.statusTag}>{status}</Text>}
            <Text style={styles.timestamp}>{relativeTime(item.createdAt)}</Text>
          </View>
          {showSocialActions && (
            <View style={styles.messageSocialActions}>
              {followStateKnown && (
                <Pressable onPress={() => handleFollowClick(name)} hitSlop={6}>
                  <Text style={[styles.followTag, isFollowing && styles.followingTag]}>{isFollowing ? '✓ Siguiendo' : '+ Seguir'}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => handlePrivateMessage(name)} hitSlop={6} disabled={privatePending}>
                <Text style={privatePending ? styles.privatePendingTag : styles.privateTag}>
                  {privatePending ? '⏳ Invitación enviada' : '💬 Privado'}
                </Text>
              </Pressable>
            </View>
          )}
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
      followingByUsername={followingByUsername}
      pendingPrivateUsernames={pendingPrivateUsernames}
      onClose={isWideLayout ? undefined : () => setMembersOpen(false)}
      onViewProfile={handleMemberViewProfile}
      onFollow={handleFollowClick}
      onChallenge={handleMemberChallenge}
      onPrivateMessage={handleMemberPrivateMessage}
    />
  );

  return (
    <View style={[styles.rootRow, isWideLayout && styles.rootRowWide]}>
      <ScreenContainer style={styles.screen}>
        <View style={[styles.header, !isWideLayout && styles.headerMobile]}>
          <View style={[styles.headerIdentity, !isWideLayout && styles.headerIdentityMobile]}>
            <Text style={styles.logo} numberOfLines={1}>🔥 SALA GLOBAL · AURA VS</Text>
            <Text style={styles.activityLine}>{activityLabel}</Text>
          </View>
          <View style={[styles.headerActions, !isWideLayout && styles.headerActionsMobile]}>
            <Pressable onPress={openMembersPanel} hitSlop={6}>
              <Text style={styles.headerActionText}>👥 Integrantes</Text>
            </Pressable>
            <Pressable onPress={openPrivadosInbox} hitSlop={6} style={styles.privateHeaderButton}>
              <Text style={styles.headerActionText}>💬 Privados</Text>
              {privateBadgeCount > 0 && (
                <View style={styles.privateAlertBadge}>
                  <Text style={styles.privateAlertBadgeText}>{privateBadgeCount > 99 ? '99+' : privateBadgeCount}</Text>
                </View>
              )}
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

        {!viewer?.authed && (
          <View style={styles.guestBanner}>
            <Text style={styles.guestBannerText}>
              {pendingCoins ? `Ya tienes ${pendingCoins} Coins pendientes ⚡ Crea tu cuenta para guardarlos.` : 'Estás chateando como invitado.'}
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
          <KeyboardAvoidingView style={styles.flexFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
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
              <Pressable onPress={handleSend} disabled={sending || !draft.trim()} style={[styles.sendButton, (sending || !draft.trim()) && styles.sendButtonDisabled]}>
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

        <Modal visible={!!privateRequestSentTo} transparent animationType="fade" onRequestClose={() => setPrivateRequestSentTo(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalIcon}>📨</Text>
              <Text style={styles.modalTitle}>Invitación enviada</Text>
              <Text style={styles.modalBody}>
                Le enviamos una invitación a <Text style={styles.modalStrong}>{privateRequestSentTo}</Text>. Si la acepta, podrán hablar en privado.
              </Text>
              <Text style={styles.pendingExplanation}>⏳ Mientras esperas, verás “Invitación enviada” junto a su nombre.</Text>
              <PrimaryButton label="ENTENDIDO" onPress={() => setPrivateRequestSentTo(null)} />
            </View>
          </View>
        </Modal>

        <Modal visible={!!activeIncomingRequest} transparent animationType="fade" onRequestClose={() => {}}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, styles.invitationCard]}>
              <Text style={styles.modalIcon}>💬</Text>
              <Text style={styles.modalTitle}>Nueva invitación privada</Text>
              {activeIncomingRequest && (
                <Text style={styles.modalBody}>
                  <Text style={styles.modalStrong}>{activeIncomingRequest.requesterUsername}</Text> quiere iniciar una conversación privada contigo.
                </Text>
              )}
              <Text style={styles.invitationConsent}>Solo podrá escribirte si aceptas la invitación.</Text>
              <PrimaryButton
                label={respondingPrivateRequest ? 'ACEPTANDO...' : 'ACEPTAR Y ABRIR CHAT'}
                onPress={() => void handleIncomingPrivateResponse(true)}
                disabled={respondingPrivateRequest}
              />
              <PrimaryButton
                label="RECHAZAR"
                variant="ghost"
                onPress={() => void handleIncomingPrivateResponse(false)}
                disabled={respondingPrivateRequest}
              />
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
  rootRow: { flex: 1 },
  rootRowWide: { flexDirection: 'row' },
  sidebar: { width: 320, borderLeftWidth: 1, borderLeftColor: colors.border },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetCard: { height: '75%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden' },
  screen: { paddingHorizontal: 0 },
  flexFill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerMobile: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  headerIdentity: { flexShrink: 1 },
  headerIdentityMobile: { width: '100%', flexShrink: 0 },
  logo: { ...typography.title, color: colors.textPrimary, fontSize: 16 },
  activityLine: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap', justifyContent: 'flex-end' },
  headerActionsMobile: { width: '100%', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'nowrap' },
  headerActionText: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  privateHeaderButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  privateAlertBadge: {
    minWidth: 19,
    height: 19,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  privateAlertBadgeText: { ...typography.caption, color: '#fff', fontWeight: '900', fontSize: 10 },
  actionToast: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionToastText: { ...typography.caption, color: colors.textPrimary },
  statusButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  statusButtonText: { ...typography.caption, color: colors.textPrimary },
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
  guestBannerText: { ...typography.caption, color: colors.textSecondary, flex: 1, marginRight: spacing.sm },
  guestBannerCta: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  loadMore: { alignItems: 'center', paddingVertical: spacing.sm },
  loadMoreText: { ...typography.caption, color: colors.accent },
  messageRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  messageRowMine: { opacity: 1 },
  avatarWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { fontSize: 16 },
  messageBody: { flex: 1 },
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  messageSocialActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  senderName: { ...typography.caption, color: colors.textPrimary, fontWeight: '800' },
  statusTag: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  followTag: { ...typography.caption, color: colors.accent, fontSize: 11, fontWeight: '800' },
  followingTag: { color: colors.textSecondary },
  privateTag: { ...typography.caption, color: colors.accent, fontSize: 11, fontWeight: '800' },
  privatePendingTag: { ...typography.caption, color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  timestamp: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginLeft: 'auto' },
  messageText: { ...typography.body, color: colors.textPrimary, marginTop: 2 },
  reactionRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  reactionChipActive: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.accent },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { ...typography.caption, color: colors.textSecondary, fontSize: 10 },
  ctaRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  ctaChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  ctaChipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  sendError: { ...typography.caption, color: colors.danger, paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
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
  sendButton: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { backgroundColor: colors.surfaceAlt },
  sendButtonText: { ...typography.subtitle, color: colors.onAccent },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
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
  invitationCard: { borderColor: colors.accent },
  modalIcon: { fontSize: 32, textAlign: 'center' },
  modalTitle: { ...typography.title, color: colors.textPrimary },
  modalBody: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  modalStrong: { color: colors.textPrimary, fontWeight: '900' },
  pendingExplanation: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  invitationConsent: { ...typography.caption, color: colors.accent, fontWeight: '800', marginBottom: spacing.sm },
  statusOption: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  statusOptionText: { ...typography.body, color: colors.textPrimary },
});
