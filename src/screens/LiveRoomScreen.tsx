import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAuth } from '../hooks/useAuth';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { getGuestId } from '../services/chatService';
import { supabase } from '../services/supabaseClient';
import { followUser } from '../services/followService';
import { captureAuraCheckClip, isAuraCheckCaptureSupported } from '../services/liveAuraCapture';
import { LiveConnectionState, LiveMediaController, connectToLiveRoom } from '../services/liveMediaService.web';
import {
  LIVE_REACTION_EMOJIS,
  subscribeToLiveAuraCheckUpdates,
  subscribeToLiveComments,
  subscribeToLiveReactions,
  subscribeToNewLivePolls,
  sendLiveReaction,
  LiveReactionEmoji,
} from '../services/liveRealtimeService';
import {
  LIVE_COMMENT_MAX_LENGTH,
  LiveAuraCheck,
  LiveComment,
  LiveHostProfile,
  LivePoll,
  LivePollStatus,
  LiveRoom,
  createLivePoll,
  endLiveRoom,
  fetchLiveHostProfiles,
  fetchLivePoll,
  fetchLiveRoomBySlug,
  fetchRecentLiveComments,
  getLivePollStatus,
  liveShareUrl,
  reportLivePeakViewers,
  requestLiveAuraCheck,
  sendLiveComment,
  voteLivePoll,
} from '../services/liveService';
import { fetchMyReferralInfo } from '../services/referralService';
import { RootStackParamList } from '../types';
import { colors, radius, spacing, typography } from '../theme/colors';
import { shareText } from '../utils/share';

type LiveRoomRoute = RouteProp<RootStackParamList, 'LiveRoom'>;

const AURA_LIVE_ENABLED = process.env.EXPO_PUBLIC_AURA_LIVE_ENABLED === 'true';
const LIVEKIT_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? '';
const PEAK_VIEWERS_REPORT_INTERVAL_MS = 20000;
const REACTION_DISPLAY_MS = 2500;
const AURA_CHECK_OVERLAY_MS = 8000;

type PromptReason = 'comment' | 'follow' | 'vote';

interface FloatingReaction {
  id: string;
  emoji: LiveReactionEmoji;
}

/**
 * AURA LIVE -- pantalla única de sala (host + viewer + estado terminado,
 * sección 30 del pedido: "evita convertir ChatScreen.tsx en un archivo
 * gigantesco" -- acá la UI está separada de los servicios de verdad:
 * liveService (metadata/RPC), liveMediaService.web (LiveKit),
 * liveRealtimeService (comentarios/reacciones/polls), liveAuraCapture
 * (clip de Aura Check). Esta pantalla solo orquesta.
 *
 * Identidad del viewer SIEMPRE reactiva (`useAuth().session`, nunca un
 * `useEffect(() => {...}, [])` de una sola vez) -- a propósito: Chat V2
 * tuvo un bug real de QA en dos iPhone donde la pantalla de Chat podía
 * seguir mostrando al visitante como invitado después de loguearse
 * porque resolvía la identidad una sola vez al montar. Acá, el efecto de
 * conexión a LiveKit depende explícitamente de `session?.user.id` (ver
 * abajo), así que un login real mientras se está viendo un LIVE siempre
 * dispara una reconexión completa con la identidad nueva -- nunca un
 * token/viewer invitado obsoleto. Ver la verificación específica de esto
 * en el reporte final de esta tarea.
 */
export default function LiveRoomScreen() {
  const { params } = useRoute<LiveRoomRoute>();
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { session } = useAuth();

  const videoContainerRef = useRef<View>(null);
  const mediaControllerRef = useRef<LiveMediaController | null>(null);
  const wasGuestRef = useRef(false);
  const viewerCountRef = useRef(0);
  const peakReportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 'live_left'/'live_reconnect' necesitan saber si YA hubo una conexión
  // real antes -- sin esto, el primer intento de conexión se confundiría
  // con una reconexión, y un desmontaje antes de conectar nunca con un
  // abandono real (ver los dos efectos que usan estos refs más abajo).
  const hasJoinedRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);

  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [hostProfile, setHostProfile] = useState<LiveHostProfile | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);

  const [connectionState, setConnectionState] = useState<LiveConnectionState>('connecting');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commenterProfiles, setCommenterProfiles] = useState<Record<string, LiveHostProfile>>({});
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [promptReason, setPromptReason] = useState<PromptReason | null>(null);

  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [auraCheck, setAuraCheck] = useState<LiveAuraCheck | null>(null);
  const [auraCheckCapturing, setAuraCheckCapturing] = useState(false);

  const [activePoll, setActivePoll] = useState<LivePoll | null>(null);
  const [pollStatus, setPollStatus] = useState<LivePollStatus | null>(null);
  const [pollFormOpen, setPollFormOpen] = useState(false);
  const [pollOptionA, setPollOptionA] = useState('');
  const [pollOptionB, setPollOptionB] = useState('');

  const [endConfirming, setEndConfirming] = useState(false);
  const [ending, setEnding] = useState(false);

  const isHost = Boolean(session && room && session.user.id === room.hostUserId);

  // Resolución de identidad de invitado -- UNA sola vez (el visitor_id es
  // estable por dispositivo, igual criterio que Chat V1/V2), pero su USO
  // (¿armar un token de invitado o de autenticado?) depende de `session`
  // reactivamente -- ver el efecto de conexión más abajo.
  useEffect(() => {
    getGuestId().then(setGuestId);
  }, []);

  const loadRoom = useCallback(async () => {
    setLoadingRoom(true);
    const r = await fetchLiveRoomBySlug(params.slug);
    setRoom(r);
    if (r) {
      const profiles = await fetchLiveHostProfiles([r.hostUserId]);
      setHostProfile(profiles[r.hostUserId] ?? null);
    }
    setLoadingRoom(false);
  }, [params.slug]);

  useFocusEffect(
    useCallback(() => {
      logEvent('live_room_viewed', { slug: params.slug });
      loadRoom();
    }, [loadRoom, params.slug]),
  );

  // Conversión invitado -> autenticado MIENTRAS se mira este LIVE (sección
  // 9/41: "no quedan subscriptions/tokens/estado viejo del invitado").
  useEffect(() => {
    if (!session) {
      wasGuestRef.current = true;
    } else if (wasGuestRef.current) {
      wasGuestRef.current = false;
      logEvent('live_guest_converted');
    }
  }, [session]);

  // Conexión a LiveKit -- depende EXPLÍCITAMENTE de session?.user.id (no
  // solo de si hay sesión o no): esto es lo que garantiza una reconexión
  // real con identidad nueva ante login/logout, nunca un token obsoleto.
  useEffect(() => {
    if (!room || !AURA_LIVE_ENABLED || !LIVEKIT_URL) return;
    if (Platform.OS !== 'web') {
      setMediaError('AURA LIVE solo está disponible en el navegador por ahora.');
      return;
    }
    if (!isHost && room.status !== 'live') return; // nada que ver todavía/ya terminó.
    if (isHost && (room.status === 'ended' || room.status === 'cancelled')) return;
    if (!session && !guestId) return; // esperando resolver identidad de invitado.

    let cancelled = false;
    logEvent('live_join_attempted', { live_room_id: room.id, role: isHost ? 'host' : 'viewer' });

    (async () => {
      try {
        if (!supabase) throw new Error('not_configured');
        // Mismo patrón que process-scan/get-replay-url en el resto del
        // proyecto -- supabase.functions.invoke() ya manda el JWT real
        // del usuario logueado (Authorization: Bearer <access_token>) o
        // cae a la anon key cuando no hay sesión, exactamente lo que
        // livekit-token necesita para decidir host/viewer/invitado
        // server-side (nunca confía en lo que este cliente le diga).
        const { data: tokenRes, error: tokenErr } = await supabase.functions.invoke('livekit-token', {
          body: { roomId: room.id, guestId: session ? undefined : guestId },
        });

        if (cancelled) return;
        if (tokenErr || !tokenRes?.token) {
          setMediaError('No pudimos conectar al LIVE.');
          logEvent('live_join_failed', { live_room_id: room.id, reason: tokenRes?.error ?? String(tokenErr) });
          return;
        }

        const container = videoContainerRef.current as unknown as HTMLElement | null;
        if (!container) return;

        const controller = await connectToLiveRoom({
          livekitUrl: LIVEKIT_URL,
          token: tokenRes.token,
          role: isHost ? 'host' : 'viewer',
          videoContainer: container,
          onConnectionStateChange: (state) => {
            // 'live_reconnect': solo cuenta como reconexión si YA hubo una
            // conexión real antes -- el primer 'connecting' -> 'connected'
            // de la conexión inicial nunca es una reconexión.
            if (state === 'reconnecting' && hasJoinedRef.current && roomIdRef.current) {
              logEvent('live_reconnect', { live_room_id: roomIdRef.current });
            }
            setConnectionState(state);
          },
          onViewerCountChange: (count) => {
            viewerCountRef.current = count;
            setViewerCount(count);
          },
          onError: (message) => setMediaError(message),
        });
        if (cancelled) {
          await controller.disconnect();
          return;
        }
        mediaControllerRef.current = controller;
        hasJoinedRef.current = true;
        roomIdRef.current = room.id;
        logEvent('live_joined', { live_room_id: room.id, role: isHost ? 'host' : 'viewer' });
      } catch (e) {
        if (!cancelled) {
          setMediaError('No pudimos conectar al LIVE.');
          logEvent('live_join_failed', { live_room_id: room.id, reason: String(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
      mediaControllerRef.current?.disconnect();
      mediaControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.status, isHost, session?.user.id, guestId]);

  // 'live_left' -- abandono real de la sala. Deliberadamente en su propio
  // efecto con deps vacías: el cleanup de ARRIBA corre en cada reconexión
  // (cambio de sesión, cambio de estado de la sala, etc.), pero este solo
  // corre una vez, cuando la pantalla se desmonta de verdad -- nunca se
  // confunde una reconexión con un abandono.
  useEffect(() => {
    return () => {
      if (hasJoinedRef.current && roomIdRef.current) {
        logEvent('live_left', { live_room_id: roomIdRef.current });
      }
    };
  }, []);

  // Host: reporta el pico real de espectadores cada ~20s (sección 36) --
  // nunca inventa un número, usa viewerCountRef (LiveKit real).
  useEffect(() => {
    if (!isHost || !room) return;
    peakReportTimerRef.current = setInterval(() => {
      reportLivePeakViewers(room.id, viewerCountRef.current);
    }, PEAK_VIEWERS_REPORT_INTERVAL_MS);
    return () => {
      if (peakReportTimerRef.current) clearInterval(peakReportTimerRef.current);
    };
  }, [isHost, room]);

  // Comentarios: carga inicial + Realtime (best-effort, ver el límite
  // honesto ya documentado en Chat V1/V2).
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    fetchRecentLiveComments(room.id).then(async (list) => {
      if (cancelled) return;
      setComments([...list].reverse());
      const profiles = await fetchLiveHostProfiles(list.map((c) => c.userId));
      if (!cancelled) setCommenterProfiles((prev) => ({ ...prev, ...profiles }));
    });
    const unsub = subscribeToLiveComments(
      room.id,
      (comment) => {
        setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
        fetchLiveHostProfiles([comment.userId]).then((p) => setCommenterProfiles((prev) => ({ ...prev, ...p })));
      },
      (hiddenId) => setComments((prev) => prev.filter((c) => c.id !== hiddenId)),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [room]);

  // Reacciones efímeras -- nunca persistidas, ver liveRealtimeService.
  useEffect(() => {
    if (!room) return;
    return subscribeToLiveReactions(room.id, ({ emoji }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setReactions((prev) => [...prev, { id, emoji }]);
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), REACTION_DISPLAY_MS);
    });
  }, [room]);

  // Aura Check -- overlay temporal para TODOS los espectadores.
  useEffect(() => {
    if (!room) return;
    return subscribeToLiveAuraCheckUpdates(room.id, (check) => {
      if (check.status === 'done') {
        setAuraCheck(check);
        logEvent('live_aura_check_completed', { live_room_id: room.id });
        setTimeout(() => setAuraCheck((prev) => (prev?.id === check.id ? null : prev)), AURA_CHECK_OVERLAY_MS);
      } else if (check.status === 'failed') {
        logEvent('live_aura_check_failed', { live_room_id: room.id });
      }
    });
  }, [room]);

  // Votación -- detecta un poll nuevo y refresca conteos con polling
  // liviano mientras está activo (ver el comentario en liveRealtimeService
  // sobre por qué los votos individuales no son Realtime-suscribibles).
  useEffect(() => {
    if (!room) return;
    return subscribeToNewLivePolls(room.id, (pollId) => {
      fetchLivePoll(pollId).then((p) => {
        if (p) setActivePoll(p);
      });
    });
  }, [room]);

  useEffect(() => {
    if (!activePoll || activePoll.status !== 'active') return;
    let cancelled = false;
    const tick = () => getLivePollStatus(activePoll.id).then((s) => !cancelled && setPollStatus(s));
    tick();
    const interval = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activePoll]);

  function openSignupPrompt(reason: PromptReason) {
    setPromptReason(reason);
    logEvent('live_signup_prompted', { reason });
  }

  function handleSignupFromPrompt() {
    setPromptReason(null);
    navigation.navigate('Auth', { initialMode: 'signUp' });
  }

  async function handleSendComment() {
    if (!room) return;
    if (!session) {
      openSignupPrompt('comment');
      return;
    }
    const body = draft.trim();
    if (!body) return;
    const result = await sendLiveComment(room.id, body);
    if (!result.ok) {
      setSendError(result.errorCode === 'rate_limited' ? 'Vas muy rápido -- espera unos segundos.' : 'No pudimos enviar tu comentario.');
      return;
    }
    setSendError(null);
    setDraft('');
  }

  function handleReaction(emoji: LiveReactionEmoji) {
    if (!room) return;
    const id = `${Date.now()}-local`;
    setReactions((prev) => [...prev, { id, emoji }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), REACTION_DISPLAY_MS);
    sendLiveReaction(room.id, emoji, session?.user.id ?? guestId ?? 'anon');
    logEvent('live_reaction_sent', { emoji, live_room_id: room.id });
  }

  async function handleFollowHost() {
    if (!hostProfile) return;
    if (!session) {
      openSignupPrompt('follow');
      return;
    }
    logEvent('live_follow_clicked');
    await followUser(hostProfile.username);
  }

  async function handleShare() {
    if (!room) return;
    logEvent('live_share_clicked');
    await shareText('🔴 Estamos EN VIVO en AURA VS ⚡\nEntra a ver la Batalla de Aura:', liveShareUrl(room.slug));
  }

  async function handleToggleMic() {
    const next = !micEnabled;
    setMicEnabled(next);
    await mediaControllerRef.current?.setMicEnabled(next);
  }

  async function handleToggleCamera() {
    const next = !cameraEnabled;
    setCameraEnabled(next);
    await mediaControllerRef.current?.setCameraEnabled(next);
  }

  async function handleSwitchCamera() {
    await mediaControllerRef.current?.switchCamera();
  }

  async function handleAuraCheck() {
    if (!room || auraCheckCapturing) return;
    if (!isAuraCheckCaptureSupported()) {
      setMediaError('Tu navegador no soporta grabar el Aura Check todavía.');
      return;
    }
    setAuraCheckCapturing(true);
    logEvent('live_aura_check_started', { live_room_id: room.id });
    const videoTrack = mediaControllerRef.current?.getLocalVideoTrack() ?? null;
    const audioTrack = mediaControllerRef.current?.getLocalAudioTrack() ?? null;
    const capture = await captureAuraCheckClip(videoTrack, audioTrack);
    if (!capture.ok || !capture.blob) {
      setAuraCheckCapturing(false);
      logEvent('live_aura_check_failed', { live_room_id: room.id, reason: capture.errorCode });
      return;
    }
    await requestLiveAuraCheck(room.id, capture.blob);
    setAuraCheckCapturing(false);
  }

  async function handleStartPoll() {
    if (!room || !pollOptionA.trim() || !pollOptionB.trim()) return;
    const result = await createLivePoll(room.id, pollOptionA.trim(), pollOptionB.trim());
    if (result.ok) {
      setPollFormOpen(false);
      setPollOptionA('');
      setPollOptionB('');
    }
  }

  async function handleVote(option: 'a' | 'b') {
    if (!activePoll) return;
    if (!session) {
      openSignupPrompt('vote');
      return;
    }
    await voteLivePoll(activePoll.id, option);
    const s = await getLivePollStatus(activePoll.id);
    setPollStatus(s);
  }

  async function handleEndLive() {
    if (!room || ending) return;
    setEnding(true);
    await endLiveRoom(room.id);
    await mediaControllerRef.current?.disconnect();
    mediaControllerRef.current = null;
    setEnding(false);
    setEndConfirming(false);
    setRoom((prev) => (prev ? { ...prev, status: 'ended' } : prev));
  }

  if (loadingRoom) {
    return (
      <ScreenContainer onBack={goBack}>
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (!room) {
    return (
      <ScreenContainer onBack={goBack}>
        <Text style={styles.endedTitle}>No encontramos este LIVE.</Text>
        <PrimaryButton label="ENTRAR A AURA VS" onPress={() => navigation.navigate('MainTabs')} />
      </ScreenContainer>
    );
  }

  if (room.status === 'ended' || room.status === 'cancelled') {
    return (
      <ScreenContainer onBack={goBack} style={styles.endedScreen}>
        <Text style={styles.endedEmoji}>🔴</Text>
        <Text style={styles.endedTitle}>Este LIVE terminó</Text>
        {hostProfile && <Text style={styles.endedSubtitle}>{room.title} -- @{hostProfile.username}</Text>}
        <PrimaryButton label="ENTRAR A AURA VS" onPress={() => navigation.navigate('MainTabs')} />
        <PrimaryButton
          label="⚡ MEDIR MI AURA"
          variant="ghost"
          onPress={() => navigation.navigate('Auth', { initialMode: 'signUp', context: 'measure_aura' })}
        />
      </ScreenContainer>
    );
  }

  if (!AURA_LIVE_ENABLED || !LIVEKIT_URL) {
    return (
      <ScreenContainer onBack={goBack}>
        <Text style={styles.endedTitle}>AURA LIVE todavía no está disponible.</Text>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.root}>
      <View ref={videoContainerRef} style={styles.video} />

      <View style={styles.topOverlay}>
        <View style={styles.liveBadgeRow}>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>🔴 EN VIVO</Text>
          </View>
          <Text style={styles.viewerCount}>👁 {viewerCount}</Text>
        </View>
        <Text style={styles.roomTitle} numberOfLines={1}>{room.title}</Text>
        {hostProfile && <Text style={styles.hostName}>@{hostProfile.username}</Text>}
        {connectionState === 'reconnecting' && <Text style={styles.connectionNotice}>Reconectando...</Text>}
        {connectionState === 'failed' && <Text style={styles.connectionNotice}>Conexión inestable</Text>}
        {mediaError && <Text style={styles.connectionNotice}>{mediaError}</Text>}
        <Pressable onPress={goBack} style={styles.closeButton} hitSlop={10}>
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>
      </View>

      {auraCheck?.result && (
        <View style={styles.auraCheckOverlay}>
          <Text style={styles.auraCheckTitle}>⚡ AURA CHECK</Text>
          <Text style={styles.auraCheckLine}>Confianza: {auraCheck.result.confidence}</Text>
          <Text style={styles.auraCheckLine}>Estilo: {auraCheck.result.style}</Text>
          <Text style={styles.auraCheckLine}>Timing: {auraCheck.result.timing}</Text>
          <Text style={styles.auraCheckScore}>AURA MOMENT: {auraCheck.result.auraScore} ⚡</Text>
        </View>
      )}

      {activePoll && activePoll.status === 'active' && (
        <View style={styles.pollOverlay}>
          <Text style={styles.pollTitle}>VOTO DEL PÚBLICO ⚔️</Text>
          <Pressable style={styles.pollOption} onPress={() => handleVote('a')}>
            <Text style={styles.pollOptionText}>{activePoll.optionALabel}</Text>
            {pollStatus && <Text style={styles.pollCount}>{pollStatus.optionACount}</Text>}
          </Pressable>
          <Pressable style={styles.pollOption} onPress={() => handleVote('b')}>
            <Text style={styles.pollOptionText}>{activePoll.optionBLabel}</Text>
            {pollStatus && <Text style={styles.pollCount}>{pollStatus.optionBCount}</Text>}
          </Pressable>
        </View>
      )}

      <View style={styles.reactionLayer} pointerEvents="none">
        {reactions.map((r) => (
          <Text key={r.id} style={styles.floatingReaction}>{r.emoji}</Text>
        ))}
      </View>

      <View style={styles.bottomOverlay}>
        <FlatList
          data={comments.slice(-6)}
          keyExtractor={(c) => c.id}
          style={styles.commentsList}
          renderItem={({ item }) => (
            <Text style={styles.commentLine} numberOfLines={2}>
              <Text style={styles.commentAuthor}>{commenterProfiles[item.userId]?.username ?? '...'}</Text> {item.body}
            </Text>
          )}
        />

        <View style={styles.actionsRow}>
          {LIVE_REACTION_EMOJIS.map((emoji) => (
            <Pressable key={emoji} style={styles.reactionButton} onPress={() => handleReaction(emoji)}>
              <Text style={styles.reactionButtonText}>{emoji}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.reactionButton} onPress={handleShare}>
            <Text style={styles.reactionButtonText}>↗️</Text>
          </Pressable>
          {!isHost && (
            <Pressable style={styles.followButton} onPress={handleFollowHost}>
              <Text style={styles.followButtonText}>+ Seguir</Text>
            </Pressable>
          )}
        </View>

        {sendError && <Text style={styles.sendError}>{sendError}</Text>}
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Escribe un comentario..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.input}
            maxLength={LIVE_COMMENT_MAX_LENGTH}
            onSubmitEditing={handleSendComment}
          />
          <Pressable onPress={handleSendComment} style={styles.sendButton}>
            <Text style={styles.sendButtonText}>➤</Text>
          </Pressable>
        </View>

        {isHost && (
          <View style={styles.hostControls}>
            <Pressable style={styles.hostControlChip} onPress={handleToggleMic}>
              <Text style={styles.hostControlChipText}>{micEnabled ? '🎙️' : '🔇'}</Text>
            </Pressable>
            <Pressable style={styles.hostControlChip} onPress={handleToggleCamera}>
              <Text style={styles.hostControlChipText}>{cameraEnabled ? '📷' : '🚫'}</Text>
            </Pressable>
            <Pressable style={styles.hostControlChip} onPress={handleSwitchCamera}>
              <Text style={styles.hostControlChipText}>🔄</Text>
            </Pressable>
            <Pressable style={styles.hostControlChip} onPress={handleAuraCheck} disabled={auraCheckCapturing}>
              <Text style={styles.hostControlChipText}>{auraCheckCapturing ? '...' : '⚡'}</Text>
            </Pressable>
            <Pressable style={styles.hostControlChip} onPress={() => setPollFormOpen(true)}>
              <Text style={styles.hostControlChipText}>⚔️</Text>
            </Pressable>
            <Pressable style={styles.hostEndChip} onPress={() => setEndConfirming(true)}>
              <Text style={styles.hostControlChipText}>Terminar</Text>
            </Pressable>
          </View>
        )}
      </View>

      {endConfirming && (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Terminar transmisión?</Text>
            <PrimaryButton label={ending ? '...' : 'SÍ, TERMINAR'} disabled={ending} onPress={handleEndLive} />
            <PrimaryButton label="Seguir en vivo" variant="text" onPress={() => setEndConfirming(false)} />
          </View>
        </View>
      )}

      {pollFormOpen && (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Votación ⚔️</Text>
            <TextInput
              value={pollOptionA}
              onChangeText={setPollOptionA}
              placeholder="Participante A"
              placeholderTextColor={colors.textMuted}
              style={styles.modalInput}
              maxLength={60}
            />
            <TextInput
              value={pollOptionB}
              onChangeText={setPollOptionB}
              placeholder="Participante B"
              placeholderTextColor={colors.textMuted}
              style={styles.modalInput}
              maxLength={60}
            />
            <PrimaryButton label="INICIAR VOTACIÓN" onPress={handleStartPoll} />
            <PrimaryButton label="Cancelar" variant="text" onPress={() => setPollFormOpen(false)} />
          </View>
        </View>
      )}

      {promptReason && (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Crea tu cuenta para participar en el LIVE</Text>
            <Text style={styles.modalBody}>
              {promptReason === 'comment' && 'Comentar es solo para cuentas registradas.'}
              {promptReason === 'follow' && 'Seguir al host es parte de tu perfil AURA VS.'}
              {promptReason === 'vote' && 'Votar es solo para cuentas registradas.'}
            </Text>
            <PrimaryButton label="CREAR CUENTA" onPress={handleSignupFromPrompt} />
            <PrimaryButton label="Ahora no" variant="text" onPress={() => setPromptReason(null)} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFill,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
    gap: 2,
  },
  liveBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  liveBadge: {
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  liveBadgeText: {
    ...typography.caption,
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
  },
  viewerCount: {
    ...typography.caption,
    color: '#fff',
    fontWeight: '700',
  },
  roomTitle: {
    ...typography.subtitle,
    color: '#fff',
    fontWeight: '800',
  },
  hostName: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.8)',
  },
  connectionNotice: {
    ...typography.caption,
    color: '#ffd166',
    marginTop: 2,
  },
  closeButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
  },
  closeButtonText: {
    ...typography.title,
    color: '#fff',
  },
  auraCheckOverlay: {
    position: 'absolute',
    top: '30%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  auraCheckTitle: {
    ...typography.title,
    color: colors.accent,
  },
  auraCheckLine: {
    ...typography.body,
    color: '#fff',
  },
  auraCheckScore: {
    ...typography.title,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  pollOverlay: {
    position: 'absolute',
    top: '15%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    minWidth: 220,
  },
  pollTitle: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
    textAlign: 'center',
  },
  pollOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pollOptionText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '700',
  },
  pollCount: {
    ...typography.body,
    color: '#fff',
  },
  reactionLayer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingRight: spacing.lg,
    paddingBottom: 220,
  },
  floatingReaction: {
    fontSize: 28,
    marginVertical: 2,
  },
  bottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    gap: spacing.sm,
  },
  commentsList: {
    maxHeight: 130,
  },
  commentLine: {
    ...typography.caption,
    color: '#fff',
    marginBottom: 2,
  },
  commentAuthor: {
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  reactionButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionButtonText: {
    fontSize: 16,
  },
  followButton: {
    marginLeft: 'auto',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  followButtonText: {
    ...typography.caption,
    color: colors.onAccent,
    fontWeight: '800',
  },
  sendError: {
    ...typography.caption,
    color: '#ff8787',
  },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    ...typography.subtitle,
    color: colors.onAccent,
  },
  hostControls: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  hostControlChip: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostControlChipText: {
    fontSize: 16,
  },
  hostEndChip: {
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.7)',
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
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
  endedScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  endedEmoji: {
    fontSize: 40,
  },
  endedTitle: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  endedSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
