// Minimal server: keeps the Trakt client secret off the browser and serves the built app.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url?.split('?')[0]}`];
  if (!route) return serveStatic(req, res);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.writeHead(501, { 'Content-Type': 'application/json' }).end('{"error":"Trakt not configured"}');
  }
  try {
    const { status, text } = await route(req);
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(text || '{}');
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
  }
}).listen(PORT, () => console.log(`media-hub server on http://localhost:${PORT}`));
