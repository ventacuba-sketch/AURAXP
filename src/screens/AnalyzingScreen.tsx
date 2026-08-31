import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { AuraScanner } from '../components/AuraScanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { SCAN_DURATION_MS, submitScan } from '../services/api';
import { logScanMilestone } from '../services/analyticsService';
import { markValueSignal } from '../services/installService';
import { checkScanStatus, ScanStatusCheck, subscribeToScan } from '../services/scanService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

// Matches the stat names on the Result screen (TIMING stays — it already
// reads naturally in Spanish; the rest use the same short label ScanResult uses).
const LABELS = ['TIMING', 'CONFIANZA', 'ESTILO', 'RIESGO CRINGE'];
const LABEL_INTERVAL_MS = 380;
const PROGRESS_STEP_MS = 40;

// El backend real no reporta progreso — animamos hacia un techo visual
// mientras hacemos polling, y recién saltamos a 100% cuando el status
// real llega a 'done'. Evita una barra que miente sobre el tiempo real.
//
// Curva desacelerada (no lineal): progress = CAP * (1 - e^(-t/TAU)) --
// rápido al principio, cada vez más lento después, asintótica hacia CAP
// sin tocarlo nunca mientras no llegue 'done'. Con TAU=22s: ~18% a los
// 5s, ~54% a los 20s, ~84% a los 60s, ~89% a los 120s -- consume gran
// parte de la espera real en vez de plancharse en el 90% a los pocos
// segundos como hacía la curva lineal anterior (6s a tope).
const REAL_PROGRESS_CAP = 0.9;
const REAL_PROGRESS_TAU_MS = 22000;
// Pasado este tiempo sin 'done', la curva sigue viva (sigue siendo
// asintótica, nunca se congela del todo) pero además se muestra el
// mensaje de "casi listo" para que quede claro que seguimos esperando al
// backend, no que la pantalla se colgó.
const ALMOST_READY_THRESHOLD_MS = 60000;
// Animación corta y rápida de "terminar": del progreso actual a 100% en
// este tiempo, recién ahí se navega -- reemplaza el salto instantáneo a
// 100% que había antes.
const FINISH_ANIMATION_MS = 500;
const POLL_INTERVAL_MS = 2500;

// Distingue un blip transitorio (Wi-Fi flaqueando un instante) de una falla
// real y sostenida (sesión inválida, red caída, etc.): recién después de
// varios fallos *reales* consecutivos (no "todavía pendiente" -- eso no
// cuenta como fallo) se corta el polling y se muestra un error accionable,
// en vez de quedar reintentando en silencio para siempre.
const MAX_CONSECUTIVE_ERRORS = 5;

type AnalyzingRoute = RouteProp<RootStackParamList, 'Analyzing'>;

export default function AnalyzingScreen() {
  const navigation = useRootNavigation();
  const { params } = useRoute<AnalyzingRoute>();
  const scanId = params?.scanId;
  const challengeToken = params?.challengeToken;
  const useRealBackend = Boolean(scanId && isSupabaseConfigured);

  const [labelIndex, setLabelIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [almostReady, setAlmostReady] = useState(false);
  const [failure, setFailure] = useState<{ message: string; showProCta: boolean } | null>(null);
  // Guard contra navegación duplicada: polling y Realtime pueden detectar
  // `done` casi al mismo tiempo -- solo la primera fuente que llega navega.
  const hasNavigatedRef = useRef(false);
  // Espejo de `progress` legible desde closures que no lo tienen como
  // dependencia (el efecto de polling, más abajo) -- para poder animar la
  // recta final desde el valor real en pantalla, no desde 0.
  const progressRef = useRef(0);
  // Corta la curva desacelerada apenas arranca la animación final de
  // cierre, para que no sigan compitiendo por escribir `progress` a la vez.
  const finishingRef = useRef(false);

  // Anima el AuraScanner — mock: 0->1 lineal en SCAN_DURATION_MS (clip
  // corto, tiempo conocido de antemano, no hace falta desacelerar).
  // Real: curva desacelerada hacia el techo visual (ver constantes arriba)
  // mientras hacemos polling -- la animación de cierre a 100% la maneja
  // por separado finishSuccess() más abajo, apenas confirmamos 'done'.
  useEffect(() => {
    const start = Date.now();

    if (!useRealBackend) {
      const interval = setInterval(() => {
        const next = Math.min(1, (Date.now() - start) / SCAN_DURATION_MS);
        progressRef.current = next;
        setProgress(next);
      }, PROGRESS_STEP_MS);
      return () => clearInterval(interval);
    }

    const interval = setInterval(() => {
      if (finishingRef.current) return;
      const elapsed = Date.now() - start;
      const next = REAL_PROGRESS_CAP * (1 - Math.exp(-elapsed / REAL_PROGRESS_TAU_MS));
      progressRef.current = next;
      setProgress(next);
      if (elapsed > ALMOST_READY_THRESHOLD_MS) setAlmostReady(true);
    }, PROGRESS_STEP_MS);
    return () => clearInterval(interval);
  }, [useRealBackend]);

  // Cycle through the label chips while the scan is being processed.
  useEffect(() => {
    const interval = setInterval(() => {
      setLabelIndex((i) => (i + 1) % LABELS.length);
    }, LABEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Mock fallback — sin scanId real ni backend configurado.
  useEffect(() => {
    if (useRealBackend) return;
    let cancelled = false;
    submitScan(null).then(() => {
      if (!cancelled) navigation.replace('ScanResult', undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [useRealBackend, navigation]);

  // Detección robusta de `done`, con tres capas independientes:
  // 1. fetch inmediato al montar (no esperar el primer tick del interval);
  // 2. polling de respaldo cada POLL_INTERVAL_MS -- la fuente de verdad
  //    real, funciona siempre, con o sin Realtime habilitado;
  // 3. Realtime como aceleración opcional -- si `scans` no está en la
  //    publicación supabase_realtime, el canal simplemente no dispara
  //    nunca y el polling sigue cubriendo todo el flujo solo.
  // Cualquiera de las tres que detecte `done` navega; un guard evita que
  // dos fuentes disparen la navegación dos veces.
  useEffect(() => {
    if (!useRealBackend || !scanId) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let finishInterval: ReturnType<typeof setInterval> | undefined;

    const finishSuccess = () => {
      if (hasNavigatedRef.current || cancelled) return;
      hasNavigatedRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
      unsubscribeRealtime();
      logScanMilestone();
      markValueSignal(); // R5: señal de valor real -- completó un Scan

      // Anima rápido desde el progreso real actual (no desde 0, no un
      // salto instantáneo) hasta 100%, y recién ahí navega -- la curva
      // desacelerada de arriba deja de escribir `progress` gracias a
      // finishingRef, así que esta animación no compite con ella.
      finishingRef.current = true;
      const finishStart = Date.now();
      const finishFrom = progressRef.current;
      finishInterval = setInterval(() => {
        if (cancelled) {
          if (finishInterval) clearInterval(finishInterval);
          return;
        }
        const t = Math.min(1, (Date.now() - finishStart) / FINISH_ANIMATION_MS);
        const next = finishFrom + (1 - finishFrom) * t;
        progressRef.current = next;
        setProgress(next);

        if (t >= 1) {
          if (finishInterval) clearInterval(finishInterval);
          // Este scan era el del oponente de un Challenge -- process-scan ya
          // resolvió el duelo server-side en el mismo request que lo marcó
          // 'done' (ver _shared/challengeResolution.ts). Ir directo al
          // versus en vez de al Aura Replay individual.
          if (challengeToken) {
            navigation.replace('Challenge', { challengeToken });
          } else {
            navigation.replace('ScanResult', { scanId });
          }
        }
      }, PROGRESS_STEP_MS);
    };

    // Cada causa de falla tiene su propio texto -- nunca un mensaje
    // genérico que mezcle "moderación o límite diario" como antes, que
    // dejaba al usuario sin saber cuál de las dos pasó en realidad.
    // errorCode se revisa primero (son señales inequívocas del backend);
    // moderationFlagged solo importa para un 'rejected' sin uno de esos
    // códigos puntuales.
    const finishFailure = (reason: 'failed' | 'rejected', errorCode?: string | null, moderationFlagged?: boolean) => {
      if (hasNavigatedRef.current || cancelled) return;
      hasNavigatedRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
      unsubscribeRealtime();

      let message: string;
      // Solo el tope FREE (comercial, "sube a PRO y seguí") ofrece el CTA --
      // el tope de fair-use de un PRO ('fair_use_limit') es un caso de
      // excepción/protección de servicio, nunca se le vende PRO a alguien
      // que ya es PRO, y el mensaje no revela ningún número (ver
      // _shared/dailyLimit.ts).
      let showProCta = false;
      if (errorCode === 'service_paused') {
        // Kill switch de costo (ver migración system_status) -- solo pasa
        // esto si alguien activó 'emergency' a mano en el Dashboard; en
        // uso normal ('normal', el default) este código nunca aparece.
        message = 'Los análisis están pausados temporalmente. Intenta de nuevo más tarde.';
      } else if (errorCode === 'gemini_unavailable') {
        message = 'La IA está temporalmente ocupada. Intenta de nuevo en unos minutos.';
      } else if (errorCode === 'daily_upload_limit') {
        message = 'Alcanzaste tus Scans gratuitos de hoy. Vuelve mañana o pasa a PRO para seguir ahora.';
        showProCta = true;
      } else if (errorCode === 'fair_use_limit') {
        message = 'Estamos protegiendo el servicio por actividad inusual en tu cuenta. Intenta de nuevo más tarde.';
      } else if (reason === 'rejected' && moderationFlagged) {
        message = 'Este video no cumple con nuestras normas de contenido. Prueba con otro.';
      } else if (reason === 'rejected') {
        message = 'Este video no se pudo procesar. Intenta de nuevo.';
      } else {
        message = 'El análisis falló. Intenta de nuevo.';
      }
      setFailure({ message, showProCta });
    };

    const handleResult = (result: ScanStatusCheck) => {
      if (cancelled || hasNavigatedRef.current) return;

      switch (result.kind) {
        case 'pending':
          consecutiveErrors = 0;
          return;
        case 'done':
          finishSuccess();
          return;
        case 'failed':
        case 'rejected':
          finishFailure(result.kind, result.scan.error_message, result.scan.moderation_flagged);
          return;
        case 'error':
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            if (pollTimer) clearInterval(pollTimer);
            unsubscribeRealtime();
            setFailure({ message: 'No pudimos confirmar el resultado. Revisa tu conexión e intenta de nuevo.', showProCta: false });
          }
          return;
      }
    };

    // Capa 3: Realtime, solo acelera -- una fila que llega por acá se trata
    // igual que una detectada por polling, sin pasar por el contador de
    // errores (es una señal push, no una verificación que pueda fallar).
    const unsubscribeRealtime = subscribeToScan(scanId, (scan) => {
      if (scan.status === 'done') finishSuccess();
      else if (scan.status === 'failed') finishFailure('failed', scan.error_message);
      else if (scan.status === 'rejected') finishFailure('rejected', scan.error_message, scan.moderation_flagged);
    });

    const poll = () => {
      checkScanStatus(scanId).then(handleResult);
    };

    poll(); // Capa 1: fetch inmediato al montar, no esperar el primer tick.
    pollTimer = setInterval(poll, POLL_INTERVAL_MS); // Capa 2: respaldo.

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (finishInterval) clearInterval(finishInterval);
      unsubscribeRealtime();
    };
  }, [useRealBackend, scanId, challengeToken, navigation]);

  if (failure) {
    return (
      <ScreenContainer style={styles.center}>
        <Text style={styles.errorText}>{failure.message}</Text>
        {failure.showProCta && (
          <PrimaryButton label="PASAR A PRO" onPress={() => navigation.navigate('Pro')} />
        )}
        <PrimaryButton
          label="VOLVER"
          variant={failure.showProCta ? 'ghost' : 'primary'}
          onPress={() => navigation.navigate('Upload')}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.center}>
      <AuraScanner progress={progress} active size={176}>
        <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
      </AuraScanner>
      <Text style={styles.title}>LEYENDO TU AURA...</Text>
      {almostReady && (
        <Text style={styles.almostReady}>Casi listo… la IA está terminando el análisis</Text>
      )}
      <View style={styles.labelRow}>
        {LABELS.map((label, index) => (
          <View
            key={label}
            style={[styles.labelChip, index === labelIndex && styles.labelChipActive]}
          >
            <Text style={[styles.labelText, index === labelIndex && styles.labelTextActive]}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    ...typography.title,
    color: colors.textPrimary,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    letterSpacing: 1,
  },
  almostReady: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  labelChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  labelChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  labelText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  labelTextActive: {
    color: colors.accent,
  },
  errorText: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});
