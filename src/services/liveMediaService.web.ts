import { ConnectionState, LocalTrackPublication, Room, RoomEvent, Track } from 'livekit-client';

export type LiveConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface ConnectLiveMediaOptions {
  livekitUrl: string;
  token: string;
  role: 'host' | 'viewer';
  hostIdentity: string;
  videoContainer: HTMLElement;
  onConnectionStateChange?: (state: LiveConnectionState) => void;
  onViewerCountChange?: (count: number) => void;
  onError?: (message: string) => void;
  onAudioBlocked?: () => void;
}

export interface LiveMediaController {
  disconnect: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  switchCamera: () => Promise<void>;
  getConnectionState: () => LiveConnectionState;
  getLocalVideoTrack: () => MediaStreamTrack | null;
  getLocalAudioTrack: () => MediaStreamTrack | null;
  resumeAudio: () => Promise<boolean>;
}

function mapConnectionState(state: ConnectionState): LiveConnectionState {
  switch (state) {
    case ConnectionState.Connecting: return 'connecting';
    case ConnectionState.Connected: return 'connected';
    case ConnectionState.Reconnecting: return 'reconnecting';
    case ConnectionState.Disconnected: return 'disconnected';
    default: return 'failed';
  }
}

function isBenignMediaAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /operation was aborted|play\(\) request was interrupted/i.test(message);
}

function attachPublicationVideo(pub: LocalTrackPublication | { track?: Track | null }, container: HTMLElement): HTMLVideoElement | null {
  const track = pub.track;
  if (!track || track.kind !== Track.Kind.Video) return null;
  const el = track.attach() as HTMLVideoElement;
  el.autoplay = true;
  el.playsInline = true;
  el.muted = true;
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'cover';
  container.innerHTML = '';
  container.appendChild(el);
  return el;
}

async function preferRearCamera(room: Room): Promise<void> {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (devices.length < 2) return;
    const current = [...room.localParticipant.videoTrackPublications.values()][0]?.track?.mediaStreamTrack?.getSettings().deviceId;
    const rear = devices.find((d) => /back|rear|environment|trasera|posterior/i.test(d.label));
    const candidate = rear ?? devices.find((d) => d.deviceId !== current);
    if (candidate && candidate.deviceId !== current) await room.switchActiveDevice('videoinput', candidate.deviceId);
  } catch {
    // Some browsers hide labels until permission is granted. Keep the active camera rather than failing the LIVE.
  }
}

export async function connectToLiveRoom(opts: ConnectLiveMediaOptions): Promise<LiveMediaController> {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  let currentState: LiveConnectionState = 'connecting';
  const setState = (s: LiveConnectionState) => { currentState = s; opts.onConnectionStateChange?.(s); };

  room.on(RoomEvent.ConnectionStateChanged, (state) => setState(mapConnectionState(state)));
  room.on(RoomEvent.Disconnected, () => setState('disconnected'));

  const countViewers = () => {
    let count = 0;
    for (const p of room.remoteParticipants.values()) if (p.identity !== opts.hostIdentity) count += 1;
    return count;
  };
  const emitViewerCount = () => opts.onViewerCountChange?.(countViewers());
  room.on(RoomEvent.ParticipantConnected, emitViewerCount);
  room.on(RoomEvent.ParticipantDisconnected, emitViewerCount);

  const remoteMediaElements = new Set<HTMLMediaElement>();
  function tryPlay(el: HTMLMediaElement) {
    const result = el.play();
    if (result && typeof result.then === 'function') result.catch((e) => {
      // Safari/iOS can reject an obsolete play() promise with AbortError when
      // LiveKit replaces/detaches a media source during normal track setup.
      // The replacement track keeps playing, so this is lifecycle noise, not
      // a user-facing LIVE failure.
      if (isBenignMediaAbort(e)) return;
      opts.onAudioBlocked?.();
      if (!(e instanceof DOMException) || e.name !== 'NotAllowedError') opts.onError?.(e instanceof Error ? e.message : String(e));
    });
  }

  if (opts.role === 'viewer') {
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        const el = track.attach() as HTMLVideoElement;
        el.autoplay = true; el.playsInline = true;
        el.style.width = '100%'; el.style.height = '100%'; el.style.objectFit = 'cover';
        opts.videoContainer.innerHTML = '';
        opts.videoContainer.appendChild(el);
        remoteMediaElements.add(el);
        tryPlay(el);
      } else {
        const el = track.attach() as HTMLAudioElement;
        el.autoplay = true; el.style.display = 'none';
        document.body.appendChild(el);
        remoteMediaElements.add(el);
        tryPlay(el);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      for (const el of track.detach()) {
        remoteMediaElements.delete(el);
        el.pause(); el.srcObject = null; el.remove();
      }
    });
  }

  try {
    await room.prepareConnection(opts.livekitUrl, opts.token);
    await room.connect(opts.livekitUrl, opts.token, { websocketTimeout: 20000 });
  } catch (e) {
    setState('failed'); opts.onError?.(e instanceof Error ? e.message : String(e)); throw e;
  }

  if (opts.role === 'host') {
    try {
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      await preferRearCamera(room);
      const videoPub = [...room.localParticipant.videoTrackPublications.values()][0];
      if (videoPub) attachPublicationVideo(videoPub, opts.videoContainer);
    } catch (e) {
      if (!isBenignMediaAbort(e)) opts.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  emitViewerCount(); setState('connected');

  async function disconnect() {
    for (const pub of room.localParticipant.videoTrackPublications.values()) pub.track?.stop();
    for (const pub of room.localParticipant.audioTrackPublications.values()) pub.track?.stop();
    await room.disconnect();
    for (const el of remoteMediaElements) { el.pause(); el.srcObject = null; el.remove(); }
    remoteMediaElements.clear();
  }

  return {
    disconnect,
    resumeAudio: async () => {
      let allOk = true;
      for (const el of remoteMediaElements) {
        try { await el.play(); }
        catch (e) {
          if (isBenignMediaAbort(e)) continue;
          allOk = false;
          opts.onError?.(e instanceof Error ? e.message : String(e));
        }
      }
      return allOk;
    },
    setMicEnabled: async (enabled) => { await room.localParticipant.setMicrophoneEnabled(enabled); },
    setCameraEnabled: async (enabled) => { await room.localParticipant.setCameraEnabled(enabled); },
    switchCamera: async () => {
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (devices.length < 2) return;
        const current = [...room.localParticipant.videoTrackPublications.values()][0]?.track?.mediaStreamTrack?.getSettings().deviceId;
        const next = devices.find((d) => d.deviceId !== current) ?? devices[0];
        await room.switchActiveDevice('videoinput', next.deviceId);
      } catch (e) { if (!isBenignMediaAbort(e)) opts.onError?.(e instanceof Error ? e.message : String(e)); }
    },
    getConnectionState: () => currentState,
    getLocalVideoTrack: () => [...room.localParticipant.videoTrackPublications.values()][0]?.track?.mediaStreamTrack ?? null,
    getLocalAudioTrack: () => [...room.localParticipant.audioTrackPublications.values()][0]?.track?.mediaStreamTrack ?? null,
  };
}
