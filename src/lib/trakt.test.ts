import { describe, expect, it } from 'vitest';
import { ratingBody, scrobbleBody } from './trakt';

describe('trakt payloads', () => {
  it('builds movie and episode scrobbles', () => {
    expect(scrobbleBody({ kind: 'movie', imdb: 'tt0111161' }, 42.123)).toEqual({
      movie: { ids: { imdb: 'tt0111161' } },
      progress: 42.12,
    });
    expect(scrobbleBody({ kind: 'episode', showImdb: 'tt0903747', season: 5, episode: 16 }, 101)).toEqual({
      show: { ids: { imdb: 'tt0903747' } },
      episode: { season: 5, number: 16 },
      progress: 100,
    });
  });

  it('rates an episode or the whole show', () => {
    const ep = { kind: 'episode', showImdb: 'tt0903747', season: 5, episode: 16 } as const;
    const body = ratingBody(ep, 10) as { shows: { seasons: { episodes: { rating: number }[] }[] }[] };
    expect(body.shows[0].seasons[0].episodes[0].rating).toBe(10);
    const show = ratingBody(ep, 9, true) as { shows: { rating: number; seasons?: unknown }[] };
    expect(show.shows[0].rating).toBe(9);
    expect(show.shows[0].seasons).toBeUndefined();
  });
});
