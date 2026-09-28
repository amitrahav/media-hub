import { load, save } from './storage';

export interface WatchEntry {
  id: string; // meta id (tt… for Cinemeta)
  type: string;
  videoId: string; // episode id for series, same as id for movies
  name: string;
  poster?: string;
  background?: string;
  episodeLabel?: string;
  time: number;
  duration: number;
  bingeGroup?: string;
  /** Queued by finishing the previous episode — shows as "Up next" in Continue Watching. */
  upNext?: boolean;
  updatedAt: number;
}

const KEY = 'progress';

export function allProgress(): WatchEntry[] {
  return Object.values(load<Record<string, WatchEntry>>(KEY, {})).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProgress(videoId: string): WatchEntry | undefined {
  return load<Record<string, WatchEntry>>(KEY, {})[videoId];
}

export function putProgress(entry: WatchEntry) {
  const all = load<Record<string, WatchEntry>>(KEY, {});
  // One "continue watching" entry per title: drop older episodes of the same show.
  for (const [k, v] of Object.entries(all)) if (v.id === entry.id && k !== entry.videoId) delete all[k];
  all[entry.videoId] = entry;
  save(KEY, all);
}

export function clearProgress(videoId: string) {
  const all = load<Record<string, WatchEntry>>(KEY, {});
  delete all[videoId];
  save(KEY, all);
}

/** Items worth resuming: started and not finished, or the next episode of a show in progress. */
export function continueWatching(): WatchEntry[] {
  return allProgress().filter(
    (e) => e.upNext || (e.duration > 0 && e.time > 60 && e.time / e.duration < 0.92),
  );
}
