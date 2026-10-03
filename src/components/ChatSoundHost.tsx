import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';

const SOUND_PREF_KEY = 'aura_chat_sound_enabled_v1';
const SOUND_EVENT = 'aura-chat-incoming-sound';
const SOUND_PREF_EVENT = 'aura-chat-sound-preference';

type ChatSoundKind = 'room' | 'private';

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

type SoundButtonProps = {
  compact?: boolean;
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

function playPrivateSound(): void {
  playPattern([
    { frequency: 523.25, at: 0, duration: 0.12, gain: 0.17, type: 'triangle' },
    { frequency: 783.99, at: 0.075, duration: 0.15, gain: 0.19, type: 'sine' },
    { frequency: 1046.5, at: 0.16, duration: 0.18, gain: 0.16, type: 'triangle' },
  ]);
}

/**
 * The screen that already received the Realtime message emits this event.
 * This deliberately avoids opening a second Postgres Changes subscription
 * only for audio: if the message is visible in the UI, the sound receives
 * the exact same delivery path.
 */
export function notifyIncomingChatSound(kind: ChatSoundKind): void {
  if (Platform.OS !== 'web') return;
  const scope = globalThis as any;
  try {
    scope.dispatchEvent?.(new scope.CustomEvent(SOUND_EVENT, { detail: { kind } }));
  } catch {
    // Sound is progressive enhancement; chat delivery must never depend on it.
  }
}

/**
 * Global audio engine. It owns the browser AudioContext but no longer draws a
 * floating control over the app. The actual control lives inside ChatScreen's
 * header so desktop/mobile layout cannot be covered by an absolute overlay.
 */
export function ChatSoundHost({ currentRouteName }: Props) {
  const soundEnabledRef = useRef(true);
  const preferenceLoadedRef = useRef(false);
  const audioPrimedRef = useRef(false);
  const isChatRoute = currentRouteName === 'Chat' || currentRouteName === 'ChatPrivateInbox' || currentRouteName === 'ChatPrivateConversation';

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(SOUND_PREF_KEY).then((stored) => {
      if (!active) return;
      soundEnabledRef.current = stored !== 'false';
      preferenceLoadedRef.current = true;
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const scope = globalThis as any;
    const onPreference = (event: any) => {
      soundEnabledRef.current = event?.detail?.enabled !== false;
      preferenceLoadedRef.current = true;
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

    // iOS Safari can interrupt audio after backgrounding. Do not create a new
    // suspended context here; mark it unprimed and let the next real tap resume
    // the existing context, which preserves autoplay permission reliably.
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
    if (Platform.OS !== 'web') return;
    const scope = globalThis as any;
    const onIncoming = (event: any) => {
      if (!isChatRoute || !preferenceLoadedRef.current || !soundEnabledRef.current) return;
      const kind: ChatSoundKind = event?.detail?.kind === 'private' ? 'private' : 'room';
      if (audioContext?.state !== 'running') return;
      if (kind === 'private') playPrivateSound();
      else playRoomSound();
    };
    scope.addEventListener?.(SOUND_EVENT, onIncoming);
    return () => scope.removeEventListener?.(SOUND_EVENT, onIncoming);
  }, [isChatRoute]);

  return null;
}

export function ChatSoundButton({ compact = false }: SoundButtonProps) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(SOUND_PREF_KEY).then((stored) => {
      if (!active) return;
      setSoundEnabled(stored !== 'false');
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  async function toggleSound() {
    const next = !soundEnabled;
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
      const ready = await unlockAudio();
      if (ready) playRoomSound();
    }
  }

  if (!loaded) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={soundEnabled ? 'Silenciar sonidos del chat' : 'Activar sonidos del chat'}
      onPress={() => void toggleSound()}
      style={({ pressed }) => [styles.soundButton, compact && styles.soundButtonCompact, pressed && styles.soundButtonPressed]}
      hitSlop={8}
    >
      <Text style={styles.soundIcon}>{soundEnabled ? '🔊' : '🔇'}</Text>
      {!compact && <Text style={styles.soundLabel}>{soundEnabled ? 'Sonido' : 'Silencio'}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  soundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  soundButtonCompact: {
    width: 32,
    height: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
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