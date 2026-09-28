import { CINEMETA_URL, STREMIO_API } from '../config';
import type { Addon, Manifest, Meta, MetaPreview, SourcedStream, Stream } from './types';

// ---------- Stremio account API (same endpoints stremio-web uses) ----------

async function stremioApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${STREMIO_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: method.charAt(0).toUpperCase() + method.slice(1), ...body }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'Stremio API error');
  return json.result as T;
}

export async function stremioLogin(email: string, password: string) {
  const r = await stremioApi<{ authKey: string; user: { email: string } }>('login', {
    email,
    password,
    facebook: false,
  });
  return { authKey: r.authKey, email: r.user.email };
}

/** The user's installed addons — this is where debrid-configured stream addons live. */
export async function stremioAddonCollection(authKey: string): Promise<Addon[]> {
  const r = await stremioApi<{ addons: Addon[] }>('addonCollectionGet', { authKey, update: true });
  return r.addons;
}

// ---------- Addon protocol ----------

export function addonBase(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
}

export async function fetchManifest(transportUrl: string): Promise<Addon> {
  const url = transportUrl.replace(/^stremio:\/\//, 'https://');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Manifest ${res.status}`);
  return { transportUrl: url, manifest: (await res.json()) as Manifest };
}

export const defaultAddonUrls = [CINEMETA_URL];

function supports(addon: Addon, resource: string, type: string, id?: string): boolean {
  const { manifest } = addon;
  return manifest.resources.some((r) => {
    if (typeof r === 'string') {
      if (r !== resource) return false;
      if (!manifest.types.includes(type)) return false;
      return !id || !manifest.idPrefixes || manifest.idPrefixes.some((p) => id.startsWith(p));
    }
    if (r.name !== resource) return false;
    if (r.types && !r.types.includes(type)) return false;
    const prefixes = r.idPrefixes ?? manifest.idPrefixes;
    return !id || !prefixes || prefixes.some((p) => id.startsWith(p));
  });
}

const cache = new Map<string, Promise<unknown>>();
function cachedJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export interface CatalogRef {
  addon: Addon;
  type: string;
  id: string;
  title: string;
}

/** Catalogs that can be shown as a home-screen row (no required extras such as search). */
export function browsableCatalogs(addons: Addon[]): CatalogRef[] {
  return addons.flatMap((addon) =>
    (addon.manifest.catalogs ?? [])
      .filter((c) => {
        const required = [
          ...(c.extraRequired ?? []),
          ...(c.extra ?? []).filter((e) => e.isRequired).map((e) => e.name),
        ];
        return required.length === 0;
      })
      .map((c) => ({
        addon,
        type: c.type,
        id: c.id,
        title: `${c.name ?? c.id} · ${c.type === 'series' ? 'Series' : c.type === 'movie' ? 'Movies' : c.type}`,
      })),
  );
}

export async function fetchCatalog(ref: CatalogRef, extra = ''): Promise<MetaPreview[]> {
  const url = `${addonBase(ref.addon.transportUrl)}/catalog/${ref.type}/${encodeURIComponent(ref.id)}${extra ? `/${extra}` : ''}.json`;
  const r = await cachedJson<{ metas: MetaPreview[] }>(url);
  return r.metas ?? [];
}

export async function search(addons: Addon[], query: string): Promise<MetaPreview[]> {
  const refs = addons.flatMap((addon) =>
    (addon.manifest.catalogs ?? [])
      .filter((c) => (c.extra ?? []).some((e) => e.name === 'search'))
      .map((c) => ({ addon, type: c.type, id: c.id, title: c.name ?? c.id })),
  );
  const results = await Promise.allSettled(
    refs.map((ref) => fetchCatalog(ref, `search=${encodeURIComponent(query)}`)),
  );
  const seen = new Set<string>();
  return results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

export async function fetchMeta(addons: Addon[], type: string, id: string): Promise<Meta | null> {
  for (const addon of addons.filter((a) => supports(a, 'meta', type, id))) {
    try {
      const r = await cachedJson<{ meta: Meta }>(
        `${addonBase(addon.transportUrl)}/meta/${type}/${encodeURIComponent(id)}.json`,
      );
      if (r.meta) return r.meta;
    } catch {
      /* try next addon */
    }
  }
  return null;
}

/**
 * Query every stream addon in parallel. `onPartial` fires as each addon answers so the UI can
 * show results progressively (debrid addons are often slow).
 */
export async function fetchStreams(
  addons: Addon[],
  type: string,
  videoId: string,
  onPartial?: (streams: SourcedStream[]) => void,
): Promise<SourcedStream[]> {
  const all: SourcedStream[] = [];
  await Promise.allSettled(
    addons
      .filter((a) => supports(a, 'stream', type, videoId))
      .map(async (addon) => {
        const res = await fetch(
          `${addonBase(addon.transportUrl)}/stream/${type}/${encodeURIComponent(videoId)}.json`,
        );
        const json = (await res.json()) as { streams?: Stream[] };
        const sourced = (json.streams ?? []).map((s) => ({
          ...s,
          addonName: addon.manifest.name,
          addonUrl: addon.transportUrl,
        }));
        all.push(...sourced);
        onPartial?.([...all]);
      }),
  );
  return all;
}

/** Deep link that opens the same item in the official Stremio app (fallback for non-web-ready files). */
export function stremioDeepLink(type: string, id: string, videoId?: string) {
  return `stremio:///detail/${type}/${encodeURIComponent(id)}${videoId ? `/${encodeURIComponent(videoId)}` : ''}`;
}
