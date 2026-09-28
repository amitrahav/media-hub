import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Player, type NextUp } from '../components/Player';
import { useApp } from '../state/AppState';
import { fetchMeta, fetchStreams, stremioDeepLink } from '../lib/stremio';
import { episodeLabel, nextEpisode, pickAutoplay, rankStreams, type RankedStream } from '../lib/streams';
import { getProgress, putProgress } from '../lib/progress';
import { getTraktToken, type TraktItem } from '../lib/trakt';
import { findByImdb, moreLikeThis, tmdbEnabled } from '../lib/tmdb';
import { fromTmdb, titleHref } from '../lib/tiles';
import { useAsync } from '../lib/useAsync';
import type { Addon, SourcedStream } from '../lib/types';

// Streams requested ahead of time (during the credits of the previous episode).
const prefetched = new Map<string, Promise<SourcedStream[]>>();
function getStreams(addons: Addon[], type: string, videoId: string, onPartial?: (s: SourcedStream[]) => void) {
  const hit = prefetched.get(videoId);
  if (hit) {
    prefetched.delete(videoId);
    return hit;
  }
  return fetchStreams(addons, type, videoId, onPartial);
}

const STREAM_TIMEOUT = 12_000;

export function Watch() {
  const { type = 'movie', id: rawId = '', videoId: rawVideo = '' } = useParams();
  const id = decodeURIComponent(rawId);
  const videoId = decodeURIComponent(rawVideo);
  const { addons, addonsLoading, settings, backend } = useApp();
  const rankOpts = { preferredQuality: settings.preferredQuality, backend };
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as { bingeGroup?: string; fromStart?: boolean };

  const meta = useAsync(async () => (addonsLoading ? null : fetchMeta(addons, type, id)), [addons, addonsLoading, type, id]);
  const [streams, setStreams] = useState<RankedStream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [current, setCurrent] = useState<RankedStream>();
  const [showSources, setShowSources] = useState(false);
  const [startAt, setStartAt] = useState<number>();
  const failed = useRef(new Set<string>());
  const lastTime = useRef(0);

  // ---- resolve streams and auto-pick the best cached debrid link ----
  useEffect(() => {
    if (addonsLoading) return;
    let done = false;
    setStreams([]);
    setCurrent(undefined);
    setLoadingStreams(true);
    failed.current.clear();
    const bingeGroup = navState.bingeGroup ?? getProgress(videoId)?.bingeGroup;
    const choose = (list: SourcedStream[], final: boolean) => {
      if (done) return;
      const ranked = rankStreams(list, rankOpts);
      setStreams(ranked);
      // Take a binge-group match the moment it arrives; otherwise wait for every addon (or the timeout).
      const same = bingeGroup && pickAutoplay(ranked, bingeGroup);
      const pick = same && same.behaviorHints?.bingeGroup === bingeGroup ? same : final ? pickAutoplay(ranked) : undefined;
      if (pick || final) {
        done = true;
        setCurrent(pick);
        setLoadingStreams(false);
        if (!pick) setShowSources(true);
      }
    };
    let latest: SourcedStream[] = [];
    const timeout = setTimeout(() => choose(latest, true), STREAM_TIMEOUT);
    getStreams(addons, type, videoId, (partial) => {
      latest = partial;
      choose(partial, false);
    }).then((all) => {
      clearTimeout(timeout);
      latest = all;
      if (done) setStreams(rankStreams(all, rankOpts));
      else choose(all, true);
    });
    return () => {
      done = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons, addonsLoading, type, videoId, backend]);

  useEffect(() => {
    const p = getProgress(videoId);
    setStartAt(navState.fromStart || !p || p.upNext ? 0 : p.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const m = meta.data;
  const video = m?.videos?.find((v) => v.id === videoId);
  const next = m?.videos && type === 'series' ? nextEpisode(m.videos, videoId) : undefined;

  const traktItem = useMemo<TraktItem | undefined>(() => {
    if (!id.startsWith('tt')) return undefined;
    if (type === 'movie') return { kind: 'movie', imdb: id };
    const [, s, e] = videoId.split(':').map(Number);
    const season = video?.season ?? s;
    const episode = video?.episode ?? video?.number ?? e;
    return season && episode ? { kind: 'episode', showImdb: id, season, episode } : undefined;
  }, [id, type, videoId, video]);

  // ---- progress persistence (throttled) ----
  const lastSave = useRef(0);
  const onTime = useCallback(
    (time: number, duration: number) => {
      lastTime.current = time;
      if (!m || !duration || Date.now() - lastSave.current < 5000) return;
      lastSave.current = Date.now();
      putProgress({
        id,
        type,
        videoId,
        name: m.name,
        poster: m.poster,
        background: video?.thumbnail ?? m.background,
        episodeLabel: video ? `${episodeLabel(video)} · ${video.name ?? video.title ?? ''}` : undefined,
        time,
        duration,
        bingeGroup: current?.behaviorHints?.bingeGroup,
        updatedAt: Date.now(),
      });
      // Finished an episode: queue the next one as "Up next" for Continue Watching.
      if (next && time / duration > 0.92) {
        putProgress({
          id,
          type,
          videoId: next.id,
          name: m.name,
          poster: m.poster,
          background: next.thumbnail ?? m.background,
          episodeLabel: `Up next · ${episodeLabel(next)}`,
          time: 0,
          duration: 0,
          bingeGroup: current?.behaviorHints?.bingeGroup,
          upNext: true,
          updatedAt: Date.now(),
        });
      }
    },
    [m, id, type, videoId, video, next, current],
  );

  const nextUp: NextUp | undefined = next && {
    title: next.name ?? next.title ?? `Episode ${next.episode}`,
    label: episodeLabel(next),
    thumbnail: next.thumbnail,
    prefetch: () => {
      if (!prefetched.has(next.id)) prefetched.set(next.id, fetchStreams(addons, type, next.id));
    },
    go: () =>
      navigate(`/watch/${type}/${encodeURIComponent(id)}/${encodeURIComponent(next.id)}`, {
        replace: true,
        state: { bingeGroup: current?.behaviorHints?.bingeGroup, fromStart: true },
      }),
  };

  const recs = useAsync(async () => {
    if (!tmdbEnabled() || !id.startsWith('tt')) return [];
    const found = await findByImdb(id, type);
    return found ? (await moreLikeThis(found.id, type)).slice(0, 8).map(fromTmdb) : [];
  }, [id, type]);

  const openSources = () => {
    setStartAt(lastTime.current);
    setShowSources(true);
  };

  const switchTo = (s: RankedStream) => {
    setStartAt(lastTime.current);
    setCurrent(s);
    setShowSources(false);
  };

  // A stream that can't play in the browser (codec / container) → fall through to the next candidate.
  const onError = () => {
    if (current?.url) failed.current.add(current.url);
    const fallback = streams.find((s) => s.url && !failed.current.has(s.url) && s.cached);
    if (fallback) switchTo(fallback);
    else setShowSources(true);
  };

  const title = m?.name ?? '';
  const subtitle = video ? `${episodeLabel(video)} · ${video.name ?? video.title ?? ''}` : m?.releaseInfo;

  return (
    <main className="watch">
      {/* On the TV, mpv covers the screen — close it while the Sources drawer is open, resume after. */}
      {current?.url && backend === 'mpv' && showSources ? (
        <div className="watch__loading" style={m?.background ? { backgroundImage: `url(${m.background})` } : undefined} />
      ) : current?.url ? (
        <Player
          key={videoId}
          src={current.url}
          backend={backend}
          backdrop={video?.thumbnail ?? m?.background}
          title={title}
          subtitle={subtitle}
          startAt={startAt}
          traktItem={traktItem}
          traktConnected={Boolean(getTraktToken())}
          askRating={settings.askRating}
          autoplayNext={settings.autoplayNext}
          next={nextUp}
          offerShowRating={type === 'series'}
          onTime={onTime}
          onBack={() => navigate(`/title/${type}/${encodeURIComponent(id)}`)}
          onOpenSources={openSources}
          onError={onError}
          postPlay={
            recs.data?.length ? (
              <div className="postplay__recs">
                <h3>More Like This</h3>
                <div className="postplay__grid">
                  {recs.data.map((t) => (
                    <Link key={t.key} to={titleHref(t)} className="postplay__rec">
                      <img src={t.background ?? t.poster} alt="" />
                      <span>{t.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="watch__loading" style={m?.background ? { backgroundImage: `url(${m.background})` } : undefined}>
          <div className="watch__loading-inner">
            {m?.logo ? <img src={m.logo} alt={title} className="hero__logo" /> : <h1>{title}</h1>}
            {subtitle && <p>{subtitle}</p>}
            {loadingStreams ? (
              <>
                <div className="spinner" />
                <p className="muted">Finding the best debrid stream… {streams.length ? `(${streams.length} found)` : ''}</p>
              </>
            ) : (
              <p className="muted">No instantly playable stream found.</p>
            )}
            <button className="btn" onClick={() => navigate(-1)}>← Back</button>
          </div>
        </div>
      )}

      {showSources && (
        <div className="sources" onClick={() => current && setShowSources(false)}>
          <div className="sources__panel" onClick={(e) => e.stopPropagation()}>
            <div className="sources__head">
              <h3>Sources</h3>
              {backend === 'browser' && (
                <>
                  <a className="pill pill--ghost" href={stremioDeepLink(type, id, videoId)}>Open in Stremio</a>
                  {current?.url && <a className="pill pill--ghost" href={`vlc://${current.url}`}>Open in VLC</a>}
                </>
              )}
              {current && <button className="icon-btn" onClick={() => setShowSources(false)} aria-label="Close">✕</button>}
            </div>
            {streams.length === 0 && <p className="muted">No streams — check your stream addon / debrid key in Settings.</p>}
            <ul>
              {streams.map((s, i) => (
                <li key={`${s.url ?? s.infoHash}-${i}`}>
                  <button
                    className={`source ${s === current ? 'is-on' : ''}`}
                    disabled={!s.url}
                    onClick={() => switchTo(s)}
                    data-autofocus={s === current || (!current && i === 0) ? '' : undefined}
                    title={s.url ? undefined : 'Torrent-only result — configure a debrid service in your addon'}
                  >
                    <span className="source__q">{s.label}</span>
                    <span className="source__body">
                      <strong>{s.addonName}</strong>
                      <small>{(s.title ?? s.description ?? s.name ?? '').split('\n').slice(0, 2).join(' · ')}</small>
                    </span>
                    <span className="source__tags">
                      {s.cached && <span className="tag tag--ok">Cached</span>}
                      {!s.cached && s.debrid && <span className="tag">Uncached</span>}
                      {!s.debrid && <span className="tag">P2P</span>}
                      {s.debrid && !s.deviceFriendly && (
                        <span className="tag tag--warn">{backend === 'mpv' ? 'May stutter on this device' : 'May need external player'}</span>
                      )}
                      {s.hwDecoded && <span className="tag tag--ok">HW decode</span>}
                      {s.sizeGb && <span className="tag">{s.sizeGb.toFixed(1)} GB</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}
