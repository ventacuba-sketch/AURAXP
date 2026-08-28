import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AuraScanner } from '../components/AuraScanner';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatMeter } from '../components/StatMeter';
import { TimelineRow } from '../components/TimelineRow';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useScanResult } from '../hooks/useScanResult';
import { getVideoPlaybackUrl } from '../services/scanService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';
import { formatSignedXP } from '../utils/format';
import { shareText } from '../utils/share';

type ScanResultRoute = RouteProp<RootStackParamList, 'ScanResult'>;

/**
 * Logging TEMPORAL para diagnosticar AURA REPLAY (ver conversación) --
 * mismo formato que el resto del pipeline, para cruzar por scanId. Sacar
 * una vez confirmado el fix.
 */
function log(scanId: string, step: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ src: 'ScanResultScreen', scanId, step, t: Date.now(), ...data }));
}

export default function ScanResultScreen() {
  const { params } = useRoute<ScanResultRoute>();
  const { result, loading } = useScanResult(params?.scanId);
  const navigation = useRootNavigation();

  const scanId = result?.id ?? params?.scanId ?? 'unknown';

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoUrlLoading, setVideoUrlLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // El bucket "scans" es privado -- no hay una URL fija que armar acá, hay
  // que mintear una signed URL con el JWT del dueño del video. Se pide en
  // cuanto tenemos el resultado, no recién al tocar play, para que la
  // reproducción arranque al toque sin un segundo salto de carga.
  useEffect(() => {
    setVideoUrl(null);
    setPlaying(false);
    setPlaybackError(null);

    log(scanId, 'video:source', { videoPath: result?.videoPath ?? null });
    if (!result?.videoPath) return;

    let cancelled = false;
    setVideoUrlLoading(true);
    getVideoPlaybackUrl(result.videoPath, scanId)
      .then((url) => {
        if (cancelled) return;
        log(scanId, 'video:url_resolved', { hasUrl: Boolean(url) });
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
      log(scanId, 'player:statusChange', { status, error: error ? String(error) : undefined });
      if (status === 'error') {
        setPlaybackError('No se pudo reproducir el video.');
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  function handlePlayPress() {
    log(scanId, 'play:pressed', { videoPath: result?.videoPath ?? null, videoUrl });

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
      <ScreenContainer style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      {/* The shareable "poster" — everything a Story/TikTok export would need. */}
      <Card style={styles.heroCard}>
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

      {result.xpAwarded > 0 && (
        <Text style={styles.xpLine}>+{result.xpAwarded} XP a tu progreso</Text>
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

      <View style={styles.actions}>
        <PrimaryButton
          label="DESAFIAR A UN AMIGO"
          onPress={() => navigation.navigate('Challenge', { scanId: result.id })}
        />
        <PrimaryButton
          label="COMPARTIR RESULTADO"
          variant="ghost"
          onPress={() =>
            shareText(`Acabo de sacar ${formatSignedXP(result.auraScore)} AURA en AURAXP. Supéralo si puedes. 👀`)
          }
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
  heroCard: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderColor: colors.secondary,
    alignItems: 'center',
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
