import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultAddonUrls, fetchManifest, stremioAddonCollection } from '../lib/stremio';
import { load, save } from '../lib/storage';
import type { Addon } from '../lib/types';

export interface Settings {
  preferredQuality: number;
  autoplayNext: boolean;
  autoplayPreviews: boolean;
  introSting: boolean;
  askRating: boolean;
}

const defaultSettings: Settings = {
  preferredQuality: 1080,
  autoplayNext: true,
  autoplayPreviews: true,
  introSting: true,
  askRating: true,
};

interface StremioAuth {
  authKey: string;
  email: string;
}

interface AppState {
  addons: Addon[];
  addonsLoading: boolean;
  stremio: StremioAuth | null;
  setStremio: (a: StremioAuth | null) => void;
  extraAddonUrls: string[];
  setExtraAddonUrls: (urls: string[]) => void;
  reloadAddons: () => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [stremio, setStremioState] = useState<StremioAuth | null>(() => load('stremio', null));
  const [extraAddonUrls, setExtraState] = useState<string[]>(() => load('addons', []));
  const [settings, setSettings] = useState<Settings>(() => ({ ...defaultSettings, ...load('settings', {}) }));
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonsLoading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list: Addon[] = [];
      if (stremio) {
        try {
          list.push(...(await stremioAddonCollection(stremio.authKey)));
        } catch (e) {
          console.warn('Stremio addon sync failed', e);
        }
      }
      const known = new Set(list.map((a) => a.transportUrl));
      const manual = [...defaultAddonUrls, ...extraAddonUrls].filter((u) => !known.has(u));
      const fetched = await Promise.allSettled(manual.map(fetchManifest));
      for (const r of fetched) if (r.status === 'fulfilled') list.push(r.value);
      if (!cancelled) {
        setAddons(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stremio, extraAddonUrls, reloadTick]);

  const setStremio = useCallback((a: StremioAuth | null) => {
    save('stremio', a);
    setStremioState(a);
  }, []);
  const setExtraAddonUrls = useCallback((urls: string[]) => {
    save('addons', urls);
    setExtraState(urls);
  }, []);
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      save('settings', next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      addons,
      addonsLoading,
      stremio,
      setStremio,
      extraAddonUrls,
      setExtraAddonUrls,
      reloadAddons: () => setReloadTick((n) => n + 1),
      settings,
      updateSettings,
    }),
    [addons, addonsLoading, stremio, setStremio, extraAddonUrls, setExtraAddonUrls, settings, updateSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export const hasStreamAddon = (addons: Addon[]) =>
  addons.some((a) => a.manifest.resources.some((r) => (typeof r === 'string' ? r : r.name) === 'stream'));
