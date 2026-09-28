import { TRAKT_CLIENT_ID } from '../config';
import { load, save } from './storage';

const API = 'https://api.trakt.tv';

export interface TraktToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: number;
}

export const traktEnabled = () => Boolean(TRAKT_CLIENT_ID);
export const getTraktToken = () => load<TraktToken | null>('trakt', null);
export const setTraktToken = (t: TraktToken | null) => save('trakt', t);

// ---------- Device OAuth (token exchange goes through our server, which holds the secret) ----------

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export async function startDeviceAuth(): Promise<DeviceCode> {
  const r = await fetch('/api/trakt/device/code', { method: 'POST' });
  if (!r.ok) throw new Error('Could not start Trakt sign-in');
  return r.json();
}

/** Polls until the user approves the code on trakt.tv/activate. */
export async function pollDeviceAuth(code: DeviceCode, signal: AbortSignal): Promise<TraktToken> {
  const deadline = Date.now() + code.expires_in * 1000;
  let interval = code.interval * 1000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, interval));
    if (signal.aborted) throw new Error('aborted');
    const r = await fetch('/api/trakt/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.device_code }),
    });
    if (r.status === 200) {
      const token = (await r.json()) as TraktToken;
      setTraktToken(token);
      return token;
    }
    if (r.status === 429) interval += 1000; // slow down
    else if (r.status !== 400) throw new Error(`Trakt sign-in failed (${r.status})`);
  }
  throw new Error('Trakt code expired');
}

async function freshToken(): Promise<TraktToken | null> {
  const t = getTraktToken();
  if (!t) return null;
  const expiresAt = (t.created_at + t.expires_in) * 1000;
  if (Date.now() < expiresAt - 24 * 3600 * 1000) return t;
  const r = await fetch('/api/trakt/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: t.refresh_token }),
  });
  if (!r.ok) {
    setTraktToken(null);
    return null;
  }
  const next = (await r.json()) as TraktToken;
  setTraktToken(next);
  return next;
}

async function trakt<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await freshToken();
  if (!token || !TRAKT_CLIENT_ID) return null;
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID,
      Authorization: `Bearer ${token.access_token}`,
      ...init.headers,
    },
  });
  if (r.status === 401) setTraktToken(null);
  if (!r.ok) return null;
  return r.status === 204 ? null : ((await r.json()) as T);
}

// ---------- Scrobbling ----------

export type TraktItem =
  | { kind: 'movie'; imdb: string }
  | { kind: 'episode'; showImdb: string; season: number; episode: number };

export function scrobbleBody(item: TraktItem, progress: number) {
  const p = Math.max(0, Math.min(100, Math.round(progress * 100) / 100));
  return item.kind === 'movie'
    ? { movie: { ids: { imdb: item.imdb } }, progress: p }
    : {
        show: { ids: { imdb: item.showImdb } },
        episode: { season: item.season, number: item.episode },
        progress: p,
      };
}

/** start → pause → start … → stop. Trakt marks the item watched when stop arrives at >= 80%. */
export function scrobble(action: 'start' | 'pause' | 'stop', item: TraktItem, progress: number) {
  return trakt(`/scrobble/${action}`, {
    method: 'POST',
    body: JSON.stringify(scrobbleBody(item, progress)),
    keepalive: action === 'stop', // survive tab close
  });
}

// ---------- Ratings (1–10) ----------

export function ratingBody(item: TraktItem, rating: number, rateShow = false) {
  const rated_at = new Date().toISOString();
  if (item.kind === 'movie') return { movies: [{ ids: { imdb: item.imdb }, rating, rated_at }] };
  if (rateShow) return { shows: [{ ids: { imdb: item.showImdb }, rating, rated_at }] };
  return {
    shows: [
      {
        ids: { imdb: item.showImdb },
        seasons: [{ number: item.season, episodes: [{ number: item.episode, rating, rated_at }] }],
      },
    ],
  };
}

export function rate(item: TraktItem, rating: number, rateShow = false) {
  return trakt('/sync/ratings', { method: 'POST', body: JSON.stringify(ratingBody(item, rating, rateShow)) });
}

// ---------- Personalised rows ----------

interface TraktIds {
  trakt: number;
  imdb?: string;
  tmdb?: number;
}
export interface TraktRec {
  title: string;
  year: number;
  ids: TraktIds;
}

export async function recommendations(type: 'movies' | 'shows'): Promise<TraktRec[]> {
  return (await trakt<TraktRec[]>(`/recommendations/${type}?limit=25&ignore_collected=true&ignore_watchlisted=false`)) ?? [];
}

export interface TraktPlayback {
  progress: number;
  paused_at: string;
  type: 'movie' | 'episode';
  movie?: TraktRec;
  show?: TraktRec;
  episode?: { season: number; number: number; title: string };
}

export async function playback(): Promise<TraktPlayback[]> {
  return (await trakt<TraktPlayback[]>('/sync/playback?limit=20')) ?? [];
}
