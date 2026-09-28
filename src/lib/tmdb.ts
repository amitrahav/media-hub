import { TMDB_TOKEN } from '../config';
import type { MediaType } from './types';

const API = 'https://api.themoviedb.org/3';
export const img = (path: string | null | undefined, size = 'w500') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

export const tmdbEnabled = () => Boolean(TMDB_TOKEN);

const cache = new Map<string, Promise<unknown>>();
function get<T>(path: string): Promise<T> {
  if (!TMDB_TOKEN) return Promise.reject(new Error('TMDB token missing'));
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then((r) => {
      if (!r.ok) throw new Error(`TMDB ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

type TmdbKind = 'movie' | 'tv';
const kind = (t: MediaType | string): TmdbKind => (t === 'movie' ? 'movie' : 'tv');
export const stremioType = (k: string): MediaType => (k === 'movie' ? 'movie' : 'series');

export interface TmdbTitle {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  character?: string;
  job?: string;
  episode_count?: number;
}

export async function findByImdb(imdbId: string, type: MediaType | string) {
  const r = await get<{ movie_results: TmdbTitle[]; tv_results: TmdbTitle[] }>(
    `/find/${imdbId}?external_source=imdb_id`,
  );
  return (kind(type) === 'movie' ? r.movie_results : r.tv_results)[0];
}

export async function imdbIdFor(tmdbId: number, type: MediaType | string): Promise<string | undefined> {
  const r = await get<{ imdb_id?: string }>(`/${kind(type)}/${tmdbId}/external_ids`);
  return r.imdb_id || undefined;
}

export interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official: boolean;
  name: string;
}

/** Best YouTube trailer/teaser for autoplay promos (official trailer > trailer > teaser). */
export async function trailerKey(tmdbId: number, type: MediaType | string): Promise<string | undefined> {
  const r = await get<{ results: TmdbVideo[] }>(`/${kind(type)}/${tmdbId}/videos`);
  const yt = r.results.filter((v) => v.site === 'YouTube');
  const rank = (v: TmdbVideo) => (v.type === 'Trailer' ? 2 : v.type === 'Teaser' ? 1 : 0) + (v.official ? 0.5 : 0);
  return yt.sort((a, b) => rank(b) - rank(a))[0]?.key;
}

/** Title logo (Apple TV style wordmark over the backdrop). */
export async function logo(tmdbId: number, type: MediaType | string): Promise<string | undefined> {
  const r = await get<{ logos: { file_path: string; iso_639_1: string | null }[] }>(
    `/${kind(type)}/${tmdbId}/images?include_image_language=en,null`,
  );
  const l = r.logos.find((x) => x.iso_639_1 === 'en') ?? r.logos[0];
  return img(l?.file_path, 'w500');
}

/** "More like this" — TMDB recommendations, falling back to similar titles. */
export async function moreLikeThis(tmdbId: number, type: MediaType | string): Promise<TmdbTitle[]> {
  const k = kind(type);
  const rec = await get<{ results: TmdbTitle[] }>(`/${k}/${tmdbId}/recommendations`);
  const list = rec.results.length
    ? rec.results
    : (await get<{ results: TmdbTitle[] }>(`/${k}/${tmdbId}/similar`)).results;
  return list.filter((t) => t.poster_path).map((t) => ({ ...t, media_type: k }));
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

export async function cast(tmdbId: number, type: MediaType | string): Promise<CastMember[]> {
  if (kind(type) === 'movie') {
    const r = await get<{ cast: CastMember[] }>(`/movie/${tmdbId}/credits`);
    return r.cast.slice(0, 20);
  }
  const r = await get<{ cast: (CastMember & { roles: { character: string }[] })[] }>(
    `/tv/${tmdbId}/aggregate_credits`,
  );
  return r.cast.slice(0, 20).map((c) => ({ ...c, character: c.roles?.[0]?.character ?? '' }));
}

export interface Person {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
  combined_credits: { cast: TmdbTitle[]; crew: TmdbTitle[] };
}

/** "Where have I seen them?" — the actor's filmography, most notable first. */
export async function person(id: number) {
  const p = await get<Person>(`/person/${id}?append_to_response=combined_credits`);
  const seen = new Set<string>();
  const credits = p.combined_credits.cast
    .filter((c) => c.poster_path && (c.media_type === 'movie' || c.media_type === 'tv'))
    // Skip talk-show / self appearances which dominate TV credits.
    .filter((c) => !/^(himself|herself|themselves|self)\b/i.test(c.character ?? ''))
    .filter((c) => (seen.has(`${c.media_type}${c.id}`) ? false : (seen.add(`${c.media_type}${c.id}`), true)));
  const notability = (t: TmdbTitle) => (t.vote_average ?? 0) * Math.log1p(t.vote_count ?? 0);
  const byPopularity = [...credits].sort((a, b) => notability(b) - notability(a));
  const byDate = [...credits].sort((a, b) =>
    (b.release_date || b.first_air_date || '').localeCompare(a.release_date || a.first_air_date || ''),
  );
  return { person: p, knownFor: byPopularity.slice(0, 12), filmography: byDate };
}

export async function trending(): Promise<TmdbTitle[]> {
  const r = await get<{ results: TmdbTitle[] }>(`/trending/all/week`);
  return r.results.filter((t) => t.backdrop_path && (t.media_type === 'movie' || t.media_type === 'tv'));
}

export const titleOf = (t: TmdbTitle) => t.title ?? t.name ?? '';
export const yearOf = (t: TmdbTitle) => (t.release_date || t.first_air_date || '').slice(0, 4);
