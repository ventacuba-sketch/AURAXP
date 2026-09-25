import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AuraScanner } from '../components/AuraScanner';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ConfettiBurst } from '../components/ConfettiBurst';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatMeter } from '../components/StatMeter';
import { TimelineRow } from '../components/TimelineRow';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useScanResult } from '../hooks/useScanResult';
import { useSmartBack } from '../hooks/useSmartBack';
import { requestInstallInvite } from '../services/installService';
import { requestNotificationInvite } from '../services/pushService';
import { markFirstResultSeen } from '../services/onboardingService';
import { getVideoPlaybackUrl } from '../services/scanService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';
import { fetchMyEquipped, PublicEquippedItem } from '../services/walletService';
import { formatSignedXP } from '../utils/format';
import { shareText } from '../utils/share';

type ScanResultRoute = RouteProp<RootStackParamList, 'ScanResult'>;

export default function ScanResultScreen() {
  const { params } = useRoute<ScanResultRoute>();
  const { result, loading } = useScanResult(params?.scanId);
  const navigation = useRootNavigation();
  const goBack = useSmartBack();

  const scanId = result?.id ?? params?.scanId ?? 'unknown';

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoUrlLoading, setVideoUrlLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  // Efecto visual de resultado (bloque cosméticos) -- si tengo un
  // `result_effect` equipado (ver walletService/StoreScreen), se ve de
  // verdad acá, no solo en la Tienda: borde dorado + una fila del emoji
  // del efecto arriba del puntaje.
  const [resultEffect, setResultEffect] = useState<PublicEquippedItem | null>(null);
  // Onboarding (bloque 12) -- highlight liviano, no bloqueante, mostrado
  // UNA sola vez por dispositivo (ver onboardingService): introduce Coins/
  // Wallet justo cuando ya tienen sentido (recién vio su primer resultado
  // real), sin sumar una pantalla ni un paso más al flujo.
  const [showFirstResultHighlight, setShowFirstResultHighlight] = useState(false);
  // Boost de Confeti (bloque tienda/consumibles, punto 3/4 de la
  // auditoría post-iPhone) -- lo decide el SERVER (process-scan sabe si
  // había un consumible armado y lo consumió justo para este scan, ver
  // scanService.ts), nunca el cliente.
  const [showConfetti, setShowConfetti] = useState(false);
  // `result` llega async (useScanResult) -- este effect dispara el
  // confeti UNA sola vez apenas el resultado real está disponible, sin
  // volver a hacerlo si la pantalla se re-renderiza por otro motivo
  // (scanId no cambia entre renders de la misma pantalla).
  const confettiTriggeredRef = React.useRef(false);
  useEffect(() => {
    if (!result || confettiTriggeredRef.current) return;
    confettiTriggeredRef.current = true;
    if (result.consumableEffectKey === 'confetti_boost') setShowConfetti(true);
  }, [result]);

  useEffect(() => {
    let cancelled = false;
    fetchMyEquipped().then((items) => {
      if (cancelled) return;
      setResultEffect(items.find((i) => i.slot === 'result_effect') ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Checkpoint "scan_completed" (A) -- acá, no en AnalyzingScreen: este es
  // el momento real en que el usuario YA VIO su resultado (recién
  // terminó de escanear, o está revisando un replay viejo -- ambos casos
  // son un mount real de esta pantalla con un `result` cargado, así que
  // llamarlo acá también cubre "volver a ver un replay" sin necesitar
  // distinguir los dos casos). Cada política central decide si corresponde
  // mostrar algo -- acá solo se pregunta, encadenado (instalar primero,
  // notificaciones solo si instalar NO mostró nada) para que como mucho
  // UN recordatorio compita por atención en este mismo checkpoint.
  useEffect(() => {
    if (!result) return;
    const showedInstall = requestInstallInvite('scan_completed');
    if (!showedInstall) requestNotificationInvite('scan_completed');
  }, [result]);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    markFirstResultSeen().then((isFirst) => {
      if (!cancelled && isFirst) setShowFirstResultHighlight(true);
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  async function handleShare() {
    if (!result) return;
    const outcome = await shareText(
      `Acabo de sacar ${formatSignedXP(result.auraScore)} AURA en AURA VS. Supéralo si puedes. 👀`,
    );
    if (outcome === 'copied') setShareNotice('Enlace copiado');
    else if (outcome === 'unavailable') setShareNotice('No pudimos compartir. Copia manualmente.');
    else setShareNotice(null);
  }

  // El bucket "scans" es privado -- no hay una URL fija que armar acá, hay
  // que mintear una signed URL con el JWT del dueño del video. Se pide en
  // cuanto tenemos el resultado, no recién al tocar play, para que la
  // reproducción arranque al toque sin un segundo salto de carga.
  useEffect(() => {
    setVideoUrl(null);
    setPlaying(false);
    setPlaybackError(null);

    if (!result?.videoPath) return;

    let cancelled = false;
    setVideoUrlLoading(true);
    getVideoPlaybackUrl(result.videoPath, scanId)
      .then((url) => {
        if (cancelled) return;
        setVideoUrl(url);
        if (!url) setPlaybackError('No se pudo cargar el video.');
      })
      .finally(() => {
        if (!cancelled) setVideoUrlLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.videoPath]);

  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        setPlaybackError('No se pudo reproducir el video.');
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  function handlePlayPress() {
    if (!result?.videoPath) {
      setPlaybackError('Este video ya no está disponible.');
      return;
    }
    if (!videoUrl) {
      // La signed URL sigue en camino (o falló) -- el botón ya está
      // deshabilitado por videoUrlLoading mientras tanto.
      return;
    }

    setPlaybackError(null);
    setPlaying(true);
    player.play();
  }

  if (loading || !result) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      {/* The shareable "poster" — everything a Story/TikTok export would need. */}
      <View style={styles.heroWrap}>
        {showConfetti && <ConfettiBurst onDone={() => setShowConfetti(false)} />}
        <Card style={StyleSheet.flatten([styles.heroCard, resultEffect && styles.heroCardWithEffect])}>
        {resultEffect && (
          <Text style={styles.resultEffectRow}>
            {resultEffect.assetRef} {resultEffect.assetRef} {resultEffect.assetRef}
          </Text>
        )}
        <Text style={styles.eyebrow}>AURA REPLAY</Text>
        <Badge label={result.verdictTag} tone="accent" style={styles.verdictBadge} />
        <Text style={styles.score}>{formatSignedXP(result.auraScore)} AURA</Text>
        <Text style={styles.verdict}>{result.verdictHeadline}</Text>

        {playing && videoUrl ? (
          <VideoView style={styles.videoBox} player={player} contentFit="cover" nativeControls />
        ) : (
          <Pressable
            onPress={handlePlayPress}
            style={styles.videoBox}
            disabled={videoUrlLoading}
            accessibilityRole="button"
            accessibilityLabel="Reproducir Aura Replay"
          >
            <AuraScanner progress={1} size={120}>
              {videoUrlLoading ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text style={styles.playGlyph}>▶</Text>
              )}
            </AuraScanner>
          </Pressable>
        )}

        {playbackError && <Text style={styles.playbackErrorText}>{playbackError}</Text>}

        <Text style={styles.disclaimer}>Puntuamos lo que hiciste, no cómo te ves.</Text>
        </Card>
      </View>

      {result.xpAwarded > 0 && (
        // Tappable a propósito -- parte del loop de retención (Scan ->
        // Resultado -> XP/progreso -> volver): en vez de un dato suelto,
        // es la siguiente acción natural para alguien que quiere ver
        // cuánto le falta para el próximo nivel.
        <Pressable onPress={() => navigation.navigate('MainTabs', { screen: 'Profile' })} hitSlop={6}>
          <Text style={styles.xpLine}>+{result.xpAwarded} XP a tu progreso · Ver perfil ›</Text>
        </Pressable>
      )}

      {/* Highlight de Coins/Wallet (bloque 12, onboarding) -- una sola vez
          por dispositivo, justo cuando ya tiene sentido: recién vio su
          primer resultado real. No es un modal ni un paso extra, es una
          card chica y descartable en el mismo flujo. */}
      {showFirstResultHighlight && (
        <Card style={styles.onboardingCard}>
          <Text style={styles.onboardingTitle}>🪙 Ya tienes Coins</Text>
          <Text style={styles.onboardingBody}>
            Arrancaste con 1.000 Coins. Se ganan más completando misiones diarias, rachas y referidos -- y se usan
            en la Tienda (nunca compran Aura ni XP).
          </Text>
          <View style={styles.onboardingActions}>
            <View style={styles.onboardingActionButton}>
              <PrimaryButton
                label="VER MI WALLET"
                variant="ghost"
                onPress={() => {
                  setShowFirstResultHighlight(false);
                  navigation.navigate('Wallet');
                }}
              />
            </View>
            <View style={styles.onboardingActionButton}>
              <PrimaryButton label="ENTENDIDO" variant="text" onPress={() => setShowFirstResultHighlight(false)} />
            </View>
          </View>
        </Card>
      )}

      <Text style={styles.sectionLabel}>DESGLOSE</Text>
      <Card style={styles.timelineCard}>
        {result.timeline.map((event, index) => (
          <React.Fragment key={event.time}>
            <TimelineRow {...event} />
            {index < result.timeline.length - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </Card>

      <View style={styles.statsGrid}>
        <StatMeter label="CONFIANZA" value={result.stats.confidence} />
        <StatMeter label="ESTILO" value={result.stats.style} />
        <StatMeter label="TIMING" value={result.stats.timing} />
        <StatMeter label="RIESGO CRINGE" value={result.stats.cringeRisk} tone="danger" />
      </View>

      {shareNotice && <Text style={styles.shareNotice}>{shareNotice}</Text>}

      {/* Orden de prioridad real (J, bloque pre-lanzamiento): compartir
          primero (el momento "wow" recién visto es el mejor gancho viral,
          y no depende de tener un amigo específico en mente todavía),
          desafiar segundo, Scan nuevo al final -- antes el orden era
          Desafiar/Compartir/Rescan, al revés de lo pedido. */}
      <View style={styles.actions}>
        <PrimaryButton label="COMPARTIR RESULTADO" onPress={handleShare} />
        <PrimaryButton
          label="DESAFIAR A UN AMIGO"
          variant="ghost"
          onPress={() => navigation.navigate('Challenge', { scanId: result.id })}
        />
        <PrimaryButton label="ESCANEAR DE NUEVO" variant="text" onPress={() => navigation.navigate('Upload')} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radius.lg,
  },
  heroCard: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderColor: colors.secondary,
    alignItems: 'center',
  },
  heroCardWithEffect: {
    borderColor: '#FFD700',
    borderWidth: 2,
  },
  resultEffectRow: {
    fontSize: 22,
    marginBottom: spacing.xs,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: spacing.sm,
  },
  verdictBadge: {
    alignSelf: 'center',
  },
  score: {
    ...typography.display,
    color: colors.accent,
    marginTop: spacing.md,
  },
  verdict: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  videoBox: {
    width: '100%',
    aspectRatio: 9 / 12,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    ...typography.title,
    color: colors.textPrimary,
    marginLeft: spacing.xs / 2,
  },
  playbackErrorText: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  xpLine: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  onboardingCard: {
    marginBottom: spacing.lg,
    borderColor: colors.accent,
  },
  onboardingTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  onboardingBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  onboardingActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  onboardingActionButton: {
    flex: 1,
  },
  shareNotice: {
    ...typography.caption,
    color: colors.success,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  timelineCard: {
    marginBottom: spacing.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
});
