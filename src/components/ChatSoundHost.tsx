import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getGuestId } from '../services/chatService';
import { supabase } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';

const SOUND_PREF_KEY = 'aura_chat_sound_enabled_v1';
const CHAT_ROUTES = new Set(['Chat', 'ChatPrivateInbox', 'ChatPrivateConversation']);

type ToneStep = {
  frequency: number;
  at: number;
  duration: number;
  gain: number;
  type: 'sine' | 'triangle';
};

type Props = {
  currentRouteName?: string;
  userId: string | null;
};

let audioContext: any = null;

function createAudioContext(): any | null {
  if (Platform.OS !== 'web') return null;
  const scope = globalThis as any;
  const AudioContextCtor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    return new AudioContextCtor();
  } catch {
    return null;
  }
}

function getAudioContext(): any | null {
  if (Platform.OS !== 'web') return null;
  if (!audioContext || audioContext.state === 'closed') audioContext = createAudioContext();
  return audioContext;
}

function resetAudioContext(): any | null {
  try {
    void audioContext?.close?.();
  } catch {
    // best effort only
  }
  audioContext = createAudioContext();
  return audioContext;
}

/**
 * iPhone/Safari can expose a non-standard `interrupted` AudioContext state.
 * Resume on a real click when possible; if the context is interrupted, replace
 * it instead of keeping a permanently silent instance.
 */
async function unlockAudio(): Promise<boolean> {
  let ctx = getAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'interrupted') ctx = resetAudioContext();
  if (!ctx) return false;

  if (ctx.state !== 'running') {
    try {
      await ctx.resume?.();
    } catch {
      // A later user click will retry.
    }
  }

  if (ctx.state === 'interrupted') {
    ctx = resetAudioContext();
    try {
      await ctx?.resume?.();
    } catch {
      return false;
    }
  }

  return ctx?.state === 'running';
}

function playPattern(steps: ToneStep[]): void {
  let ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'interrupted') ctx = resetAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.92, ctx.currentTime);
  master.connect(ctx.destination);

  for (const step of steps) {
    const start = ctx.currentTime + step.at;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = step.type;
    oscillator.frequency.setValueAtTime(step.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(step.gain, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step.duration);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + step.duration + 0.02);
  }
}

/**
 * Sonidos AURA originales, sintetizados en el dispositivo: no usan samples
 * de Messenger/Facebook ni archivos con copyright. La cadencia busca la
 * familiaridad de los mensajeros clásicos sin copiar ninguna notificación.
 */
function playRoomSound(): void {
  playPattern([
    { frequency: 880, at: 0, duration: 0.105, gain: 0.18, type: 'sine' },
    { frequency: 1174.66, at: 0.06, duration: 0.14, gain: 0.15, type: 'triangle' },
  ]);
}

function playPrivateSound(): void {
  playPattern([
    { frequency: 523.25, at: 0, duration: 0.12, gain: 0.17, type: 'triangle' },
    { frequency: 783.99, at: 0.075, duration: 0.15, gain: 0.19, type: 'sine' },
    { frequency: 1046.5, at: 0.16, duration: 0.18, gain: 0.16, type: 'triangle' },
  ]);
}

export function ChatSoundHost({ currentRouteName, userId }: Props) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);
  const soundEnabledRef = useRef(true);
  const preferenceLoadedRef = useRef(false);
  const audioPrimedRef = useRef(false);

  const isChatRoute = Boolean(currentRouteName && CHAT_ROUTES.has(currentRouteName));

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(SOUND_PREF_KEY).then((stored) => {
      if (!active) return;
      const enabled = stored !== 'false';
      soundEnabledRef.current = enabled;
      preferenceLoadedRef.current = true;
      setSoundEnabled(enabled);
      setPreferenceLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isChatRoute) return;
    const scope = globalThis as any;
    const documentRef = scope.document as any;

    // Safari/iOS is most reliable when AudioContext.resume() is called from a
    // genuine click/tap activation. Once primed, incoming Realtime events can
    // use the same context without another tap.
    const arm = () => {
      if (audioPrimedRef.current || !soundEnabledRef.current) return;
      void unlockAudio().then((ready) => {
        if (ready) audioPrimedRef.current = true;
      });
    };
    const recoverWhenVisible = () => {
      if (documentRef?.visibilityState !== 'visible') return;
      if (audioContext?.state === 'interrupted') {
        resetAudioContext();
        audioPrimedRef.current = false;
      }
    };

    documentRef?.addEventListener?.('click', arm, true);
    documentRef?.addEventListener?.('visibilitychange', recoverWhenVisible);
    return () => {
      documentRef?.removeEventListener?.('click', arm, true);
      documentRef?.removeEventListener?.('visibilitychange', recoverWhenVisible);
    };
  }, [isChatRoute]);

  useEffect(() => {
    if (!isChatRoute || userId) {
      setGuestId(null);
      return;
    }
    let active = true;
    void getGuestId().then((id) => {
      if (active) setGuestId(id);
    });
    return () => {
      active = false;
    };
  }, [isChatRoute, userId]);

  useEffect(() => {
    if (currentRouteName !== 'Chat' || !supabase) return;
    if (!userId && !guestId) return;

    const channel = supabase
      .channel(`chat-sound-room-${userId ?? guestId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const row = payload.new as { user_id?: string | null; guest_id?: string | null; hidden_at?: string | null };
          const isMine = userId ? row.user_id === userId : row.guest_id === guestId;
          if (row.hidden_at || isMine || !preferenceLoadedRef.current || !soundEnabledRef.current) return;
          playRoomSound();
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [currentRouteName, userId, guestId]);

  useEffect(() => {
    if (!isChatRoute || !userId || !supabase) return;

    const channel = supabase
      .channel(`chat-sound-private-${userId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_private_messages' },
        (payload) => {
          const row = payload.new as { sender_id?: string };
          if (row.sender_id === userId || !preferenceLoadedRef.current || !soundEnabledRef.current) return;
          playPrivateSound();
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [isChatRoute, userId]);

  async function toggleSound() {
    const next = !soundEnabled;
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    await AsyncStorage.setItem(SOUND_PREF_KEY, next ? 'true' : 'false');
    if (next) {
      audioPrimedRef.current = await unlockAudio();
      if (audioPrimedRef.current) playRoomSound();
    }
  }

  // The preference controls both Global and Privados, but the button lives in
  // Sala Global so it never floats over the private-chat headers/status UI.
  if (currentRouteName !== 'Chat' || !preferenceLoaded) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={soundEnabled ? 'Silenciar sonidos del chat' : 'Activar sonidos del chat'}
        onPress={() => void toggleSound()}
        style={({ pressed }) => [styles.soundButton, pressed && styles.soundButtonPressed]}
        hitSlop={8}
      >
        <Text style={styles.soundIcon}>{soundEnabled ? '🔊' : '🔇'}</Text>
        <Text style={styles.soundLabel}>{soundEnabled ? 'Sonido' : 'Silencio'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 8,
    right: spacing.sm,
    zIndex: 1000,
  },
  soundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(15, 15, 18, 0.94)',
  },
  soundButtonPressed: {
    opacity: 0.72,
  },
  soundIcon: {
    fontSize: 13,
  },
  soundLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});