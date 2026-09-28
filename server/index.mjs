// Minimal server: keeps the Trakt client secret off the browser and serves the built app.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as player from './player.mjs';

try {
  process.loadEnvFile?.(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env — rely on the real environment */
}

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_ID = process.env.TRAKT_CLIENT_ID ?? process.env.VITE_TRAKT_CLIENT_ID;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

async function body(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

async function trakt(path, payload) {
  const r = await fetch(`https://api.trakt.tv${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': CLIENT_ID },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return { status: r.status, text };
}

const routes = {
  'POST /api/trakt/device/code': () => trakt('/oauth/device/code', { client_id: CLIENT_ID }),
  'POST /api/trakt/device/token': async (req) => {
    const { code } = await body(req);
    return trakt('/oauth/device/token', { code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  },
  'POST /api/trakt/refresh': async (req) => {
    const { refresh_token } = await body(req);
    return trakt('/oauth/token', {
      refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'refresh_token',
    });
  },
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('Not built — run `npm run build` first');
  }
}

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const sendJson = (res, status, data) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

// TV bootstrap: sign-in details from .env so nobody has to type an email/password with a remote.
let stremioAuth = null;
async function bootstrap() {
  const { STREMIO_EMAIL: email, STREMIO_PASSWORD: password, MEDIAHUB_ADDONS = '' } = process.env;
  if (email && password && !stremioAuth) {
    const r = await fetch('https://api.strem.io/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Login', email, password, facebook: false }),
    }).then((x) => x.json());
    if (r.result?.authKey) stremioAuth = { authKey: r.result.authKey, email: r.result.user?.email ?? email };
    else console.warn('Stremio login from .env failed:', r.error?.message ?? r);
  }
  return {
    stremio: stremioAuth,
    addonUrls: MEDIAHUB_ADDONS.split(',').map((u) => u.trim()).filter(Boolean),
  };
}

// Local mpv playback (TV mode). Only the browser running on this machine may drive it.
async function playerRoute(req, res, path) {
  if (path === '/api/player/status') return sendJson(res, 200, { available: player.mpvAvailable && isLocal(req) });
  if (!isLocal(req)) return sendJson(res, 403, { error: 'Player control is only available on the device itself' });
  if (!player.mpvAvailable) return sendJson(res, 501, { error: 'mpv is not installed' });
  if (path === '/api/player/events' && req.method === 'GET') return player.subscribe(res);
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
  const payload = await body(req);
  if (path === '/api/player/play') return sendJson(res, 200, await player.play(payload));
  if (path === '/api/player/command') {
    player.command(payload.name, payload.value, payload.extra);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: 'Unknown player route' });
}

createServer(async (req, res) => {
  const path = req.url?.split('?')[0] ?? '/';
  if (path === '/api/bootstrap') {
    if (!isLocal(req)) return sendJson(res, 200, { stremio: null, addonUrls: [] });
    return bootstrap().then((b) => sendJson(res, 200, b), (e) => sendJson(res, 502, { error: String(e) }));
  }
  if (path.startsWith('/api/player/')) {
    return playerRoute(req, res, path).catch((e) => sendJson(res, 400, { error: String(e.message ?? e) }));
  }
  const route = routes[`${req.method} ${path}`];
  if (!route) return serveStatic(req, res);
  if (!CLIENT_ID || !CLIENT_SECRET) return sendJson(res, 501, { error: 'Trakt not configured' });
  try {
    const { status, text } = await route(req);
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(text || '{}');
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}).listen(PORT, () =>
  console.log(`media-hub server on http://localhost:${PORT}${player.mpvAvailable ? ' (mpv TV playback available)' : ''}`),
);
