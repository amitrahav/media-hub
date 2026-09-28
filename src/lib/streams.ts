import type { SourcedStream, Video } from './types';

export interface RankedStream extends SourcedStream {
  quality: number; // vertical resolution
  cached: boolean; // instantly available on the debrid service
  debrid: boolean; // resolves to an HTTP url (debrid / direct), not a raw torrent
  browserFriendly: boolean; // likely to play in a <video> element
  sizeGb?: number;
  label: string;
}

const text = (s: SourcedStream) =>
  `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''} ${s.behaviorHints?.filename ?? ''}`;

export function parseQuality(t: string): number {
  if (/2160p|\b4k\b|uhd/i.test(t)) return 2160;
  if (/1440p/i.test(t)) return 1440;
  if (/1080p|\bfhd\b/i.test(t)) return 1080;
  if (/720p|\bhd\b/i.test(t)) return 720;
  if (/576p|480p|\bsd\b/i.test(t)) return 480;
  return 0;
}

export function parseSizeGb(t: string): number | undefined {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(',', '.'));
  return m[2].toUpperCase() === 'MB' ? n / 1024 : n;
}

/**
 * Torrentio `[RD+]` / `[RD download]`, Comet & MediaFusion `⚡` / `⏳`, Torbox `Instant` etc.
 * Direct HTTP streams with no marker are assumed ready.
 */
export function cacheState(t: string): 'cached' | 'uncached' | 'unknown' {
  if (/\[(RD|AD|PM|DL|TB|OC|ED|PK)\s*download\]|⏳|uncached|not cached/i.test(t)) return 'uncached';
  if (/\[(RD|AD|PM|DL|TB|OC|ED|PK)\+\]|⚡|\binstant\b|\bcached\b/i.test(t)) return 'cached';
  return 'unknown';
}

export function rankStreams(streams: SourcedStream[], preferredQuality = 1080): RankedStream[] {
  return streams
    .filter((s) => s.url || s.infoHash || s.externalUrl)
    .map((s) => {
      const t = text(s);
      const quality = parseQuality(t);
      const debrid = Boolean(s.url);
      const hevc = /hevc|x265|h\.?265|\bav1\b/i.test(t);
      const heavyAudio = /\btruehd\b|\bdts\b|atmos/i.test(t);
      const container = /\.mkv\b|\bmkv\b/i.test(t) ? 'mkv' : /\.mp4\b|\bmp4\b/i.test(t) ? 'mp4' : '';
      const browserFriendly =
        debrid && !s.behaviorHints?.notWebReady && !hevc && !heavyAudio && container !== 'mkv';
      return {
        ...s,
        quality,
        debrid,
        cached: debrid && cacheState(t) !== 'uncached',
        browserFriendly,
        sizeGb: parseSizeGb(t),
        label: `${quality ? (quality === 2160 ? '4K' : `${quality}p`) : 'SD'}${hevc ? ' · HEVC' : ''}`,
      };
    })
    .sort((a, b) => score(b, preferredQuality) - score(a, preferredQuality));
}

function score(s: RankedStream, preferred: number): number {
  let n = 0;
  if (s.debrid) n += 1000;
  if (s.cached) n += 500;
  if (s.browserFriendly) n += 200;
  // Closest to the preferred resolution wins, overshooting is penalised less than undershooting.
  const diff = s.quality - preferred;
  n += diff >= 0 ? 100 - diff / 20 : 100 + diff / 5;
  // Among equals, prefer moderately sized files (fast start, less buffering).
  if (s.sizeGb) n -= Math.min(s.sizeGb, 40) / 4;
  return n;
}

/**
 * Pick the stream for autoplay. When moving to the next episode, stay in the same Stremio
 * `bingeGroup` (same addon + release group + quality) so the binge feels seamless.
 */
export function pickAutoplay(ranked: RankedStream[], bingeGroup?: string): RankedStream | undefined {
  const playable = ranked.filter((s) => s.debrid && s.cached);
  if (bingeGroup) {
    const same = playable.find((s) => s.behaviorHints?.bingeGroup === bingeGroup);
    if (same) return same;
  }
  return playable[0];
}

// ---------- Episodes ----------

export function sortEpisodes(videos: Video[]): Video[] {
  return [...videos].sort(
    (a, b) =>
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0),
  );
}

/** Next episode after `videoId`, skipping specials (season 0) and unreleased episodes. */
export function nextEpisode(videos: Video[], videoId: string, now = Date.now()): Video | undefined {
  const eps = sortEpisodes(videos).filter((v) => (v.season ?? 0) > 0);
  const i = eps.findIndex((v) => v.id === videoId);
  if (i < 0) return undefined;
  const next = eps[i + 1];
  if (!next) return undefined;
  if (next.released && Date.parse(next.released) > now) return undefined;
  return next;
}

export function episodeNumber(v: Video): number {
  return v.episode ?? v.number ?? 0;
}

export function episodeLabel(v: Video): string {
  return `S${v.season} · E${episodeNumber(v)}`;
}
