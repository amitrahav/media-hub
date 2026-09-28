import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NEXT_UP_COUNTDOWN, NEXT_UP_LEAD_SECONDS, WATCHED_THRESHOLD } from '../config';
import { rate, scrobble, type TraktItem } from '../lib/trakt';
import { RemoteMedia, type MediaLike, type PlayerBackend } from '../lib/remoteMedia';
import { RatingPrompt } from './RatingPrompt';

export interface NextUp {
  title: string;
  label: string;
  thumbnail?: string;
  go: () => void;
  /** Warm the next episode's streams while the credits roll. */
  prefetch?: () => void;
}

interface Props {
  src: string;
  backend: PlayerBackend;
  title: string;
  subtitle?: string;
  backdrop?: string;
  startAt?: number;
  traktItem?: TraktItem;
  traktConnected: boolean;
  askRating: boolean;
  autoplayNext: boolean;
  next?: NextUp;
  /** Rendered in post-play when there is no next episode (e.g. "More like this"). */
  postPlay?: ReactNode;
  offerShowRating?: boolean;
  onTime: (time: number, duration: number) => void;
  onBack: () => void;
  onOpenSources: () => void;
  onError: () => void;
}

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export function Player(props: Props) {
  const { src, backend, startAt, traktItem, next, autoplayNext } = props;
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaLike | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState(NEXT_UP_COUNTDOWN);
  const [countdownHeld, setCountdownHeld] = useState(false);
  const [ended, setEnded] = useState(false);
  const [rated, setRated] = useState(false);
  const onMpv = backend === 'mpv';

  // Countdown end and `ended` can both fire — only advance once.
  const advanced = useRef(false);
  const goNext = useCallback(() => {
    if (advanced.current || !next) return;
    advanced.current = true;
    next.go();
  }, [next]);

  // ---- derived playback state ----
  const remaining = duration - time;
  const nearEnd = duration > 0 && remaining <= Math.min(NEXT_UP_LEAD_SECONDS, duration * 0.1);
  const showNext = Boolean(next) && !nextDismissed && (nearEnd || ended);
  const showPostPlay = !next && !nextDismissed && (nearEnd || ended);
  const watched = duration > 0 && (time / duration) * 100 >= WATCHED_THRESHOLD;
  const canRate = props.traktConnected && props.askRating && Boolean(traktItem) && watched && !rated;

  // ---- Trakt scrobbling: start on play, pause on pause, stop on end / leave ----
  const scrobbleState = useRef<'idle' | 'playing' | 'paused' | 'stopped'>('idle');
  const send = useCallback(
    (action: 'start' | 'pause' | 'stop') => {
      if (!traktItem || scrobbleState.current === 'stopped') return;
      if (action === 'pause' && scrobbleState.current !== 'playing') return;
      scrobbleState.current = action === 'start' ? 'playing' : action === 'pause' ? 'paused' : 'stopped';
      const m = media.current;
      const pct = m && m.duration ? (m.currentTime / m.duration) * 100 : 0;
      scrobble(action, traktItem, pct).catch(() => undefined);
    },
    [traktItem],
  );
  useEffect(() => {
    const stop = () => scrobbleState.current !== 'idle' && send('stop');
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [send]);

  const submitRating = useCallback(
    (n: number) => {
      if (!traktItem) return;
      setRated(true);
      rate(traktItem, n)
        .then(() => (media.current as RemoteMedia | null)?.osd?.(`♥ ${n}/10 — saved to Trakt`, 2500))
        .catch(() => undefined);
    },
    [traktItem],
  );

  // Latest handlers for media events (listeners are bound once per source).
  const handlers = useRef({} as Record<string, (e: Event) => void>);
  handlers.current = {
    loadedmetadata: () => {
      const m = media.current!;
      setDuration(m.duration);
      if (!onMpv && startAt && startAt < m.duration - 30) m.currentTime = startAt;
    },
    timeupdate: () => {
      const m = media.current!;
      setTime(m.currentTime);
      if (m.duration && m.duration !== duration) setDuration(m.duration);
      const v = video.current;
      if (!onMpv && v?.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
      props.onTime(m.currentTime, m.duration);
      if (nextDismissed && m.duration - m.currentTime > NEXT_UP_LEAD_SECONDS) setNextDismissed(false);
    },
    play: () => {
      setPaused(false);
      setEnded(false);
      send('start');
      poke();
    },
    pause: () => {
      setPaused(true);
      if (!media.current?.ended) send('pause');
    },
    ended: () => {
      setEnded(true);
      send('stop');
      if (next) {
        if (autoplayNext && !countdownHeld) goNext();
      } else if (onMpv) {
        // Close mpv so the post-play screen (rating + More Like This) is visible on the TV.
        (media.current as RemoteMedia).destroy(0);
      }
    },
    waiting: () => setWaiting(true),
    playing: () => setWaiting(false),
    canplay: () => setWaiting(false),
    volumechange: () => setMuted(Boolean(media.current?.muted)),
    error: () => props.onError(),
    remoteexit: () => !ended && props.onBack(),
    remotekey: (e) => {
      const key = (e as CustomEvent<string>).detail;
      const m = media.current as RemoteMedia;
      if (key === 'select') return showNext ? goNext() : void m.toggle();
      if (key === 'next') return goNext();
      if (key === 'sources') return props.onOpenSources();
      if (key === 'back') return showNext && !ended ? setNextDismissed(true) : props.onBack();
      if (/^\d$/.test(key) && canRate) submitRating(key === '0' ? 10 : Number(key));
    },
  };

  // ---- attach the backend: <video> (+ hls.js for .m3u8) or local mpv ----
  useEffect(() => {
    let m: MediaLike;
    let cleanup: (() => void) | undefined;
    if (onMpv) {
      const remote = new RemoteMedia(src, [props.title, props.subtitle].filter(Boolean).join(' — '), startAt ?? 0);
      m = remote;
      void remote.load();
      cleanup = () => remote.destroy(1500);
    } else {
      const v = video.current!;
      m = v;
      if (/\.m3u8(\?|$)/i.test(src) && !v.canPlayType('application/vnd.apple.mpegurl')) {
        let hls: { destroy(): void } | undefined;
        import('hls.js').then(({ default: Hls }) => {
          const h = new Hls();
          h.loadSource(src);
          h.attachMedia(v);
          hls = h;
        });
        cleanup = () => hls?.destroy();
      } else {
        v.src = src;
      }
    }
    media.current = m;
    const names = Object.keys(handlers.current);
    const bound = names.map((n) => [n, (e: Event) => handlers.current[n]?.(e)] as const);
    bound.forEach(([n, fn]) => m.addEventListener(n, fn));
    return () => {
      bound.forEach(([n, fn]) => m.removeEventListener(n, fn));
      cleanup?.();
    };
    // Only a new source / backend re-attaches; startAt is read at load time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, onMpv]);

  // ---- chrome auto-hide ----
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => !media.current?.paused && setChrome(false), 3000);
  }, []);

  const toggle = useCallback(() => {
    const m = media.current;
    if (!m) return;
    if (m.paused) void m.play();
    else m.pause();
  }, []);
  const seek = useCallback((delta: number) => {
    const m = media.current;
    if (m) m.currentTime = Math.max(0, Math.min(m.duration || 0, m.currentTime + delta));
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen();
  }, []);

  // Keyboard / TV remote (browser backend). While an overlay is up, arrows belong to spatial navigation.
  const overlay = showNext || showPostPlay;
  const keyState = useRef({ overlay, showNext, ended, onBack: props.onBack, onOpenSources: props.onOpenSources });
  keyState.current = { overlay, showNext, ended, onBack: props.onBack, onOpenSources: props.onOpenSources };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input:not([type=range]), textarea, .sources')) return;
      const k = keyState.current;
      poke();
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack') {
        e.preventDefault();
        if (k.showNext && !k.ended) setNextDismissed(true);
        else if (!document.fullscreenElement) k.onBack();
        return;
      }
      if (e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause') return toggle();
      if (e.key === 'MediaTrackNext') return goNext();
      if (e.key === 'F1' || e.key === 'ContextMenu') return (e.preventDefault(), k.onOpenSources());
      if (k.overlay) return;
      if (e.key === ' ' || e.key === 'k' || e.key === 'Enter') (e.preventDefault(), toggle());
      else if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') (e.preventDefault(), seek(10));
      else if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') (e.preventDefault(), seek(-10));
      else if (e.key === 'ArrowUp') (e.preventDefault(), seek(60));
      else if (e.key === 'ArrowDown') (e.preventDefault(), seek(-60));
      else if (e.key === 'f') fullscreen();
      else if (e.key === 'm' && media.current) media.current.muted = !media.current.muted;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poke, toggle, seek, fullscreen, goNext]);

  // ---- next-up countdown ----
  useEffect(() => {
    if (showNext) next?.prefetch?.();
  }, [showNext, next]);

  useEffect(() => {
    if (!showNext || !autoplayNext || countdownHeld) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [showNext, autoplayNext, countdown, countdownHeld, goNext]);

  useEffect(() => {
    if (!showNext) setCountdown(NEXT_UP_COUNTDOWN);
  }, [showNext]);

  // mpv covers the screen, so the next-up card is drawn with mpv's on-screen display instead.
  useEffect(() => {
    if (!onMpv || !showNext || !next) return;
    const lines = [
      `Next episode · ${next.label} — ${next.title}`,
      autoplayNext ? `Playing in ${countdown}s   ·   OK: play now   ·   Back: watch credits` : 'OK: play next   ·   Back: watch credits',
    ];
    if (canRate) lines.push('How was this episode?  Press 1–9 (0 = 10) to rate on Trakt');
    void (media.current as RemoteMedia)?.osd(lines.join('\n'), 1500);
  }, [onMpv, showNext, next, countdown, autoplayNext, canRate]);

  useEffect(() => {
    if (!onMpv || !showPostPlay || ended || !canRate) return;
    void (media.current as RemoteMedia)?.osd('How was it?  Press 1–9 (0 = 10) to rate on Trakt   ·   Back: exit', 4000);
  }, [onMpv, showPostPlay, ended, canRate]);

  const playerKeys = !overlay && !onMpv;
  return (
    <div
      ref={shell}
      className={`player ${chrome || paused ? 'player--chrome' : ''} ${showPostPlay ? 'player--postplay' : ''} ${onMpv ? 'player--mpv' : ''}`}
      onMouseMove={poke}
      data-player-keys={playerKeys ? '' : undefined}
    >
      {onMpv ? (
        <div className="player__video player__tv" style={props.backdrop ? { backgroundImage: `url(${props.backdrop})` } : undefined}>
          {!showPostPlay && (
            <div className="player__tv-note">
              <strong>{props.title}</strong>
              {props.subtitle && <span>{props.subtitle}</span>}
              <small>{waiting ? 'Starting playback…' : `Playing · ${fmt(time)} / ${fmt(duration)}`}</small>
            </div>
          )}
        </div>
      ) : (
        <video ref={video} className="player__video" autoPlay playsInline onClick={toggle} onDoubleClick={fullscreen} />
      )}

      {waiting && !ended && !onMpv && <div className="player__spinner" />}

      {!onMpv && (
        <>
          <div className="player__top">
            <button className="icon-btn" onClick={props.onBack} aria-label="Back">←</button>
            <div className="player__titles">
              <strong>{props.title}</strong>
              {props.subtitle && <span>{props.subtitle}</span>}
            </div>
            <button className="icon-btn" onClick={props.onOpenSources} aria-label="Sources">⚙︎</button>
          </div>

          <div className="player__bottom">
            <div className="player__scrub">
              <div className="player__buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={1}
                value={time}
                onChange={(e) => media.current && (media.current.currentTime = Number(e.target.value))}
                aria-label="Seek"
                tabIndex={-1}
              />
            </div>
            <div className="player__controls">
              <button className="icon-btn" onClick={toggle} aria-label={paused ? 'Play' : 'Pause'}>{paused ? '▶' : '❚❚'}</button>
              <button className="icon-btn" onClick={() => seek(-10)} aria-label="Back 10 seconds">↺10</button>
              <button className="icon-btn" onClick={() => seek(10)} aria-label="Forward 10 seconds">10↻</button>
              <button className="icon-btn" onClick={() => media.current && (media.current.muted = !muted)} aria-label="Mute">
                {muted ? '🔇' : '🔊'}
              </button>
              <span className="player__time">{fmt(time)} / {fmt(duration)}</span>
              <span className="spacer" />
              {next && <button className="pill pill--ghost" onClick={goNext}>Next episode ⏭</button>}
              <button className="icon-btn" onClick={fullscreen} aria-label="Fullscreen">⛶</button>
            </div>
          </div>
        </>
      )}

      {showNext && next && !onMpv && (
        <div className="nextup" onMouseEnter={() => setCountdownHeld(true)} onMouseLeave={() => setCountdownHeld(false)}>
          {next.thumbnail && <img src={next.thumbnail} alt="" />}
          <div className="nextup__body">
            <small>Next episode · {next.label}</small>
            <strong>{next.title}</strong>
            <div className="nextup__actions">
              <button className="pill" onClick={goNext} data-autofocus>
                <span
                  className="nextup__fill"
                  style={{ width: autoplayNext && !countdownHeld ? `${(1 - countdown / NEXT_UP_COUNTDOWN) * 100}%` : '0%' }}
                />
                ▶ {autoplayNext && !countdownHeld ? `Next in ${countdown}` : 'Play next'}
              </button>
              {!ended && <button className="pill pill--ghost" onClick={() => setNextDismissed(true)}>Watch credits</button>}
            </div>
            {canRate && traktItem && (
              <RatingPrompt compact item={traktItem} title="this episode" onDone={() => setRated(true)} />
            )}
          </div>
        </div>
      )}

      {showPostPlay && (!onMpv || ended) && (
        <div className="postplay">
          <div className="postplay__panel">
            {canRate && traktItem ? (
              <RatingPrompt item={traktItem} title={props.title} offerShow={props.offerShowRating} onDone={() => setRated(true)} autoFocus />
            ) : (
              <div className="rating__q">Thanks for watching <strong>{props.title}</strong></div>
            )}
            {!ended && <button className="pill pill--ghost" onClick={() => setNextDismissed(true)}>Watch credits</button>}
            {ended && <button className="pill pill--ghost" onClick={props.onBack}>← Back to {props.title}</button>}
          </div>
          {props.postPlay}
        </div>
      )}
    </div>
  );
}
