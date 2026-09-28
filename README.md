# Media Hub

A Netflix / Apple TV–style front-end built on top of **Stremio** — your Stremio account and addons
(including debrid-configured stream addons) power the catalog and playback, while TMDB and Trakt add
the discovery and tracking layer.

## What you get

| Experience | How it works |
| --- | --- |
| **Launch sting** | Short animated intro once per session (toggle in Settings). |
| **Auto-playing promos** | Home hero and every title page fade from the backdrop into a muted, chrome-less trailer (TMDB → YouTube), with an unmute button. Hovering a poster for a moment expands a Netflix-style preview card that plays the trailer. |
| **Play next by default** | During the last ~45 s of an episode a "Next episode" card counts down and autoplays. The next episode stays in the same Stremio `bingeGroup` (same addon / release / quality) so a binge doesn't jump sources. Streams for the next episode are prefetched while the credits roll. "Watch credits" dismisses it. |
| **More Like This** | TMDB recommendations on every title page and in the movie post-play screen. |
| **Where have I seen them?** | Cast & Crew tab → actor page with *Known For* and a full, clickable filmography (talk-show "self" appearances filtered out). Any title there opens straight into a playable page. |
| **Trakt scrobbling** | `scrobble/start` when playback starts, `pause` on pause, `stop` on end / leaving the player; Trakt marks ≥ 80 % as watched. Continue Watching merges local progress with Trakt's paused items from other devices; "Top Picks for You" rows come from Trakt recommendations. |
| **Rate after watching** | Once you pass 80 %, a 1–10 rating (Trakt's scale & labels) is offered — inline on the next-episode card for episodes, or on the post-play screen for movies and series finales (with a "whole series" option). |
| **Debrid-first playback** | Streams from all your addons are ranked: cached debrid links first, then browser-friendly codecs, closest to your preferred quality. The best one autoplays; a Sources drawer lets you switch, and a file the browser can't decode automatically falls through to the next cached link. "Open in Stremio" / "Open in VLC" are there for HEVC/DTS/MKV files. |

## Architecture

```
Browser (React + Vite)
 ├─ Stremio API (api.strem.io)        login + your installed addon collection
 ├─ Stremio addons (addon protocol)   catalogs, meta, streams  ← Torrentio/Comet/MediaFusion/Torbox with your debrid key
 ├─ TMDB                              trailers, logos, recommendations, cast, filmographies
 ├─ Trakt                             scrobble, ratings, recommendations, playback progress
 └─ /api/trakt/*  ─► server/index.mjs  OAuth device-code + token refresh (keeps the client secret server-side)
```

Key files:

- `src/lib/stremio.ts` — Stremio account + addon protocol client
- `src/lib/streams.ts` — debrid cache detection, stream ranking, binge-group autoplay, next-episode logic
- `src/lib/trakt.ts` — device auth, scrobbling, ratings, recommendations
- `src/lib/tmdb.ts` — trailers, logos, "More like this", cast and person credits
- `src/components/Player.tsx` — player, scrobbling, next-up countdown, post-play
- `src/components/TrailerBackdrop.tsx` — backdrop → trailer cross-fade

## Setup

1. `cp .env.example .env` and fill in:
   - `VITE_TMDB_TOKEN` — TMDB v4 read-access token.
   - Trakt app from <https://trakt.tv/oauth/applications> (redirect URI `urn:ietf:wg:oauth:2.0:oob`):
     `VITE_TRAKT_CLIENT_ID`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`.
2. `npm install`
3. `npm run dev` → <http://localhost:5173>
4. In **Settings**: sign in with your Stremio account (your addons sync automatically) **or** paste the
   manifest URL of a debrid-configured stream addon (e.g. Torrentio configured with Real-Debrid). Then
   **Connect Trakt** and enter the code at trakt.tv/activate.

Production: `npm run build && npm start` (serves `dist/` and the Trakt endpoints on `PORT`, default 8787).

Checks: `npm run typecheck`, `npm test`.

## Notes & limitations

- Browsers can't decode every file a debrid service returns (HEVC, DTS/TrueHD, some MKVs). Ranking prefers
  web-friendly files, and the Sources drawer offers Stremio / VLC hand-off for the rest. Wrapping the app in
  Electron/Tauri with mpv would remove that limit.
- There's no public intro/credits-marker data, so "next up" timing uses the last 45 s (or 10 % of short
  videos) instead of real credit timestamps.
- The Stremio auth key and Trakt token live in `localStorage`. Treat the deployment as personal.
