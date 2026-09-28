import { useEffect, useRef, useState, type FormEvent } from 'react';
import { hasStreamAddon, useApp } from '../state/AppState';
import { stremioLogin } from '../lib/stremio';
import { getTraktToken, pollDeviceAuth, setTraktToken, startDeviceAuth, traktEnabled, type DeviceCode } from '../lib/trakt';
import { tmdbEnabled } from '../lib/tmdb';

export function SettingsPage() {
  const { stremio, setStremio, addons, extraAddonUrls, setExtraAddonUrls, reloadAddons, settings, updateSettings, mpvReady, backend } = useApp();
  return (
    <main className="page page--padded settings">
      <h1>Settings</h1>

      <section className="panel">
        <h2>Stremio account</h2>
        <p className="muted">Sign in to use your installed Stremio addons — including debrid-configured stream addons (Torrentio, Comet, MediaFusion, Torbox…).</p>
        {stremio ? (
          <div className="panel__row">
            <span>Signed in as <strong>{stremio.email}</strong></span>
            <button className="btn" onClick={reloadAddons}>Resync addons</button>
            <button className="btn" onClick={() => setStremio(null)}>Sign out</button>
          </div>
        ) : (
          <StremioLogin onLogin={setStremio} />
        )}
      </section>

      <section className="panel">
        <h2>Addons</h2>
        {!hasStreamAddon(addons) && (
          <p className="warn">No stream addon installed. Configure Torrentio / Comet with your Real-Debrid, AllDebrid, Premiumize or Torbox key and paste its manifest URL below.</p>
        )}
        <ul className="addon-list">
          {addons.map((a) => (
            <li key={a.transportUrl}>
              {a.manifest.logo && <img src={a.manifest.logo} alt="" />}
              <div>
                <strong>{a.manifest.name}</strong> <small className="muted">v{a.manifest.version}</small>
                <div className="muted">{a.manifest.resources.map((r) => (typeof r === 'string' ? r : r.name)).join(' · ')}</div>
              </div>
              {extraAddonUrls.includes(a.transportUrl) && (
                <button className="link-btn" onClick={() => setExtraAddonUrls(extraAddonUrls.filter((u) => u !== a.transportUrl))}>Remove</button>
              )}
            </li>
          ))}
        </ul>
        <AddAddon onAdd={(url) => setExtraAddonUrls([...extraAddonUrls, url])} />
      </section>

      <section className="panel">
        <h2>Trakt</h2>
        {traktEnabled() ? <TraktConnect /> : <p className="warn">Set VITE_TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET to enable Trakt.</p>}
      </section>

      <section className="panel">
        <h2>Playback</h2>
        <label className="toggle"><input type="checkbox" checked={settings.autoplayNext} onChange={(e) => updateSettings({ autoplayNext: e.target.checked })} /> Autoplay next episode</label>
        <label className="toggle"><input type="checkbox" checked={settings.autoplayPreviews} onChange={(e) => updateSettings({ autoplayPreviews: e.target.checked })} /> Autoplay trailers &amp; previews</label>
        <label className="toggle"><input type="checkbox" checked={settings.askRating} onChange={(e) => updateSettings({ askRating: e.target.checked })} /> Ask me to rate after watching (Trakt)</label>
        <label className="toggle"><input type="checkbox" checked={settings.introSting} onChange={(e) => updateSettings({ introSting: e.target.checked })} /> Play intro on launch</label>
        <label className="toggle">
          Preferred quality
          <select value={settings.preferredQuality} onChange={(e) => updateSettings({ preferredQuality: Number(e.target.value) })}>
            <option value={2160}>4K</option>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
          </select>
        </label>
        <label className="toggle">
          Player
          <select value={settings.playerBackend} onChange={(e) => updateSettings({ playerBackend: e.target.value as typeof settings.playerBackend })}>
            <option value="auto">Automatic</option>
            <option value="mpv" disabled={!mpvReady}>mpv on this device (TV / Raspberry Pi)</option>
            <option value="browser">Browser</option>
          </select>
        </label>
        <p className="muted small">
          Using <strong>{backend === 'mpv' ? 'mpv — hardware HEVC, MKV, DTS/TrueHD all play' : 'the browser player'}</strong>
          {!mpvReady && ' · mpv is used automatically when this app runs on the device the server runs on and mpv is installed'}
        </p>
        <label className="toggle"><input type="checkbox" checked={settings.tvMode} onChange={(e) => updateSettings({ tvMode: e.target.checked })} /> TV mode (remote / arrow-key navigation)</label>
        {!tmdbEnabled() && <p className="warn">Set VITE_TMDB_TOKEN to enable trailers, More Like This and cast pages.</p>}
      </section>
    </main>
  );
}

function StremioLogin({ onLogin }: { onLogin: (a: { authKey: string; email: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      onLogin(await stremioLogin(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };
  return (
    <form className="panel__row" onSubmit={submit}>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className="btn btn--primary">Sign in</button>
      {error && <span className="warn">{error}</span>}
    </form>
  );
}

function AddAddon({ onAdd }: { onAdd: (url: string) => void }) {
  const [url, setUrl] = useState('');
  return (
    <form
      className="panel__row"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = url.trim().replace(/^stremio:\/\//, 'https://');
        if (clean) onAdd(clean);
        setUrl('');
      }}
    >
      <input placeholder="https://torrentio.strem.fun/realdebrid=…/manifest.json" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn">Add addon</button>
    </form>
  );
}

function TraktConnect() {
  const [connected, setConnected] = useState(Boolean(getTraktToken()));
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController>(undefined);
  useEffect(() => () => abort.current?.abort(), []);

  const connect = async () => {
    setError('');
    try {
      const c = await startDeviceAuth();
      setCode(c);
      abort.current = new AbortController();
      await pollDeviceAuth(c, abort.current.signal);
      setConnected(true);
      setCode(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trakt sign-in failed');
      setCode(null);
    }
  };

  if (connected)
    return (
      <div className="panel__row">
        <span>Connected — scrobbling on. Your plays are reported to Trakt as you watch.</span>
        <button className="btn" onClick={() => (setTraktToken(null), setConnected(false))}>Disconnect</button>
      </div>
    );
  if (code)
    return (
      <div className="device-code">
        Go to <a href={code.verification_url} target="_blank" rel="noreferrer">{code.verification_url}</a> and enter
        <code>{code.user_code}</code>
        <small className="muted">Waiting for approval…</small>
      </div>
    );
  return (
    <div className="panel__row">
      <button className="btn btn--primary" onClick={connect}>Connect Trakt</button>
      {error && <span className="warn">{error}</span>}
    </div>
  );
}
