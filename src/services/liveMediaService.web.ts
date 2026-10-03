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
  /** Contenedor DOM real donde se monta el <video> principal -- para un
   * host, su propio preview local; para un viewer, el track remoto del
   * host (sección 4: un solo publisher, muchos subscribers). */
  videoContainer: HTMLElement;
  onConnectionStateChange?: (state: LiveConnectionState) => void;
  /** Conteo real de PARTICIPANTES REMOTOS -- nunca incluye al propio
   * participante local, así que funciona como "espectadores" sin
   * importar si quien pregunta es el host o un viewer (sección 36: "no
   * contar... host como viewer"). Única fuente de verdad del viewer
   * count en esta pantalla -- ver LiveRoomScreen. */
  onViewerCountChange?: (count: number) => void;
  onError?: (message: string) => void;
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

  const emitViewerCount = () => opts.onViewerCountChange?.(room.remoteParticipants.size);
  room.on(RoomEvent.ParticipantConnected, emitViewerCount);
  room.on(RoomEvent.ParticipantDisconnected, emitViewerCount);

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
      } else {
        track.attach();
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
  }

  return {
    disconnect,
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
