import * as Crypto from 'expo-crypto';

const SAMPLE_BYTES = 65536;

/**
 * Lee un Blob como base64 usando FileReader — es la única API de lectura de
 * bytes que se comporta igual en web y en React Native (ambos implementan
 * el mismo FileReader estándar). No usamos expo-file-system acá: sus
 * funciones "de ruta" (getInfoAsync, readAsStringAsync, ...) no aplican a
 * URIs blob:/data: como las que entrega expo-image-picker, y además la
 * versión instalada las hace lanzar en runtime a propósito (ver
 * expo-file-system/src/legacyWarnings.ts) para forzar la migración a la
 * nueva API basada en clases File/Directory, que tampoco está soportada en
 * web (expo-file-system/src/ExpoFileSystem.web.ts es un stub).
 */
function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el video'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No se pudo leer el video'));
        return;
      }
      // readAsDataURL da "data:<mime>;base64,<datos>" — nos quedamos solo
      // con la parte de datos.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Fingerprint liviano (aprobado para MVP) — NO es un SHA-256 del archivo
 * completo. Combina tamaño + duración + un hash de los primeros bytes.
 * Alcanza para el objetivo real: detectar que alguien resubió literalmente
 * el mismo clip para farmear XP. No es para integridad forense.
 *
 * Recibe el Blob ya leído (en vez de un uri) para poder compartir un único
 * fetch del video con el resto de uploadAndSubmitScan.
 */
export async function computeVideoFingerprint(blob: Blob, durationMs: number): Promise<string> {
  const sample = blob.slice(0, SAMPLE_BYTES);
  const sampleBase64 = await readBlobAsBase64(sample);

  const raw = `${blob.size}:${durationMs}:${sampleBase64}`;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
}
