import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';

/**
 * Fingerprint liviano (aprobado para MVP) — NO es un SHA-256 del archivo
 * completo. Combina tamaño + duración + un hash de los primeros bytes.
 * Alcanza para el objetivo real: detectar que alguien resubió literalmente
 * el mismo clip para farmear XP. No es para integridad forense.
 */
export async function computeVideoFingerprint(uri: string, durationMs: number): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists ? (info.size ?? 0) : 0;

  const sampleBase64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    length: 65536,
    position: 0,
  });

  const raw = `${size}:${durationMs}:${sampleBase64.slice(0, 4096)}`;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
}
