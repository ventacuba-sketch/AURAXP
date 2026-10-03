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

function getAudioContext(): any | null {
  if (Platform.OS !== 'web') return null;
  const scope = globalThis as any;
  const AudioContextCtor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

async function unlockAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // Safari puede rechazar resume fuera de un gesto. El siguiente gesto
      // vuelve a intentarlo; nunca bloqueamos el chat por audio.
    }
  }
}

function playPattern(steps: ToneStep[]): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.72, ctx.currentTime);
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
    { frequency: 880, at: 0, duration: 0.095, gain: 0.055, type: 'sine' },
    { frequency: 1174.66, at: 0.055, duration: 0.12, gain: 0.045, type: 'triangle' },
  ]);
}

function playPrivateSound(): void {
  playPattern([
    { frequency: 523.25, at: 0, duration: 0.11, gain: 0.055, type: 'triangle' },
    { frequency: 783.99, at: 0.07, duration: 0.13, gain: 0.06, type: 'sine' },
    { frequency: 1046.5, at: 0.15, duration: 0.16, gain: 0.05, type: 'triangle' },
  ]);
}

export function ChatSoundHost({ currentRouteName, userId }: Props) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);
  const soundEnabledRef = useRef(true);
  const preferenceLoadedRef = useRef(false);

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
    const arm = () => void unlockAudio();
    scope.addEventListener?.('pointerdown', arm, { passive: true });
    scope.addEventListener?.('touchstart', arm, { passive: true });
    scope.addEventListener?.('keydown', arm);
    return () => {
      scope.removeEventListener?.('pointerdown', arm);
      scope.removeEventListener?.('touchstart', arm);
      scope.removeEventListener?.('keydown', arm);
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
      await unlockAudio();
      playRoomSound();
    }
  }

  if (!isChatRoute || !preferenceLoaded) return null;

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
    top: 58,
    right: spacing.sm,
    zIndex: 1000,
  },
  soundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(15, 15, 18, 0.92)',
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