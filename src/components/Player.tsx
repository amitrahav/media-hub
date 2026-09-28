import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NEXT_UP_COUNTDOWN, NEXT_UP_LEAD_SECONDS, WATCHED_THRESHOLD } from '../config';
import { scrobble, type TraktItem } from '../lib/trakt';
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
  title: string;
  subtitle?: string;
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
  const { src, startAt, traktItem, next, autoplayNext } = props;
  const video = useRef<HTMLVideoElement>(null);
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
  const onBack = useRef(props.onBack);
  onBack.current = props.onBack;

  // Countdown end and `ended` can both fire — only advance once.
  const advanced = useRef(false);
  const goNext = useCallback(() => {
    if (advanced.current || !next) return;
    advanced.current = true;
    next.go();
  }, [next]);

  // ---- source (native, or hls.js for .m3u8 where the browser lacks HLS) ----
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let destroy: (() => void) | undefined;
    if (/\.m3u8(\?|$)/i.test(src) && !v.canPlayType('application/vnd.apple.mpegurl')) {
      import('hls.js').then(({ default: Hls }) => {
        const hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(v);
        destroy = () => hls.destroy();
      });
    } else {
      v.src = src;
    }
    return () => destroy?.();
  }, [src]);

  // ---- Trakt scrobbling: start on play, pause on pause, stop on end / leave ----
  const scrobbleState = useRef<'idle' | 'playing' | 'paused' | 'stopped'>('idle');
  const progressPct = useCallback(() => {
    const v = video.current;
    return v && v.duration ? (v.currentTime / v.duration) * 100 : 0;
  }, []);
  const send = useCallback(
    (action: 'start' | 'pause' | 'stop') => {
      if (!traktItem || scrobbleState.current === 'stopped') return;
      if (action === 'pause' && scrobbleState.current !== 'playing') return;
      scrobbleState.current = action === 'start' ? 'playing' : action === 'pause' ? 'paused' : 'stopped';
      scrobble(action, traktItem, progressPct()).catch(() => undefined);
    },
    [traktItem, progressPct],
  );
  useEffect(() => {
    const stop = () => scrobbleState.current !== 'idle' && send('stop');
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [send]);

  // ---- chrome auto-hide ----
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => !video.current?.paused && setChrome(false), 3000);
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const seek = useCallback((delta: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      poke();
      if (e.key === ' ' || e.key === 'k') (e.preventDefault(), toggle());
      else if (e.key === 'ArrowRight') seek(10);
      else if (e.key === 'ArrowLeft') seek(-10);
      else if (e.key === 'f') fullscreen();
      else if (e.key === 'm' && video.current) video.current.muted = !video.current.muted;
      else if (e.key === 'Escape' && !document.fullscreenElement) onBack.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poke, toggle, seek, fullscreen]);

  // ---- next-up / post-play ----
  const remaining = duration - time;
  const nearEnd = duration > 0 && remaining <= Math.min(NEXT_UP_LEAD_SECONDS, duration * 0.1);
  const showNext = Boolean(next) && !nextDismissed && (nearEnd || ended);
  const showPostPlay = !next && !nextDismissed && (nearEnd || ended);
  const watched = duration > 0 && (time / duration) * 100 >= WATCHED_THRESHOLD;
  const canRate = props.traktConnected && props.askRating && Boolean(traktItem) && watched && !rated;

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

  return (
    <div
      ref={shell}
      className={`player ${chrome || paused ? 'player--chrome' : ''} ${showPostPlay ? 'player--postplay' : ''}`}
      onMouseMove={poke}
    >
      <video
        ref={video}
        className="player__video"
        autoPlay
        playsInline
        onClick={toggle}
        onDoubleClick={fullscreen}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          if (startAt && startAt < v.duration - 30) v.currentTime = startAt;
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
          props.onTime(v.currentTime, v.duration);
          if (nextDismissed && v.duration - v.currentTime > NEXT_UP_LEAD_SECONDS) setNextDismissed(false);
        }}
        onPlay={() => {
          setPaused(false);
          setEnded(false);
          send('start');
          poke();
        }}
        onPause={(e) => {
          setPaused(true);
          if (!e.currentTarget.ended) send('pause');
        }}
        onEnded={() => {
          setEnded(true);
          send('stop');
          if (autoplayNext && !countdownHeld) goNext();
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onError={props.onError}
      />

      {waiting && !ended && <div className="player__spinner" />}

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
            onChange={(e) => video.current && (video.current.currentTime = Number(e.target.value))}
            aria-label="Seek"
          />
        </div>
        <div className="player__controls">
          <button className="icon-btn" onClick={toggle} aria-label={paused ? 'Play' : 'Pause'}>{paused ? '▶' : '❚❚'}</button>
          <button className="icon-btn" onClick={() => seek(-10)} aria-label="Back 10 seconds">↺10</button>
          <button className="icon-btn" onClick={() => seek(10)} aria-label="Forward 10 seconds">10↻</button>
          <button className="icon-btn" onClick={() => video.current && (video.current.muted = !muted)} aria-label="Mute">
            {muted ? '🔇' : '🔊'}
          </button>
          <span className="player__time">{fmt(time)} / {fmt(duration)}</span>
          <span className="spacer" />
          {next && (
            <button className="pill pill--ghost" onClick={goNext}>Next episode ⏭</button>
          )}
          <button className="icon-btn" onClick={fullscreen} aria-label="Fullscreen">⛶</button>
        </div>
      </div>

      {showNext && next && (
        <div
          className="nextup"
          onMouseEnter={() => setCountdownHeld(true)}
          onMouseLeave={() => setCountdownHeld(false)}
        >
          {next.thumbnail && <img src={next.thumbnail} alt="" />}
          <div className="nextup__body">
            <small>Next episode · {next.label}</small>
            <strong>{next.title}</strong>
            <div className="nextup__actions">
              <button className="pill" onClick={goNext}>
                <span
                  className="nextup__fill"
                  style={{ width: autoplayNext && !countdownHeld ? `${(1 - countdown / NEXT_UP_COUNTDOWN) * 100}%` : '0%' }}
                />
                ▶ {autoplayNext && !countdownHeld ? `Next in ${countdown}` : 'Play next'}
              </button>
              {!ended && (
                <button className="pill pill--ghost" onClick={() => setNextDismissed(true)}>Watch credits</button>
              )}
            </div>
            {canRate && traktItem && (
              <RatingPrompt compact item={traktItem} title="this episode" onDone={() => setRated(true)} />
            )}
          </div>
        </div>
      )}

      {showPostPlay && (
        <div className="postplay">
          <div className="postplay__panel">
            {canRate && traktItem ? (
              <RatingPrompt item={traktItem} title={props.title} offerShow={props.offerShowRating} onDone={() => setRated(true)} />
            ) : (
              <div className="rating__q">Thanks for watching <strong>{props.title}</strong></div>
            )}
            {!ended && (
              <button className="pill pill--ghost" onClick={() => setNextDismissed(true)}>Watch credits</button>
            )}
          </div>
          {props.postPlay}
        </div>
      )}
    </div>
  );
}
