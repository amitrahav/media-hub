// Drives a local mpv process for the TV (Raspberry Pi) mode. The web app stays in charge of the
// experience — Trakt scrobbling, next-episode countdown, ratings — and mpv just does the decoding.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MPV = process.env.MPV_PATH ?? 'mpv';
const SOCKET = join(tmpdir(), `media-hub-mpv-${process.pid}.sock`);
const CONF_DIR = fileURLToPath(new URL('./mpv/', import.meta.url));
const EXTRA_ARGS = (process.env.MPV_EXTRA_ARGS ?? '').split(' ').filter(Boolean);

export const mpvAvailable = (() => {
  try {
    return spawnSync(MPV, ['--version'], { timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
})();

let proc = null;
let sock = null;
let session = 0;
let stopTimer = null;
let reqId = 0;
const state = { session: 0, time: 0, duration: 0, paused: false, eof: false, loaded: false };
const listeners = new Set();

function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of listeners) res.write(line);
}

let lastTimeSent = 0;
function pushState(force = false) {
  if (!force && Date.now() - lastTimeSent < 250) return;
  lastTimeSent = Date.now();
  broadcast({ type: 'state', ...state });
}

function send(command) {
  if (!sock) return;
  sock.write(JSON.stringify({ command, request_id: ++reqId }) + '\n');
}

function onMpvMessage(msg) {
  if (msg.event === 'property-change') {
    const v = msg.data;
    if (msg.name === 'time-pos' && typeof v === 'number') state.time = v;
    else if (msg.name === 'duration' && typeof v === 'number') (state.duration = v), pushState(true);
    else if (msg.name === 'pause') (state.paused = Boolean(v)), pushState(true);
    else if (msg.name === 'eof-reached') (state.eof = Boolean(v)), pushState(true);
    pushState();
  } else if (msg.event === 'file-loaded') {
    state.loaded = true;
    state.eof = false;
    pushState(true);
  } else if (msg.event === 'end-file' && msg.reason === 'error') {
    broadcast({ type: 'error', session: state.session, message: msg.file_error ?? 'playback error' });
  } else if (msg.event === 'client-message' && msg.args?.[0] === 'mh' && msg.args[1] === 'key') {
    broadcast({ type: 'key', session: state.session, key: msg.args[2] });
  }
}

function attachSocket(retries = 50) {
  return new Promise((resolve, reject) => {
    const tryConnect = (left) => {
      if (!existsSync(SOCKET)) {
        if (left <= 0) return reject(new Error('mpv IPC socket never appeared'));
        return setTimeout(() => tryConnect(left - 1), 100);
      }
      const s = connect(SOCKET);
      let buf = '';
      s.on('connect', () => {
        sock = s;
        for (const [i, name] of ['time-pos', 'duration', 'pause', 'eof-reached'].entries())
          send(['observe_property', i + 1, name]);
        resolve();
      });
      s.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          try {
            onMpvMessage(JSON.parse(line));
          } catch {
            /* ignore partial / non-JSON lines */
          }
        }
      });
      s.on('error', () => (left > 0 ? setTimeout(() => tryConnect(left - 1), 100) : reject(new Error('mpv IPC failed'))));
      s.on('close', () => sock === s && (sock = null));
    };
    tryConnect(retries);
  });
}

function startProcess() {
  rmSync(SOCKET, { force: true });
  proc = spawn(
    MPV,
    [
      `--include=${join(CONF_DIR, 'mpv.conf')}`,
      `--input-conf=${join(CONF_DIR, 'input.conf')}`,
      `--input-ipc-server=${SOCKET}`,
      '--idle=yes',
      ...EXTRA_ARGS,
    ],
    { stdio: 'ignore' },
  );
  const p = proc;
  p.on('exit', () => {
    if (proc !== p) return;
    proc = null;
    sock = null;
    state.loaded = false;
    broadcast({ type: 'exit', session: state.session });
  });
  return attachSocket();
}

export async function play({ url, title, startAt = 0 }) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) streams can be played');
  clearTimeout(stopTimer);
  if (!proc || !sock) await startProcess();
  session += 1;
  Object.assign(state, { session, time: startAt, duration: 0, paused: false, eof: false, loaded: false });
  // `start` / `force-media-title` are options: setting them before loadfile applies them to the
  // next file and works on every mpv version (loadfile's argument list changed in 0.38).
  send(['set_property', 'start', startAt > 0 ? `+${Math.floor(startAt)}` : 'none']);
  send(['set_property', 'force-media-title', title ?? '']);
  send(['set_property', 'pause', false]);
  send(['loadfile', url, 'replace']);
  pushState(true);
  return { session };
}

const commands = {
  pause: () => send(['set_property', 'pause', true]),
  resume: () => send(['set_property', 'pause', false]),
  toggle: () => send(['cycle', 'pause']),
  seek: (v) => send(['seek', Number(v) || 0, 'absolute']),
  seekBy: (v) => send(['seek', Number(v) || 0, 'relative']),
  osd: (v, ms = 3000) => send(['show-text', String(v ?? ''), Number(ms)]),
  stop: (graceMs = 0) => {
    // A short grace period lets "next episode" reuse the window instead of flashing the desktop.
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      send(['quit']);
      setTimeout(() => proc?.kill(), 1500);
    }, Number(graceMs) || 0);
  },
};

export function command(name, value, extra) {
  const fn = commands[name];
  if (!fn) throw new Error(`Unknown command ${name}`);
  fn(value, extra);
}

export function subscribe(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'state', ...state })}\n\n`);
  listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => {
    clearInterval(ping);
    listeners.delete(res);
  });
}

process.on('exit', () => proc?.kill());
