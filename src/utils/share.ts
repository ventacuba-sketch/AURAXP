import { Share } from 'react-native';

/**
 * Thin wrapper around React Native's built-in `Share` API — used by the
 * "SHARE RESULT" and "SHARE CHALLENGE LINK" actions. No new dependency,
 * no backend: it just opens the native share sheet with placeholder copy.
 */
export async function shareText(message: string): Promise<void> {
  try {
    await Share.share({ message });
  } catch {
    // Sharing is best-effort placeholder polish — silently ignore a dismiss/failure.
  }
}
