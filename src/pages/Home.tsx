import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Row } from '../components/Row';
import { TrailerBackdrop } from '../components/TrailerBackdrop';
import { hasStreamAddon, useApp } from '../state/AppState';
import { browsableCatalogs, fetchCatalog, type CatalogRef } from '../lib/stremio';
import { img, logo, titleOf, tmdbEnabled, trailerKey, trending, yearOf, stremioType, type TmdbTitle } from '../lib/tmdb';
import { getTraktToken, playback, recommendations } from '../lib/trakt';
import { continueWatching } from '../lib/progress';
import { fromMeta, fromTmdb, fromTrakt, metahubBackground, type Tile } from '../lib/tiles';
import { useAsync } from '../lib/useAsync';

export function Home({ type }: { type?: 'movie' | 'series' }) {
  const { addons, addonsLoading, settings } = useApp();
  const catalogs = useMemo(
    () => browsableCatalogs(addons).filter((c) => (type ? c.type === type : c.type === 'movie' || c.type === 'series')),
    [addons, type],
  );
  const trakt = Boolean(getTraktToken());

  const trend = useAsync(async () => (tmdbEnabled() ? trending() : []), []);
  const hero = useMemo(() => {
    const list = (trend.data ?? []).filter((t) => !type || stremioType(t.media_type ?? '') === type);
    return list[new Date().getHours() % Math.max(1, Math.min(list.length, 5))];
  }, [trend.data, type]);

  const picks = useAsync(async () => {
    if (!trakt) return { movies: [], shows: [] };
    const [m, s] = await Promise.all([
      type === 'series' ? [] : recommendations('movies'),
      type === 'movie' ? [] : recommendations('shows'),
    ]);
    return {
      movies: m.map((r) => fromTrakt(r, 'movie')).filter(Boolean) as Tile[],
      shows: s.map((r) => fromTrakt(r, 'series')).filter(Boolean) as Tile[],
    };
  }, [trakt, type]);

  const resume = useAsync(async () => {
    const local: Tile[] = continueWatching()
      .filter((e) => !type || e.type === type)
      .map((e) => ({
        key: `cw:${e.videoId}`,
        type: e.type,
        id: e.id,
        name: e.name,
        poster: e.poster,
        background: e.background,
        subtitle: e.episodeLabel ?? `${Math.round((e.duration - e.time) / 60)} min left`,
        progress: e.time / e.duration,
        href: `/watch/${e.type}/${encodeURIComponent(e.id)}/${encodeURIComponent(e.videoId)}`,
      }));
    if (!trakt) return local;
    // Merge in Trakt's paused items from other devices.
    const seen = new Set(local.map((t) => t.id));
    const remote = (await playback())
      .filter((p) => (p.type === 'movie' ? type !== 'series' : type !== 'movie'))
      .map((p): Tile | null => {
        const item = p.type === 'movie' ? p.movie : p.show;
        const imdb = item?.ids.imdb;
        if (!item || !imdb || seen.has(imdb)) return null;
        seen.add(imdb);
        const t = p.type === 'movie' ? 'movie' : 'series';
        return {
          key: `tp:${imdb}`,
          type: t,
          id: imdb,
          name: item.title,
          background: metahubBackground(imdb),
          subtitle: p.episode ? `S${p.episode.season} · E${p.episode.number}` : `${Math.round(p.progress)}% watched`,
          progress: p.progress / 100,
          href:
            p.type === 'movie'
              ? `/watch/movie/${imdb}/${imdb}`
              : `/watch/series/${imdb}/${encodeURIComponent(`${imdb}:${p.episode!.season}:${p.episode!.number}`)}`,
        };
      })
      .filter(Boolean) as Tile[];
    return [...local, ...remote];
  }, [trakt, type]);

  const trendingTiles = (trend.data ?? []).filter((t) => !type || stremioType(t.media_type ?? '') === type).map(fromTmdb);

  return (
    <main className="page page--home">
      {hero ? <Hero title={hero} autoplay={settings.autoplayPreviews} /> : <div className="hero-spacer" />}
      <div className="rows">
        {!addonsLoading && !hasStreamAddon(addons) && (
          <div className="banner">
            No stream addon yet. <Link to="/settings">Sign in to Stremio or add your debrid addon</Link> to start watching.
          </div>
        )}
        <Row title="Continue Watching" tiles={resume.data ?? []} variant="landscape" />
        <Row title="Top Picks for You" tiles={picks.data?.movies ?? []} />
        <Row title="Series We Think You'll Love" tiles={picks.data?.shows ?? []} />
        <Row title="Trending This Week" tiles={trendingTiles} />
        {catalogs.map((c) => (
          <CatalogRow key={`${c.addon.transportUrl}:${c.type}:${c.id}`} catalog={c} />
        ))}
      </div>
    </main>
  );
}

function CatalogRow({ catalog }: { catalog: CatalogRef }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  useEffect(() => {
    fetchCatalog(catalog).then((m) => setTiles(m.map(fromMeta)), () => setTiles([]));
  }, [catalog]);
  return <Row title={catalog.title} tiles={tiles} />;
}

function Hero({ title, autoplay }: { title: TmdbTitle; autoplay: boolean }) {
  const navigate = useNavigate();
  const type = stremioType(title.media_type ?? 'movie');
  const extras = useAsync(
    async () => ({
      key: await trailerKey(title.id, type).catch(() => undefined),
      logo: await logo(title.id, type).catch(() => undefined),
    }),
    [title.id],
  );
  const href = `/title/${type}/tmdb:${title.id}`;
  return (
    <header className="hero">
      <TrailerBackdrop image={img(title.backdrop_path, 'original')} youtubeKey={extras.data?.key} enabled={autoplay} />
      <div className="hero__content">
        {extras.data?.logo ? <img className="hero__logo" src={extras.data.logo} alt={titleOf(title)} /> : <h1>{titleOf(title)}</h1>}
        <div className="meta-line">
          <span className="badge">{type === 'movie' ? 'Film' : 'Series'}</span>
          <span>{yearOf(title)}</span>
          {title.vote_average ? <span>★ {title.vote_average.toFixed(1)}</span> : null}
        </div>
        <p className="hero__overview">{title.overview}</p>
        <div className="hero__actions">
          <button className="btn btn--primary" onClick={() => navigate(href, { state: { autoplay: true } })}>▶ Play</button>
          <button className="btn" onClick={() => navigate(href)}>ⓘ More Info</button>
        </div>
      </div>
    </header>
  );
}
