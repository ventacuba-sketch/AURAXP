/**
 * AURA LIVE -- captura del clip de "⚡ Aura Check" (sección 18 del
 * pedido): clona el MediaStreamTrack LOCAL que LiveKit ya está
 * publicando (nunca el track principal en sí -- `track.clone()` crea un
 * segundo MediaStreamTrack independiente sobre la MISMA fuente de
 * cámara/mic, así que grabar el clon jamás interrumpe ni pausa la
 * transmisión real) y lo graba ~8s con MediaRecorder.
 *
 * Feature-detect explícito (sección 18: "Si el navegador no soporta el
 * método necesario: NO romper el LIVE. Simplemente deshabilitar Aura
 * Check con explicación legible") -- Safari/iOS tiene soporte más
 * limitado de MediaRecorder que Chrome, así que se prueba una lista de
 * mimeTypes en orden de preferencia antes de darse por vencido.
 */

const CANDIDATE_MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export function isAuraCheckCaptureSupported(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  return CANDIDATE_MIME_TYPES.some((t) => MediaRecorder.isTypeSupported(t));
}

function pickSupportedMimeType(): string | null {
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export interface CaptureResult {
  ok: boolean;
  blob?: Blob;
  mimeType?: string;
  errorCode?: 'unsupported' | 'no_video_track' | 'capture_failed';
}

const CAPTURE_DURATION_MS = 8000;

/**
 * `localVideoTrack`/`localAudioTrack` vienen de
 * liveMediaService.getLocalVideoTrack()/getLocalAudioTrack() -- esta
 * función nunca toca LiveKit directo, recibe los tracks ya resueltos.
 */
export async function captureAuraCheckClip(localVideoTrack: MediaStreamTrack | null, localAudioTrack: MediaStreamTrack | null): Promise<CaptureResult> {
  if (!isAuraCheckCaptureSupported()) return { ok: false, errorCode: 'unsupported' };
  if (!localVideoTrack) return { ok: false, errorCode: 'no_video_track' };

  const mimeType = pickSupportedMimeType();
  if (!mimeType) return { ok: false, errorCode: 'unsupported' };

  const tracks: MediaStreamTrack[] = [localVideoTrack.clone()];
  if (localAudioTrack) tracks.push(localAudioTrack.clone());
  const captureStream = new MediaStream(tracks);

  return new Promise((resolve) => {
    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(captureStream, { mimeType });
    } catch {
      tracks.forEach((t) => t.stop());
      resolve({ ok: false, errorCode: 'capture_failed' });
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      tracks.forEach((t) => t.stop()); // clones propios -- nunca el track principal.
      if (!chunks.length) {
        resolve({ ok: false, errorCode: 'capture_failed' });
        return;
      }
      resolve({ ok: true, blob: new Blob(chunks, { type: mimeType }), mimeType });
    };
    recorder.onerror = () => {
      tracks.forEach((t) => t.stop());
      resolve({ ok: false, errorCode: 'capture_failed' });
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, CAPTURE_DURATION_MS);
  });
}
