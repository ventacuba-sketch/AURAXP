import { ConnectionState, LocalTrackPublication, Room, RoomEvent, Track } from 'livekit-client';

/**
 * AURA LIVE -- capa de video/audio en tiempo real (LiveKit, solo Web/PWA
 * para este MVP, ver sección 6 del pedido). Nombre de archivo
 * `liveMediaService.web.ts` a propósito -- Metro resuelve el sufijo
 * `.web` automáticamente en bundles web; una futura
 * `liveMediaService.native.ts` con la MISMA forma de API (connect/
 * disconnect/setMicEnabled/setCameraEnabled/switchCamera) podría
 * implementar la versión con development build + LiveKit React Native
 * sin tocar ningún caller (LiveRoomScreen/LiveCreateScreen).
 *
 * Por qué DOM imperativo y no JSX <video>: este proyecto es React
 * Native + react-native-web -- el namespace JSX de RN no declara
 * elementos DOM como <video>, así que los tracks se adjuntan a mano
 * (track.attach(videoElement)) sobre el nodo DOM real que expone un
 * `View` en web (`ref.current` es el `<div>` subyacente) en vez de JSX.
 * Esto mantiene toda la API de LiveKit encapsulada acá -- las pantallas
 * nunca importan `livekit-client` directo.
 */

export type LiveConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface ConnectLiveMediaOptions {
  livekitUrl: string;
  token: string;
  role: 'host' | 'viewer';
  /** Identidad LiveKit del host (`user:<hostUserId>`, mismo formato que
   * emite livekit-token) -- necesaria para que el viewer count EXCLUYA
   * siempre al host, sin importar si quien pregunta es el propio host
   * (donde remoteParticipants ya son solo viewers) o un viewer (donde
   * remoteParticipants incluye al host + otros viewers -- auditoría
   * GPT hallazgo #3: antes se usaba remoteParticipants.size crudo, que
   * daba números distintos según quién preguntara). */
  hostIdentity: string;
  /** Contenedor DOM real donde se monta el <video> principal -- para un
   * host, su propio preview local; para un viewer, el track remoto del
   * host (sección 4: un solo publisher, muchos subscribers). */
  videoContainer: HTMLElement;
  onConnectionStateChange?: (state: LiveConnectionState) => void;
  /** Conteo real de ESPECTADORES -- participantes remotos EXCLUYENDO al
   * host por identidad (nunca por posición/orden), así que da el mismo
   * número sin importar si quien pregunta es el host o un viewer
   * (sección 36: "no contar... host como viewer"). Única fuente de
   * verdad del viewer count en esta pantalla -- ver LiveRoomScreen. */
  onViewerCountChange?: (count: number) => void;
  onError?: (message: string) => void;
  /** AUDITORÍA GPT hallazgo #4: Safari/iOS bloquea el autoplay de medios
   * remotos con audio hasta que hay un gesto real del usuario. Se llama
   * cuando CUALQUIER track remoto (video o audio) falla al reproducirse
   * por esa política -- nunca se oculta el error ni se deja el audio
   * bloqueado en silencio. La UI (LiveRoomScreen) debe mostrar algo como
   * "🔊 Toca para activar el audio" y, al tocar, llamar a
   * `resumeAudio()` del controller (ESE tap es el gesto real que Safari
   * exige para reintentar `.play()`). */
  onAudioBlocked?: () => void;
}

export interface LiveMediaController {
  disconnect: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  /** Alterna frontal/trasera -- no-op silencioso si el dispositivo solo
   * tiene una cámara (p. ej. desktop). Solo tiene sentido para el host. */
  switchCamera: () => Promise<void>;
  getConnectionState: () => LiveConnectionState;
  /** Track de video/audio LOCAL activo, si existe -- los usa
   * liveAuraCapture.ts para CLONAR un MediaStreamTrack sin interrumpir la
   * publicación principal (sección 18: "nunca detener el track principal
   * para analizar"). */
  getLocalVideoTrack: () => MediaStreamTrack | null;
  getLocalAudioTrack: () => MediaStreamTrack | null;
  /** Reintenta `.play()` en TODOS los elementos remotos (video + audio)
   * dentro del gesto de click/tap real del usuario -- la única forma de
   * levantar el bloqueo de autoplay de Safari/iOS. Devuelve `true` si
   * todos los elementos quedaron reproduciéndose. */
  resumeAudio: () => Promise<boolean>;
}

function mapConnectionState(state: ConnectionState): LiveConnectionState {
  switch (state) {
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Reconnecting:
      return 'reconnecting';
    case ConnectionState.Disconnected:
      return 'disconnected';
    default:
      return 'failed';
  }
}

function attachPublicationVideo(pub: LocalTrackPublication | { track?: Track | null }, container: HTMLElement): HTMLVideoElement | null {
  const track = pub.track;
  if (!track || track.kind !== Track.Kind.Video) return null;
  const el = track.attach() as HTMLVideoElement;
  el.autoplay = true;
  el.playsInline = true;
  el.muted = true; // el audio local del host nunca se reproduce a sí mismo -- evita eco.
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'cover';
  container.innerHTML = '';
  container.appendChild(el);
  return el;
}

/**
 * Conecta a la sala -- host publica cámara+mic reales, viewer solo se
 * suscribe (el token del servidor, no este código, es lo que de verdad
 * impide publicar: canPublish=false para un viewer, ver livekit-token).
 * Reconexión: LiveKit maneja el reintento de transporte solo
 * (autoReconnect default) -- este wrapper solo traduce sus eventos de
 * estado a algo que la UI pueda mostrar ("Reconectando...", sección 26).
 */
export async function connectToLiveRoom(opts: ConnectLiveMediaOptions): Promise<LiveMediaController> {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  let currentState: LiveConnectionState = 'connecting';
  const setState = (s: LiveConnectionState) => {
    currentState = s;
    opts.onConnectionStateChange?.(s);
  };

  room.on(RoomEvent.ConnectionStateChanged, (state) => setState(mapConnectionState(state)));
  room.on(RoomEvent.Disconnected, () => setState('disconnected'));

  // Cuenta remoteParticipants EXCLUYENDO explícitamente al host por
  // identidad -- nunca por "el primero que entró" ni por posición. Si
  // quien pregunta es el propio host, esto es un no-op (su identidad
  // local nunca aparece en remoteParticipants); si quien pregunta es un
  // viewer, esto resta exactamente al host de su propia lista de
  // remotos. Mismo resultado desde cualquier dispositivo.
  const countViewers = (): number => {
    let count = 0;
    for (const p of room.remoteParticipants.values()) {
      if (p.identity !== opts.hostIdentity) count += 1;
    }
    return count;
  };
  const emitViewerCount = () => opts.onViewerCountChange?.(countViewers());
  room.on(RoomEvent.ParticipantConnected, emitViewerCount);
  room.on(RoomEvent.ParticipantDisconnected, emitViewerCount);

  // AUDITORÍA GPT hallazgo #4 -- se guarda una referencia real a CADA
  // elemento remoto adjuntado (video Y audio). Antes, el track de audio
  // remoto se adjuntaba con `track.attach()` y el elemento devuelto se
  // descartaba sin guardarlo ni montarlo en el DOM -- sin una referencia
  // viva ni estar en el árbol, nada garantiza que el navegador lo
  // mantenga reproduciendo. Ahora cada audio remoto se monta oculto en
  // `document.body` (necesita estar en el documento para que Safari lo
  // trate como una reproducción real), se reintenta `.play()` acá
  // mismo, y CUALQUIER elemento (video o audio) que falle por política
  // de autoplay dispara `onAudioBlocked` -- nunca se oculta el error ni
  // queda audio bloqueado en silencio.
  const remoteMediaElements = new Set<HTMLMediaElement>();

  function tryPlay(el: HTMLMediaElement): void {
    const playResult = el.play();
    if (!playResult || typeof playResult.then !== 'function') return;
    playResult.catch((e) => {
      // NotAllowedError (Safari/Chrome autoplay policy) es el caso
      // esperado -- cualquier OTRO error también se reporta, nunca se
      // traga en silencio (sección: "No ocultes errores").
      opts.onAudioBlocked?.();
      if (!(e instanceof DOMException) || e.name !== 'NotAllowedError') {
        opts.onError?.(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (opts.role === 'viewer') {
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        const el = track.attach() as HTMLVideoElement;
        el.autoplay = true;
        el.playsInline = true;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        opts.videoContainer.innerHTML = '';
        opts.videoContainer.appendChild(el);
        remoteMediaElements.add(el);
        tryPlay(el);
      } else {
        // Track de audio remoto (mic del host) -- elemento real montado
        // oculto en <body>, con referencia retenida en
        // `remoteMediaElements` para que resumeAudio() pueda
        // reintentarlo dentro de un gesto real del usuario.
        const el = track.attach() as HTMLAudioElement;
        el.autoplay = true;
        el.style.display = 'none';
        document.body.appendChild(el);
        remoteMediaElements.add(el);
        tryPlay(el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      // Limpieza real -- nunca dejar elementos huérfanos ni tracks
      // remotos colgando después de que LiveKit los desuscribe (host
      // apagó cámara/mic, o la sala terminó).
      for (const el of track.detach()) {
        remoteMediaElements.delete(el);
        el.pause();
        el.srcObject = null;
        el.remove();
      }
    });
  }

  try {
    await room.connect(opts.livekitUrl, opts.token);
  } catch (e) {
    setState('failed');
    opts.onError?.(e instanceof Error ? e.message : String(e));
    throw e;
  }

  if (opts.role === 'host') {
    try {
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      const videoPub = [...room.localParticipant.videoTrackPublications.values()][0];
      if (videoPub) attachPublicationVideo(videoPub, opts.videoContainer);
    } catch (e) {
      // Cámara/mic denegados -- nunca debe tumbar la conexión ya
      // establecida (sección 26: "Cámara denegada"/"Micrófono denegado"
      // son estados honestos, no errores fatales). El caller decide qué
      // mostrar según getLocalVideoTrack() devolviendo null.
      opts.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  emitViewerCount();
  setState('connected');

  async function disconnect(): Promise<void> {
    // Limpieza explícita de TODOS los tracks locales antes de
    // room.disconnect() -- sección 13/29: "detener TODOS los
    // MediaStreamTracks, liberar cámara, liberar micrófono... evitar que
    // LIVE deje la cámara bloqueada para Scan". room.disconnect() ya
    // debería hacer esto, pero se fuerza explícito acá para no depender
    // únicamente del comportamiento interno de la librería.
    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      pub.track?.stop();
    }
    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      pub.track?.stop();
    }
    await room.disconnect();
    // Red de seguridad -- TrackUnsubscribed ya debería haber limpiado
    // cada elemento remoto, pero si room.disconnect() no llegó a
    // dispararlo para alguno (p. ej. una desconexión abrupta), esto
    // garantiza que ningún <audio>/<video> remoto quede reproduciendo
    // de fondo ni montado en <body> después de salir del LIVE.
    for (const el of remoteMediaElements) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    remoteMediaElements.clear();
  }

  return {
    disconnect,
    resumeAudio: async () => {
      // Único lugar donde `.play()` se llama DENTRO del gesto real del
      // usuario (el tap en "🔊 Toca para activar el audio") -- es lo que
      // Safari/iOS exige para levantar el bloqueo de autoplay. Reintenta
      // TODOS los elementos remotos, no solo el de audio, por si el
      // video también quedó pausado por la misma política.
      let allOk = true;
      for (const el of remoteMediaElements) {
        try {
          await el.play();
        } catch (e) {
          allOk = false;
          opts.onError?.(e instanceof Error ? e.message : String(e));
        }
      }
      return allOk;
    },
    setMicEnabled: async (enabled) => {
      await room.localParticipant.setMicrophoneEnabled(enabled);
    },
    setCameraEnabled: async (enabled) => {
      await room.localParticipant.setCameraEnabled(enabled);
    },
    switchCamera: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        if (videoInputs.length < 2) return; // una sola cámara (desktop típico) -- no-op silencioso.
        const videoPub = [...room.localParticipant.videoTrackPublications.values()][0];
        const currentDeviceId = videoPub?.track?.mediaStreamTrack?.getSettings().deviceId;
        const next = videoInputs.find((d) => d.deviceId !== currentDeviceId) ?? videoInputs[0];
        await room.switchActiveDevice('videoinput', next.deviceId);
      } catch (e) {
        opts.onError?.(e instanceof Error ? e.message : String(e));
      }
    },
    getConnectionState: () => currentState,
    getLocalVideoTrack: () => {
      const pub = [...room.localParticipant.videoTrackPublications.values()][0];
      return pub?.track?.mediaStreamTrack ?? null;
    },
    getLocalAudioTrack: () => {
      const pub = [...room.localParticipant.audioTrackPublications.values()][0];
      return pub?.track?.mediaStreamTrack ?? null;
    },
  };
}
