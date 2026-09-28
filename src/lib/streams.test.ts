import { describe, expect, it } from 'vitest';
import { cacheState, nextEpisode, parseQuality, parseSizeGb, pickAutoplay, rankStreams } from './streams';
import type { SourcedStream, Video } from './types';

const s = (name: string, title: string, extra: Partial<SourcedStream> = {}): SourcedStream => ({
  name,
  title,
  url: 'https://rd.example/file',
  addonName: 'Torrentio',
  addonUrl: 'x',
  ...extra,
});

describe('stream parsing', () => {
  it('detects quality and size', () => {
    expect(parseQuality('Torrentio\n4k DV')).toBe(2160);
    expect(parseQuality('1080p WEB-DL')).toBe(1080);
    expect(parseSizeGb('💾 12.3 GB')).toBeCloseTo(12.3);
    expect(parseSizeGb('💾 700 MB')).toBeCloseTo(0.68, 1);
  });

  it('reads debrid cache markers from popular addons', () => {
    expect(cacheState('[RD+] Torrentio 1080p')).toBe('cached');
    expect(cacheState('[RD download] Torrentio 1080p')).toBe('uncached');
    expect(cacheState('[TB+] Torrentio')).toBe('cached');
    expect(cacheState('Comet ⚡ RD')).toBe('cached');
    expect(cacheState('MediaFusion ⏳ RD')).toBe('uncached');
    expect(cacheState('Some direct link')).toBe('unknown');
  });
});

describe('rankStreams', () => {
  it('prefers cached, browser-friendly, preferred-quality debrid links', () => {
    const ranked = rankStreams(
      [
        s('[RD download] Torrentio\n1080p', 'Movie.1080p.WEB.x264.mp4 💾 3 GB'),
        s('[RD+] Torrentio\n4k', 'Movie.2160p.HEVC.DTS.mkv 💾 60 GB'),
        s('[RD+] Torrentio\n1080p', 'Movie.1080p.WEB.x264.mp4 💾 3 GB'),
        { name: 'Torrentio\n1080p', title: 'p2p', infoHash: 'abc', addonName: 'Torrentio', addonUrl: 'x' },
      ],
      { preferredQuality: 1080 },
    );
    expect(ranked[0].name).toBe('[RD+] Torrentio\n1080p');
    expect(ranked[0].deviceFriendly).toBe(true);
    expect(ranked.at(-1)?.debrid).toBe(false);
  });

  it('on a Raspberry Pi (mpv) prefers hardware-decoded HEVC and avoids 4K H.264 / AV1 / DV-only', () => {
    const ranked = rankStreams(
      [
        s('[RD+] T\n2160p', 'Movie.2160p.WEB.x264.mkv 💾 20 GB'),
        s('[RD+] T\n1080p', 'Movie.1080p.WEB.AV1.mkv 💾 2 GB'),
        s('[RD+] T\n2160p', 'Movie.2160p.DV.HEVC.mkv 💾 15 GB'),
        s('[RD+] T\n1080p', 'Movie.1080p.BluRay.x265.DTS.mkv 💾 6 GB'),
        s('[RD+] T\n1080p', 'Movie.1080p.WEB.x264.mkv 💾 3 GB'),
      ],
      { preferredQuality: 1080, backend: 'mpv' },
    );
    expect(ranked[0].title).toContain('x265.DTS.mkv');
    expect(ranked[1].title).toContain('1080p.WEB.x264');
    const bad = ranked.filter((r) => !r.deviceFriendly).map((r) => r.title);
    expect(bad).toEqual(expect.arrayContaining([expect.stringContaining('AV1'), expect.stringContaining('2160p.WEB.x264'), expect.stringContaining('DV.HEVC')]));
  });

  it('keeps the same binge group for the next episode', () => {
    const ranked = rankStreams([
      s('[RD+] A\n1080p', 'x264 mp4', { behaviorHints: { bingeGroup: 'torrentio|1080p|WEB' } }),
      s('[RD+] B\n720p', 'x264 mp4', { behaviorHints: { bingeGroup: 'torrentio|720p|HDTV' } }),
    ]);
    expect(pickAutoplay(ranked, 'torrentio|720p|HDTV')?.name).toBe('[RD+] B\n720p');
    expect(pickAutoplay(ranked, 'missing')?.name).toBe('[RD+] A\n1080p');
  });

  it('never autoplays uncached or torrent-only results', () => {
    const ranked = rankStreams([s('[RD download] T\n1080p', '')]);
    expect(pickAutoplay(ranked)).toBeUndefined();
  });
});

describe('nextEpisode', () => {
  const eps: Video[] = [
    { id: 'tt1:1:2', season: 1, episode: 2 },
    { id: 'tt1:0:1', season: 0, episode: 1 },
    { id: 'tt1:2:1', season: 2, episode: 1 },
    { id: 'tt1:1:1', season: 1, episode: 1 },
    { id: 'tt1:2:2', season: 2, episode: 2, released: '2999-01-01T00:00:00Z' },
  ];
  it('walks episodes in order across seasons, skipping specials', () => {
    expect(nextEpisode(eps, 'tt1:1:1')?.id).toBe('tt1:1:2');
    expect(nextEpisode(eps, 'tt1:1:2')?.id).toBe('tt1:2:1');
  });
  it('does not offer unreleased episodes', () => {
    expect(nextEpisode(eps, 'tt1:2:1')).toBeUndefined();
  });
});
