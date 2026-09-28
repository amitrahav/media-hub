import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PosterGrid } from '../components/Row';
import { useApp } from '../state/AppState';
import { search } from '../lib/stremio';
import { fromMeta, type Tile } from '../lib/tiles';

export function SearchPage() {
  const { addons } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [results, setResults] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(async () => {
      setLoading(true);
      const metas = await search(addons, q.trim());
      setResults(metas.map(fromMeta));
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, addons]);

  return (
    <main className="page page--padded">
      <input
        autoFocus
        className="search-input"
        placeholder="Movies, shows…"
        value={q}
        onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
      />
      {loading && <div className="spinner" />}
      <PosterGrid tiles={results} />
    </main>
  );
}
