import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PosterGrid, personImg } from '../components/Row';
import { TrailerBackdrop } from '../components/TrailerBackdrop';
import { useApp } from '../state/AppState';
import { fetchMeta } from '../lib/stremio';
import { cast, findByImdb, img, imdbIdFor, logo, moreLikeThis, tmdbEnabled, trailerKey } from '../lib/tmdb';
import { allProgress, getProgress } from '../lib/progress';
import { episodeLabel, episodeNumber, sortEpisodes } from '../lib/streams';
import { fromTmdb } from '../lib/tiles';
import { useAsync } from '../lib/useAsync';
import type { Meta, Video } from '../lib/types';

type Tab = 'episodes' | 'more' | 'cast';

export function Details() {
  const { type = 'movie', id: rawId = '' } = useParams();
  const id = decodeURIComponent(rawId);
  const { addons, addonsLoading, settings } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const autoplay = (location.state as { autoplay?: boolean } | null)?.autoplay;

  // TMDB-only ids (from recommendations / filmographies) are resolved to IMDb ids so Stremio addons can serve them.
  useEffect(() => {
    if (!id.startsWith('tmdb:')) return;
    imdbIdFor(Number(id.slice(5)), type).then((imdb) => {
      if (imdb) navigate(`/title/${type}/${imdb}`, { replace: true, state: location.state });
    });
  }, [id, type, navigate, location.state]);

  const meta = useAsync(
    async () => (id.startsWith('tmdb:') || addonsLoading ? null : fetchMeta(addons, type, id)),
    [id, type, addons, addonsLoading],
  );
  const tmdb = useAsync(async () => {
    if (!tmdbEnabled() || id.startsWith('tmdb:')) return null;
    const found = await findByImdb(id, type);
    if (!found) return null;
    const [key, logoUrl, people, recs] = await Promise.all([
      trailerKey(found.id, type).catch(() => undefined),
      logo(found.id, type).catch(() => undefined),
      cast(found.id, type).catch(() => []),
      moreLikeThis(found.id, type).catch(() => []),
    ]);
    return { found, key, logo: logoUrl, people, recs };
  }, [id, type]);

  const m = meta.data;
  const episodes = useMemo(() => sortEpisodes(m?.videos ?? []).filter((v) => v.season !== undefined), [m]);
  const seasons = useMemo(() => [...new Set(episodes.map((e) => e.season!))].sort((a, b) => (a || 99) - (b || 99)), [episodes]);
  const resumeEntry = useMemo(() => allProgress().find((e) => e.id === id), [id]);
  const [season, setSeason] = useState<number>();
  const [tab, setTab] = useState<Tab>(type === 'series' ? 'episodes' : 'more');

  useEffect(() => {
    if (!seasons.length) return;
    const fromResume = resumeEntry && episodes.find((e) => e.id === resumeEntry.videoId)?.season;
    setSeason(fromResume ?? seasons.find((s) => s > 0) ?? seasons[0]);
  }, [seasons, episodes, resumeEntry]);

  const playTarget = (): { videoId: string; label: string } | null => {
    if (!m) return null;
    if (type !== 'series') return { videoId: m.id, label: resumeEntry ? 'Resume' : 'Play' };
    if (resumeEntry) {
      const ep = episodes.find((e) => e.id === resumeEntry.videoId);
      return { videoId: resumeEntry.videoId, label: `Resume ${ep ? episodeLabel(ep) : ''}` };
    }
    const first = episodes.find((e) => (e.season ?? 0) > 0) ?? episodes[0];
    return first ? { videoId: first.id, label: `Play ${episodeLabel(first)}` } : null;
  };
  const target = playTarget();
  const play = (videoId: string, replace = false) =>
    navigate(`/watch/${type}/${encodeURIComponent(id)}/${encodeURIComponent(videoId)}`, { replace });

  useEffect(() => {
    // Replace this entry so Back from the player doesn't land here and autoplay again.
    if (autoplay && target) play(target.videoId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, target?.videoId]);

  if (id.startsWith('tmdb:') || meta.loading) return <main className="page page--center"><div className="spinner" /></main>;
  if (!m) return <main className="page page--center">Couldn't find this title in your addons.</main>;

  const t = tmdb.data;
  const backdrop = img(t?.found.backdrop_path, 'original') ?? m.background;
  const recs = (t?.recs ?? []).map(fromTmdb);

  return (
    <main className="page page--details">
      <header className="hero hero--details">
        <TrailerBackdrop image={backdrop} youtubeKey={t?.key} enabled={settings.autoplayPreviews} delay={1800} />
        <div className="hero__content">
          {(t?.logo ?? m.logo) ? <img className="hero__logo" src={t?.logo ?? m.logo} alt={m.name} /> : <h1>{m.name}</h1>}
          <MetaLine meta={m} />
          <p className="hero__overview">{m.description ?? t?.found.overview}</p>
          <div className="hero__actions">
            {target && <button className="btn btn--primary" onClick={() => play(target.videoId)} data-autofocus>▶ {target.label}</button>}
            {resumeEntry && type !== 'series' && (
              <button className="btn" onClick={() => navigate(`/watch/${type}/${encodeURIComponent(id)}/${encodeURIComponent(m.id)}`, { state: { fromStart: true } })}>↺ From beginning</button>
            )}
          </div>
          {!!m.cast?.length && (
            <p className="hero__credits"><span>Starring</span> {m.cast.slice(0, 4).join(', ')}</p>
          )}
        </div>
      </header>

      <div className="tabs">
        {type === 'series' && <button className={tab === 'episodes' ? 'is-on' : ''} onClick={() => setTab('episodes')}>Episodes</button>}
        {recs.length > 0 && <button className={tab === 'more' ? 'is-on' : ''} onClick={() => setTab('more')}>More Like This</button>}
        {!!t?.people.length && <button className={tab === 'cast' ? 'is-on' : ''} onClick={() => setTab('cast')}>Cast &amp; Crew</button>}
      </div>

      <section className="tab-body">
        {tab === 'episodes' && type === 'series' && (
          <>
            {seasons.length > 1 && (
              <select className="season-select" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
                {seasons.map((s) => (
                  <option key={s} value={s}>{s === 0 ? 'Specials' : `Season ${s}`}</option>
                ))}
              </select>
            )}
            <div className="episodes">
              {episodes.filter((e) => e.season === season).map((e) => (
                <EpisodeRow key={e.id} ep={e} fallback={m.background} onPlay={() => play(e.id)} />
              ))}
            </div>
          </>
        )}
        {tab === 'more' && <PosterGrid tiles={recs} />}
        {tab === 'cast' && (
          <div className="cast">
            {t?.people.map((p) => (
              <Link key={p.id} to={`/person/${p.id}`} className="cast__item" title={`Where else has ${p.name} played?`}>
                {p.profile_path ? <img src={personImg(p.profile_path)} alt={p.name} loading="lazy" /> : <div className="cast__ph">{p.name[0]}</div>}
                <strong>{p.name}</strong>
                <small>{p.character}</small>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MetaLine({ meta }: { meta: Meta }) {
  return (
    <div className="meta-line">
      {meta.releaseInfo && <span>{meta.releaseInfo}</span>}
      {meta.runtime && <span>{meta.runtime}</span>}
      {meta.imdbRating && <span>★ {meta.imdbRating}</span>}
      {meta.genres?.slice(0, 3).map((g) => <span key={g} className="badge">{g}</span>)}
    </div>
  );
}

function EpisodeRow({ ep, fallback, onPlay }: { ep: Video; fallback?: string; onPlay: () => void }) {
  const p = getProgress(ep.id);
  const upcoming = ep.released && Date.parse(ep.released) > Date.now();
  return (
    <button className="episode" onClick={onPlay} disabled={Boolean(upcoming)}>
      <span className="episode__num">{episodeNumber(ep)}</span>
      <span className="episode__thumb">
        <img src={ep.thumbnail ?? fallback} alt="" loading="lazy" />
        {p && p.duration > 0 && (
          <span className="card__progress"><span style={{ width: `${(p.time / p.duration) * 100}%` }} /></span>
        )}
        <span className="episode__play">▶</span>
      </span>
      <span className="episode__body">
        <strong>{ep.name ?? ep.title ?? `Episode ${episodeNumber(ep)}`}</strong>
        <small>{upcoming ? `Coming ${new Date(ep.released!).toLocaleDateString()}` : ep.released?.slice(0, 10)}</small>
        <span>{ep.overview ?? ep.description}</span>
      </span>
    </button>
  );
}
