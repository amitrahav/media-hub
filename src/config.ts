export const TMDB_TOKEN = import.meta.env.VITE_TMDB_TOKEN as string | undefined;
export const TRAKT_CLIENT_ID = import.meta.env.VITE_TRAKT_CLIENT_ID as string | undefined;

export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
export const STREMIO_API = 'https://api.strem.io/api';

/** Seconds before the end at which the "Next episode" card appears when no credits marker is known. */
export const NEXT_UP_LEAD_SECONDS = 45;
/** Countdown length before autoplaying the next episode. */
export const NEXT_UP_COUNTDOWN = 10;
/** Trakt treats >= 80% as watched; we ask for a rating from the same threshold. */
export const WATCHED_THRESHOLD = 80;
