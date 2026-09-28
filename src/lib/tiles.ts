import type { MetaPreview } from './types';
import { img, stremioType, titleOf, yearOf, type TmdbTitle } from './tmdb';
import type { TraktRec } from './trakt';

/** A card on screen, whatever source it came from (Stremio addon, TMDB, Trakt). */
export interface Tile {
  key: string;
  type: string;
  /** Route id: a Stremio id (tt…, kitsu:…) or `tmdb:<id>` resolved on the details page. */
  id: string;
  tmdbId?: number;
  name: string;
  poster?: string;
  background?: string;
  subtitle?: string;
  progress?: number; // 0..1 for continue watching
  href?: string; // override target (e.g. resume straight into the player)
}

export const metahubPoster = (imdb: string) => `https://images.metahub.space/poster/medium/${imdb}/img`;
export const metahubBackground = (imdb: string) => `https://images.metahub.space/background/medium/${imdb}/img`;

export const fromMeta = (m: MetaPreview): Tile => ({
  key: `${m.type}:${m.id}`,
  type: m.type,
  id: m.id,
  name: m.name,
  poster: m.poster,
  background: m.background,
  subtitle: [m.releaseInfo, m.imdbRating && `★ ${m.imdbRating}`].filter(Boolean).join(' · '),
});

export const fromTmdb = (t: TmdbTitle): Tile => ({
  key: `tmdb:${t.media_type}:${t.id}`,
  type: stremioType(t.media_type ?? 'movie'),
  id: `tmdb:${t.id}`,
  tmdbId: t.id,
  name: titleOf(t),
  poster: img(t.poster_path, 'w342'),
  background: img(t.backdrop_path, 'w780'),
  subtitle: [yearOf(t), t.character && `as ${t.character}`].filter(Boolean).join(' · '),
});

export const fromTrakt = (r: TraktRec, type: 'movie' | 'series'): Tile | null =>
  r.ids.imdb
    ? {
        key: `trakt:${type}:${r.ids.trakt}`,
        type,
        id: r.ids.imdb,
        tmdbId: r.ids.tmdb,
        name: r.title,
        poster: metahubPoster(r.ids.imdb),
        background: metahubBackground(r.ids.imdb),
        subtitle: String(r.year ?? ''),
      }
    : null;

export const titleHref = (t: Pick<Tile, 'type' | 'id' | 'href'>) =>
  t.href ?? `/title/${t.type}/${encodeURIComponent(t.id)}`;
