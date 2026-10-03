import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';

const SOUND_PREF_KEY = 'aura_chat_sound_enabled_v1';
const SOUND_PREF_EVENT = 'aura-chat-sound-preference';
const CHAT_SOUND_EVENT = 'aura-chat-sound';
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
  master.gain.setValueAtTime(0.95, ctx.currentTime);
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
    { frequency: 880, at: 0, duration: 0.105, gain: 0.2, type: 'sine' },
    { frequency: 1174.66, at: 0.06, duration: 0.14, gain: 0.17, type: 'triangle' },
  ]);
}

function playPrivateSound(): void {
  playPattern([
    { frequency: 659.25, at: 0, duration: 0.09, gain: 0.22, type: 'triangle' },
    { frequency: 987.77, at: 0.075, duration: 0.11, gain: 0.2, type: 'sine' },
    { frequency: 1318.51, at: 0.155, duration: 0.18, gain: 0.17, type: 'triangle' },
  ]);
}

export function ChatSoundHost({ currentRouteName }: Props) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const soundEnabledRef = useRef(true);
  const preferenceLoadedRef = useRef(false);
  const audioPrimedRef = useRef(false);

  const isChatRoute = currentRouteName === 'Chat' || currentRouteName === 'ChatPrivateInbox' || currentRouteName === 'ChatPrivateConversation';
  const showControl = isChatRoute;

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

  // Direct UI signal used by private chat and any local send path. This uses
  // the same already-unlocked AudioContext as the test button, so Safari does
  // not need a second audio mechanism.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isChatRoute) return;
    const scope = globalThis as any;
    const onChatSound = (event: any) => {
      if (!preferenceLoadedRef.current || !soundEnabledRef.current) return;
      if (audioContext?.state !== 'running') return;
      if (event?.detail?.kind === 'private') playPrivateSound();
      else playRoomSound();
    };
    scope.addEventListener?.(CHAT_SOUND_EVENT, onChatSound);
    return () => scope.removeEventListener?.(CHAT_SOUND_EVENT, onChatSound);
  }, [isChatRoute]);

  // Sala Global: database Broadcast is intentionally public because guests
  // can use the room. Explicit `private:false` is important: database and
  // client channel privacy must match or Realtime drops the event silently.
  useEffect(() => {
    if (!supabase || currentRouteName !== 'Chat') return;

    const channel = supabase
      .channel(GLOBAL_SOUND_TOPIC, { config: { private: false } })
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
    top: 58,
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