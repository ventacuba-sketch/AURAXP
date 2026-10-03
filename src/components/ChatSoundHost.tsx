import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { supabase } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';

const SOUND_PREF_KEY = 'aura_chat_sound_enabled_v1';
const SOUND_PREF_EVENT = 'aura-chat-sound-preference';
const GLOBAL_SOUND_TOPIC = 'aura-chat-global-sound';

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

async function unlockAudio(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    try {
      await ctx.resume?.();
    } catch {
      return false;
    }
  }
  return ctx.state === 'running';
}

function playPattern(steps: ToneStep[]): void {
  const ctx = getAudioContext();
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

function playRoomSound(): void {
  playPattern([
    { frequency: 880, at: 0, duration: 0.105, gain: 0.18, type: 'sine' },
    { frequency: 1174.66, at: 0.06, duration: 0.14, gain: 0.15, type: 'triangle' },
  ]);
}

/**
 * Global chat sound host.
 *
 * Important: the visible chat already has its own Postgres Changes channel.
 * Opening a second Postgres Changes listener only for audio proved fragile on
 * mobile Safari. Global message sounds now arrive through a tiny database
 * Broadcast emitted by the chat_messages INSERT trigger. It is independent of
 * the message-render subscription and includes no message body/private text.
 */
export function ChatSoundHost({ currentRouteName }: Props) {
  const { width } = useWindowDimensions();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const soundEnabledRef = useRef(true);
  const preferenceLoadedRef = useRef(false);
  const audioPrimedRef = useRef(false);

  const isChatRoute = currentRouteName === 'Chat' || currentRouteName === 'ChatPrivateInbox' || currentRouteName === 'ChatPrivateConversation';
  const showControl = currentRouteName === 'Chat' && width < 800;

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
    if (Platform.OS !== 'web') return;
    const scope = globalThis as any;
    const onPreference = (event: any) => {
      const enabled = event?.detail?.enabled !== false;
      soundEnabledRef.current = enabled;
      preferenceLoadedRef.current = true;
      setSoundEnabled(enabled);
      setPreferenceLoaded(true);
    };
    scope.addEventListener?.(SOUND_PREF_EVENT, onPreference);
    return () => scope.removeEventListener?.(SOUND_PREF_EVENT, onPreference);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isChatRoute) return;
    const scope = globalThis as any;
    const documentRef = scope.document as any;

    const arm = () => {
      if (audioPrimedRef.current || !soundEnabledRef.current) return;
      void unlockAudio().then((ready) => {
        if (ready) audioPrimedRef.current = true;
      });
    };

    const recoverWhenVisible = () => {
      if (documentRef?.visibilityState !== 'visible') return;
      if (audioContext?.state !== 'running') audioPrimedRef.current = false;
    };

    documentRef?.addEventListener?.('click', arm, true);
    documentRef?.addEventListener?.('touchend', arm, true);
    documentRef?.addEventListener?.('visibilitychange', recoverWhenVisible);
    return () => {
      documentRef?.removeEventListener?.('click', arm, true);
      documentRef?.removeEventListener?.('touchend', arm, true);
      documentRef?.removeEventListener?.('visibilitychange', recoverWhenVisible);
    };
  }, [isChatRoute]);

  useEffect(() => {
    if (!supabase || currentRouteName !== 'Chat') return;

    const channel = supabase
      .channel(GLOBAL_SOUND_TOPIC)
      .on('broadcast', { event: 'message_created' }, () => {
        if (!preferenceLoadedRef.current || !soundEnabledRef.current) return;
        if (audioContext?.state !== 'running') return;
        playRoomSound();
      })
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [currentRouteName]);

  async function toggleSound() {
    const next = !soundEnabled;
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    await AsyncStorage.setItem(SOUND_PREF_KEY, next ? 'true' : 'false');

    if (Platform.OS === 'web') {
      const scope = globalThis as any;
      try {
        scope.dispatchEvent?.(new scope.CustomEvent(SOUND_PREF_EVENT, { detail: { enabled: next } }));
      } catch {
        // best effort only
      }
    }

    if (next) {
      audioPrimedRef.current = await unlockAudio();
      if (audioPrimedRef.current) playRoomSound();
    }
  }

  if (!showControl || !preferenceLoaded) return null;

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
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(15, 15, 18, 0.94)',
  },
  soundButtonPressed: {
    opacity: 0.72,
  },
  soundIcon: {
    ...typography.caption,
    fontSize: 14,
  },
});