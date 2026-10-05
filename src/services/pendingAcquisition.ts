import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'auravs_pending_first_scan';

export async function setPendingFirstScan(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best-effort: auth must never fail because local telemetry/state failed.
  }
}

export async function consumePendingFirstScan(): Promise<boolean> {
  try {
    const pending = await AsyncStorage.getItem(STORAGE_KEY);
    if (pending) await AsyncStorage.removeItem(STORAGE_KEY);
    return pending === '1';
  } catch {
    return false;
  }
}
