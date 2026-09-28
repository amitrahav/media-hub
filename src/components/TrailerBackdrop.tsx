import { useEffect, useRef, useState } from 'react';

interface Props {
  image?: string;
  youtubeKey?: string;
  /** ms to show the still before the trailer fades in (Apple TV waits a beat). */
  delay?: number;
  enabled?: boolean;
  className?: string;
}

/**
 * Backdrop still that cross-fades into a muted, chrome-less YouTube trailer and back to the
 * still when it ends. The mute toggle talks to the iframe through the YouTube postMessage API.
 */
export function TrailerBackdrop({ image, youtubeKey, delay = 2500, enabled = true, className = '' }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    setArmed(false);
    setPlaying(false);
    setEnded(false);
    if (!youtubeKey || !enabled) return;
    const t = setTimeout(() => setArmed(true), delay);
    return () => clearTimeout(t);
  }, [youtubeKey, enabled, delay]);

  useEffect(() => {
    if (!armed) return;
    const onMessage = (e: MessageEvent) => {
      if (!/youtube/.test(e.origin) || e.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const state = data.event === 'onStateChange' ? data.info : data.info?.playerState;
        if (state === 1) setPlaying(true);
        if (state === 0) {
          setPlaying(false);
          setEnded(true);
        }
      } catch {
        /* not ours */
      }
    };
    window.addEventListener('message', onMessage);
    // Pause the promo when the tab is hidden.
    const onVis = () => command(document.hidden ? 'pauseVideo' : 'playVideo');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [armed]);

  const command = (func: string) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');

  const toggleMute = () => {
    command(muted ? 'unMute' : 'mute');
    setMuted(!muted);
  };

  const src =
    youtubeKey &&
    `https://www.youtube-nocookie.com/embed/${youtubeKey}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;

  return (
    <div className={`backdrop ${className}`}>
      {image && <img className="backdrop__img" src={image} alt="" />}
      {armed && !ended && src && (
        <iframe
          ref={frame}
          className={`backdrop__video ${playing ? 'is-visible' : ''}`}
          src={src}
          title="Trailer"
          allow="autoplay; encrypted-media"
          onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*')}
        />
      )}
      <div className="backdrop__shade" />
      {playing && (
        <button className="icon-btn backdrop__mute" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      )}
    </div>
  );
}
