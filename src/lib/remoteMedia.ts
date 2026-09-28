/**
 * What the Player needs from a media backend. `HTMLVideoElement` already satisfies it; `RemoteMedia`
 * implements it on top of the local mpv process (TV mode) so the Player logic is shared.
 */
export interface MediaLike extends EventTarget {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  muted: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export type PlayerBackend = 'browser' | 'mpv';

async function post(path: string, payload: unknown) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `mpv ${r.status}`);
  return r.json();
}

export async function mpvAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/api/player/status');
    return r.ok && (await r.json()).available === true;
  } catch {
    return false;
  }
}

interface ServerMsg {
  type: 'state' | 'key' | 'exit' | 'error';
  session: number;
  time?: number;
  duration?: number;
  paused?: boolean;
  eof?: boolean;
  loaded?: boolean;
  key?: string;
  message?: string;
}

/**
 * mpv playing full-screen on this device, controlled through the Node server. Emits the same
 * events as a <video> element plus `remotekey` (CustomEvent<string>) for OK / Back / digits pressed
 * while mpv has focus, and `remoteexit` when the mpv window goes away.
 */
export class RemoteMedia extends EventTarget implements MediaLike {
  muted = false;
  private session = -1;
  private time = 0;
  private dur = NaN;
  private isPaused = true;
  private isEnded = false;
  private started = false;
  private events?: EventSource;

  constructor(
    private src: string,
    private title: string,
    private startAt = 0,
  ) {
    super();
  }

  async load() {
    this.events = new EventSource('/api/player/events');
    this.events.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMsg);
    try {
      const { session } = await post('/api/player/play', { url: this.src, title: this.title, startAt: this.startAt });
      this.session = session;
    } catch (err) {
      console.warn(err);
      this.dispatchEvent(new Event('error'));
    }
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  private onMessage(msg: ServerMsg) {
    if (msg.session !== this.session) return;
    switch (msg.type) {
      case 'state': {
        if (msg.duration && !this.started) {
          this.started = true;
          this.dur = msg.duration;
          this.emit('loadedmetadata');
          this.emit('canplay');
        }
        if (msg.duration) this.dur = msg.duration;
        if (msg.paused !== undefined && msg.paused !== this.isPaused && this.started) {
          this.isPaused = msg.paused;
          this.emit(msg.paused ? 'pause' : 'play');
          if (!msg.paused) this.emit('playing');
        }
        if (typeof msg.time === 'number') {
          this.time = msg.time;
          this.emit('timeupdate');
        }
        if (msg.eof && !this.isEnded) {
          this.isEnded = true;
          this.isPaused = true;
          this.emit('pause');
          this.emit('ended');
        } else if (!msg.eof) this.isEnded = false;
        break;
      }
      case 'key':
        this.dispatchEvent(new CustomEvent('remotekey', { detail: msg.key }));
        break;
      case 'exit':
        this.dispatchEvent(new Event('remoteexit'));
        break;
      case 'error':
        this.emit('error');
        break;
    }
  }

  get currentTime() {
    return this.time;
  }
  set currentTime(v: number) {
    this.time = v;
    void this.command('seek', v);
  }
  get duration() {
    return this.dur;
  }
  get paused() {
    return this.isPaused;
  }
  get ended() {
    return this.isEnded;
  }

  play() {
    return this.command('resume');
  }
  pause() {
    void this.command('pause');
  }
  toggle() {
    return this.command('toggle');
  }
  seekBy(seconds: number) {
    return this.command('seekBy', seconds);
  }
  osd(text: string, ms = 3000) {
    return this.command('osd', text, ms);
  }

  /** Stop listening and close mpv (after `graceMs`, so a following episode can reuse the window). */
  destroy(graceMs = 0) {
    this.events?.close();
    void this.command('stop', graceMs);
  }

  private async command(name: string, value?: unknown, extra?: unknown) {
    await post('/api/player/command', { name, value, extra }).catch(() => undefined);
  }
}
