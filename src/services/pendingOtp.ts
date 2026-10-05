import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'auravs_pending_signup_otp';

export type PendingSignupOtp = {
  email: string;
  intent: 'measure_aura' | null;
  createdAt: string;
};

export async function savePendingSignupOtp(email: string, intent: PendingSignupOtp['intent']): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ email: email.trim(), intent, createdAt: new Date().toISOString() }));
  } catch { /* best effort */ }
}

export async function getPendingSignupOtp(): Promise<PendingSignupOtp | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignupOtp;
    if (!parsed.email || !parsed.createdAt) return null;
    // Do not resurrect stale signup screens indefinitely.
    if (Date.now() - new Date(parsed.createdAt).getTime() > 24 * 60 * 60 * 1000) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

export async function clearPendingSignupOtp(): Promise<void> {
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
}
