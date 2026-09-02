import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import {
  buildChallengeResultShare,
  cancelChallenge,
  challengeShareUrl as shareUrl,
  createChallenge,
  getChallenge,
  respondDirectChallenge,
} from '../services/challengeService';
import { getChallengeReplayUrl } from '../services/scanService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { Challenge, ChallengeParticipant, RootStackParamList } from '../types';
import { fetchMyEquipped, PublicEquippedItem } from '../services/walletService';
import { formatSignedXP } from '../utils/format';
import { copyLink, shareImage, shareText } from '../utils/share';
import { generateChallengeShareCardBlob } from '../utils/shareCard';

const POLL_INTERVAL_MS = 3000;

type ChallengeRoute = RouteProp<RootStackParamList, 'Challenge'>;

/** Mini reproductor inline -- toca para cargar la signed URL y reproducir,
 * mismo mecanismo que ScanResultScreen pero compacto para el layout VS.
 * Sirve para "MI REPLAY" y "REPLAY DEL RIVAL" por igual: get-replay-url
 * decide del lado del servidor si estás autorizado a verlo, el
 * componente no necesita saber cuál de los dos casos es. */
function MiniReplay({ scanId, label }: { scanId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (url) player.play();
  }, [url, player]);

  async function handlePress() {
    if (url) {
      player.play();
      return;
    }
    setLoading(true);
    const signed = await getChallengeReplayUrl(scanId);
    setLoading(false);
    if (!signed) {
      setErrored(true);
      return;
    }
    setUrl(signed);
  }

  if (url) {
    return <VideoView style={styles.miniVideo} player={player} contentFit="cover" nativeControls />;
  }

  return (
    <Pressable onPress={handlePress} style={styles.miniReplayButton} disabled={loading}>
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} size="small" />
      ) : (
        <Text style={styles.miniReplayText}>{errored ? 'Sin video' : `▶ REPLAY ${label}`}</Text>
      )}
    </Pressable>
  );
}

export default function ChallengeScreen() {
  const { params } = useRoute<ChallengeRoute>();
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { user } = useCurrentUser();

  const [token, setToken] = useState<string | null>(params?.challengeToken ?? null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  // Arranca en `false` cuando todavía no hay token (modo "crear desde
  // scanId"): `loading` solo lo gobierna refresh(), que no corre hasta que
  // exista un token -- si empezara en `true` acá, un fallo de
  // createChallenge (sin llegar a setear token nunca) dejaría el spinner
  // de carga trabado para siempre, tapando la pantalla de error real.
  const [loading, setLoading] = useState(Boolean(params?.challengeToken));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [responding, setResponding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Efecto visual de VS (bloque cosméticos) -- si tengo un `vs_effect`
  // equipado, se ve de verdad en la pantalla de resultado (ver más abajo),
  // no solo en la Tienda.
  const [vsEffect, setVsEffect] = useState<PublicEquippedItem | null>(null);

  const hasCreatedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyEquipped().then((items) => {
      if (cancelled) return;
      setVsEffect(items.find((i) => i.slot === 'vs_effect') ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Crea el Challenge una sola vez si llegamos con scanId (creador nuevo)
  // -- el guard evita crear dos veces si el efecto corre de nuevo.
  useEffect(() => {
    if (token || !params?.scanId || hasCreatedRef.current) return;
    hasCreatedRef.current = true;
    setCreating(true);
    createChallenge(params.scanId)
      .then((newToken) => {
        setToken(newToken);
        navigation.setParams({ challengeToken: newToken, scanId: undefined });
      })
      .catch((e) => {
        console.warn('createChallenge failed', e);
        setCreateError('No pudimos crear el desafío. Intenta de nuevo.');
      })
      .finally(() => setCreating(false));
  }, [token, params?.scanId, navigation]);

  const refresh = useCallback(() => {
    if (!token) return;
    getChallenge(token).then((result) => {
      setChallenge(result);
      setLoading(false);
    });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh();
  }, [token, refresh]);

  // Polling mientras el duelo sigue abierto -- se detiene solo al llegar a
  // un estado terminal (completed/cancelled/expired).
  useEffect(() => {
    if (!token) return;
    if (challenge && !['pending', 'accepted'].includes(challenge.status)) return;

    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, challenge, refresh]);

  async function handleShareInvite() {
    if (!token || !challenge) return;
    setSharing(true);
    try {
      const result = await shareText(
        `${challenge.creator.username} te desafía en AURA VS ⚔️ ¿Tienes más Aura?`,
        shareUrl(token),
      );
      if (result === 'copied') setNotice('Enlace copiado');
      else if (result === 'unavailable') setNotice('No pudimos compartir. Copia el link manualmente.');
    } finally {
      setSharing(false);
    }
  }

  async function handleCopyLink() {
    if (!token) return;
    const ok = await copyLink(shareUrl(token));
    setNotice(ok ? 'Enlace copiado' : 'No pudimos copiar el enlace.');
  }

  async function handleCancel() {
    if (!challenge) return;
    setCancelling(true);
    const ok = await cancelChallenge(challenge.id);
    setCancelling(false);
    if (ok) {
      navigation.navigate('MainTabs');
    } else {
      setNotice('No se pudo cancelar (¿ya lo aceptaron?).');
      refresh();
    }
  }

  async function handleRespondDirect(accept: boolean) {
    if (!challenge) return;
    setResponding(true);
    setNotice(null);
    const result = await respondDirectChallenge(challenge.id, accept);
    setResponding(false);
    if (result.ok) {
      if (!accept) {
        navigation.navigate('MainTabs');
      } else {
        refresh();
      }
    } else {
      setNotice(result.errorCode === 'expired' ? 'Este desafío ya expiró.' : 'No pudimos procesar tu respuesta.');
      refresh();
    }
  }

  // CORRECCIÓN (auditoría post-iPhone, punto 9): antes esto creaba un
  // Challenge nuevo reusando `myScanId`, el scan YA COMPLETADO de la
  // batalla anterior -- una revancha "eterna" sobre el mismo resultado de
  // Aura, sin volver a escanear nada. Ahora manda a Upload a grabar un
  // Scan NUEVO (mismo mecanismo de threading que `challengeToken`, ver
  // types/index.ts y AnalyzingScreen) con el rival ya conocido -- recién
  // cuando ESE Scan nuevo termina se crea el Challenge directo real hacia
  // esa persona (ver AnalyzingScreen, rama rematchTargetUsername).
  function handleRematch() {
    if (!challenge || !user) return;
    const rivalUsername = challenge.creator.userId === user.id ? challenge.opponent?.username : challenge.creator.username;
    if (!rivalUsername) return;
    navigation.navigate('Upload', { rematchTargetUsername: rivalUsername });
  }

  async function handleShareResult() {
    if (!challenge || !user || !token) return;
    const iAmCreator = challenge.creator.userId === user.id;
    const me = iAmCreator ? challenge.creator : challenge.opponent;
    const rival = iAmCreator ? challenge.opponent : challenge.creator;
    if (!me || !rival) return;

    const iWon = challenge.winnerUserId === user.id;
    // Único generador de texto+card para "compartir resultado" -- ver
    // challengeService.buildChallengeResultShare, MyChallengesScreen usa
    // exactamente esto mismo para que nunca diverjan.
    const { text, card } = buildChallengeResultShare({
      meUsername: me.username,
      meAvatarEmoji: me.avatarEmoji,
      meScore: me.auraScore ?? 0,
      rivalUsername: rival.username,
      rivalAvatarEmoji: rival.avatarEmoji,
      rivalScore: rival.auraScore ?? 0,
      isTie: challenge.isTie,
      iWon,
    });

    setSharing(true);
    try {
      logEvent('result_shared');
      const blob = await generateChallengeShareCardBlob(card);
      const result = await shareImage(blob, `aura-vs-${token}.png`, text, shareUrl(token));
      if (result === 'copied') setNotice('Enlace copiado');
      else if (result === 'downloaded') setNotice('Imagen descargada y enlace copiado');
    } finally {
      setSharing(false);
    }
  }

  if (creating || (loading && !challenge)) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  if (createError) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <Text style={styles.notFound}>{createError}</Text>
        <PrimaryButton label="VOLVER" onPress={() => navigation.navigate('MainTabs')} />
      </ScreenContainer>
    );
  }

  if (!challenge) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <Text style={styles.notFound}>Este desafío ya no está disponible.</Text>
        <PrimaryButton label="VOLVER" onPress={() => navigation.navigate('MainTabs')} />
      </ScreenContainer>
    );
  }

  const iAmCreator = user ? challenge.creator.userId === user.id : true;
  const me = iAmCreator ? challenge.creator : challenge.opponent;
  const rival = iAmCreator ? challenge.opponent : challenge.creator;

  // ── Estados terminales sin duelo (cancelado/expirado/rechazado) ──────
  if (challenge.status === 'cancelled' || challenge.status === 'expired' || challenge.status === 'rejected') {
    const label =
      challenge.status === 'cancelled' ? 'Desafío cancelado' : challenge.status === 'expired' ? 'Desafío expirado' : 'Desafío rechazado';
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <Text style={styles.headline}>{label}</Text>
        <PrimaryButton label="VOLVER" onPress={() => navigation.navigate('MainTabs')} />
      </ScreenContainer>
    );
  }

  // ── Challenge DIRIGIDO, todavía pending, y SOY el destinatario -- tengo
  // que responder ACEPTAR/RECHAZAR (A/C). Chequeo ANTES del fallback de
  // "pending = soy el creador esperando rival" de más abajo -- ese
  // fallback sigue siendo el único camino para el Challenge clásico por
  // link (targetUserId null), no se toca. ────────────────────────────────
  if (challenge.status === 'pending' && challenge.targetUserId && user?.id === challenge.targetUserId) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <Text style={styles.avatar}>{challenge.creator.avatarEmoji}</Text>
        <Text style={styles.headline}>@{challenge.creator.username} te desafió ⚔️</Text>
        {challenge.creator.auraScore != null && (
          <Badge label={`${formatSignedXP(challenge.creator.auraScore)} AURA`} tone="accent" style={styles.badge} />
        )}
        {notice && <Text style={styles.noticeText}>{notice}</Text>}
        <View style={styles.actions}>
          <PrimaryButton
            label={responding ? '...' : 'ACEPTAR'}
            disabled={responding}
            onPress={() => handleRespondDirect(true)}
          />
          <PrimaryButton
            label={responding ? '...' : 'RECHAZAR'}
            variant="ghost"
            disabled={responding}
            onPress={() => handleRespondDirect(false)}
          />
        </View>
      </ScreenContainer>
    );
  }

  // ── Resultado (completed) ─────────────────────────────────────────────
  if (challenge.status === 'completed' && me && rival) {
    const iWon = challenge.winnerUserId != null && user?.id === challenge.winnerUserId;
    const myXp = iAmCreator ? challenge.creatorXpAwarded : challenge.opponentXpAwarded;

    return (
      <ScreenContainer scroll onBack={goBack}>
        <Text style={styles.headline}>@{me.username} VS @{rival.username}</Text>

        <View style={styles.versusRow}>
          <ParticipantColumn participant={me} isMe highlight={iWon} />
          <View style={[styles.vsBadge, vsEffect && styles.vsBadgeWithEffect]}>
            {vsEffect && <Text style={styles.vsEffectGlyph}>{vsEffect.assetRef}</Text>}
            <Text style={styles.vsText}>VS</Text>
          </View>
          <ParticipantColumn
            participant={rival}
            isMe={false}
            highlight={!challenge.isTie && !iWon}
            onPress={() => navigation.navigate('PublicProfile', { username: rival.username })}
          />
        </View>

        <Text style={styles.resultLine}>
          {challenge.isTie ? '🤝 EMPATE' : iWon ? '🏆 GANASTE' : `🏆 GANÓ @${rival.username}`}
        </Text>

        {myXp != null && myXp > 0 && <Text style={styles.xpLine}>+{myXp} XP de este desafío</Text>}

        <Card style={styles.statsCard}>
          <Text style={styles.statsTitle}>DIFERENCIAS</Text>
          {(['confidence', 'style', 'timing', 'cringeRisk'] as const).map((key) => (
            <View key={key} style={styles.statRow}>
              <Text style={styles.statLabel}>{STAT_LABELS[key]}</Text>
              <Text style={styles.statValue}>
                {me.stats?.[key] ?? '–'} vs {rival.stats?.[key] ?? '–'}
              </Text>
            </View>
          ))}
        </Card>

        <View style={styles.replayRow}>
          {me.scanId && me.videoPath && <MiniReplay scanId={me.scanId} label="TUYO" />}
          {rival.scanId && rival.videoPath && (
            <MiniReplay scanId={rival.scanId} label={rival.username.toUpperCase()} />
          )}
        </View>

        {notice && <Text style={styles.noticeText}>{notice}</Text>}

        <View style={styles.actions}>
          <PrimaryButton
            label={sharing ? 'GENERANDO IMAGEN...' : 'COMPARTIR RESULTADO'}
            disabled={sharing}
            onPress={handleShareResult}
          />
          <PrimaryButton label="NUEVA REVANCHA" variant="ghost" onPress={handleRematch} />
          <PrimaryButton label="VOLVER" variant="text" onPress={() => navigation.navigate('MainTabs')} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Aceptado: distintas vistas según en qué punto está mi propio scan ──
  if (challenge.status === 'accepted') {
    // El creador (A) ya tiene su scan por definición -- solo el oponente
    // (B) puede estar en "todavía no escaneé" / "falló, reintentar".
    if (!iAmCreator && rival) {
      if (!me?.scanId) {
        return (
          <ScreenContainer style={styles.center} onBack={goBack}>
            <Text style={styles.avatar}>{rival.avatarEmoji}</Text>
            <Text style={styles.headline}>Aceptaste el desafío de @{rival.username}</Text>
            <Text style={styles.copy}>Ahora te toca a ti. Graba o sube tu Scan.</Text>
            <PrimaryButton
              label="HACER MI SCAN"
              onPress={() => navigation.navigate('Upload', { challengeToken: token ?? undefined })}
            />
          </ScreenContainer>
        );
      }

      if (me.scanStatus === 'failed' || me.scanStatus === 'rejected') {
        return (
          <ScreenContainer style={styles.center} onBack={goBack}>
            <Text style={styles.headline}>Tu Scan no se pudo procesar</Text>
            <Text style={styles.copy}>El desafío sigue abierto -- puedes intentarlo de nuevo.</Text>
            <PrimaryButton
              label="REINTENTAR MI SCAN"
              onPress={() => navigation.navigate('Upload', { challengeToken: token ?? undefined })}
            />
          </ScreenContainer>
        );
      }
    }

    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.headline}>
          {iAmCreator ? `@${rival?.username} está haciendo su Scan…` : 'Analizando tu Scan…'}
        </Text>
        <Text style={styles.copy}>Esto puede tardar unos segundos.</Text>
      </ScreenContainer>
    );
  }

  // ── Pending: soy el creador esperando rival ──────────────────────────
  return (
    <ScreenContainer style={styles.center} onBack={goBack}>
      <Text style={styles.headline}>Desafío creado ⚔️</Text>
      {/* Punto 10 (auditoría post-iPhone): un Challenge DIRIGIDO a alguien
          conocido dice quién, en vez del genérico "Esperando rival" --
          ese genérico se reserva para el link compartido, donde
          legítimamente todavía no hay un rival específico. */}
      <Text style={styles.copy}>{challenge.targetUsername ? `Esperando a @${challenge.targetUsername}…` : 'Esperando rival…'}</Text>

      <Card style={styles.waitingCard}>
        <Text style={styles.avatar}>{challenge.creator.avatarEmoji}</Text>
        <Text style={styles.waitingUsername}>@{challenge.creator.username}</Text>
        {challenge.creator.auraScore != null && (
          <Badge label={`${formatSignedXP(challenge.creator.auraScore)} AURA`} tone="accent" style={styles.badge} />
        )}
      </Card>

      {notice && <Text style={styles.noticeText}>{notice}</Text>}

      <View style={styles.actions}>
        <PrimaryButton label={sharing ? 'COMPARTIENDO...' : 'COMPARTIR'} disabled={sharing} onPress={handleShareInvite} />
        <PrimaryButton label="COPIAR LINK" variant="ghost" onPress={handleCopyLink} />
        <PrimaryButton
          label={cancelling ? 'CANCELANDO...' : 'CANCELAR DESAFÍO'}
          variant="text"
          disabled={cancelling}
          onPress={handleCancel}
        />
      </View>

      {/* Loop de retención: esperar a que el rival acepte no debería ser
          una pantalla muerta -- ofrece la siguiente acción natural sin
          competir con COMPARTIR (que sigue siendo el CTA principal acá). */}
      <Pressable onPress={() => navigation.navigate('Upload')} hitSlop={6}>
        <Text style={styles.waitingHint}>Mientras esperas, escanea otro momento ›</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const STAT_LABELS: Record<'confidence' | 'style' | 'timing' | 'cringeRisk', string> = {
  confidence: 'CONFIANZA',
  style: 'ESTILO',
  timing: 'TIMING',
  cringeRisk: 'RIESGO CRINGE',
};

function ParticipantColumn({
  participant,
  isMe,
  highlight,
  onPress,
}: {
  participant: ChallengeParticipant;
  isMe: boolean;
  highlight: boolean;
  /** Solo el rival es tocable -- lleva a su perfil público (ver item 4,
   * "tocar usuario -> perfil público"). "TÚ" no navega a ningún lado. */
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text style={styles.playerAvatar}>{participant.avatarEmoji}</Text>
      <Text style={styles.playerName}>
        {highlight ? '🏆 ' : ''}
        {isMe ? 'TÚ' : `@${participant.username}`}
      </Text>
      <Text style={[styles.playerScore, isMe ? styles.youColor : styles.friendColor]}>
        {participant.auraScore != null ? formatSignedXP(participant.auraScore) : '···'}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable style={styles.player} onPress={onPress}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.player}>{content}</View>;
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  headline: {
    ...typography.hero,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  copy: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notFound: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  avatar: {
    fontSize: 48,
  },
  waitingCard: {
    alignItems: 'center',
    padding: spacing.lg,
    width: '100%',
  },
  waitingUsername: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  badge: {
    marginTop: spacing.sm,
  },
  versusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  player: {
    flex: 1,
    alignItems: 'center',
  },
  playerAvatar: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  playerName: {
    ...typography.eyebrow,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  playerScore: {
    ...typography.hero,
  },
  youColor: {
    color: colors.accent,
  },
  friendColor: {
    color: colors.secondary,
  },
  vsBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.sm,
  },
  vsBadgeWithEffect: {
    width: 56,
    height: 56,
    borderColor: '#FFD700',
    borderWidth: 2,
  },
  vsEffectGlyph: {
    position: 'absolute',
    top: -18,
    fontSize: 18,
  },
  vsText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  resultLine: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  xpLine: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  statsCard: {
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  statsTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  replayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    width: '100%',
  },
  miniReplayButton: {
    flex: 1,
    minWidth: 120,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniReplayText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  miniVideo: {
    flex: 1,
    minWidth: 120,
    aspectRatio: 9 / 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  noticeText: {
    ...typography.caption,
    color: colors.success,
    textAlign: 'center',
  },
  waitingHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  actions: {
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
});
