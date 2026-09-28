import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { findByImdb, img, tmdbEnabled, trailerKey } from '../lib/tmdb';
import { titleHref, type Tile } from '../lib/tiles';

export function Row({ title, tiles, variant = 'poster' }: { title: string; tiles: Tile[]; variant?: 'poster' | 'landscape' }) {
  const scroller = useRef<HTMLDivElement>(null);
  if (!tiles.length) return null;
  const page = (dir: number) =>
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="row">
      <h2 className="row__title">{title}</h2>
      <div className="row__viewport">
        <button className="row__arrow row__arrow--left" onClick={() => page(-1)} aria-label="Scroll left">‹</button>
        <div className="row__track" ref={scroller}>
          {tiles.map((t) => (
            <Card key={t.key} tile={t} variant={variant} />
          ))}
        </div>
        <button className="row__arrow row__arrow--right" onClick={() => page(1)} aria-label="Scroll right">›</button>
      </div>
    </section>
  );
}

/** Poster that, after hovering for a moment, expands into a Netflix-style preview with a muted trailer. */
function Card({ tile, variant }: { tile: Tile; variant: 'poster' | 'landscape' }) {
  const { settings } = useApp();
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [preview, setPreview] = useState<{ key?: string; backdrop?: string } | null>(null);

  const enter = () => {
    timer.current = setTimeout(async () => {
      setPreview({ backdrop: tile.background });
      if (!settings.autoplayPreviews || !tmdbEnabled()) return;
      try {
        const tmdbId = tile.tmdbId ?? (tile.id.startsWith('tt') ? (await findByImdb(tile.id, tile.type))?.id : undefined);
        if (!tmdbId) return;
        const key = await trailerKey(tmdbId, tile.type);
        setPreview((p) => p && { ...p, key });
      } catch {
        /* preview stays a still */
      }
    }, 700);
  };
  const leave = () => {
    clearTimeout(timer.current);
    setPreview(null);
  };

  const image = variant === 'landscape' ? tile.background ?? tile.poster : tile.poster ?? tile.background;
  return (
    <div className={`card card--${variant}`} onMouseEnter={enter} onMouseLeave={leave}>
      <Link to={titleHref(tile)} className="card__link">
        {image ? <img src={image} alt={tile.name} loading="lazy" /> : <div className="card__fallback">{tile.name}</div>}
        {variant === 'landscape' && <div className="card__caption">{tile.name}{tile.subtitle && <small>{tile.subtitle}</small>}</div>}
        {tile.progress !== undefined && (
          <div className="card__progress">
            <div style={{ width: `${Math.round(tile.progress * 100)}%` }} />
          </div>
        )}
      </Link>
      {preview && (
        <div className="card__preview" onClick={() => navigate(titleHref(tile))}>
          <div className="card__preview-media">
            {preview.backdrop && <img src={preview.backdrop} alt="" />}
            {preview.key && (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${preview.key}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0&start=5`}
                title="Preview"
                allow="autoplay"
              />
            )}
          </div>
          <div className="card__preview-body">
            <strong>{tile.name}</strong>
            {tile.subtitle && <span>{tile.subtitle}</span>}
            <div className="card__preview-actions">
              <span className="pill">▶ Play</span>
              <span className="pill pill--ghost">More info</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PosterGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid">
      {tiles.map((t) => (
        <Link key={t.key} to={titleHref(t)} className="grid__item">
          {t.poster ? <img src={t.poster} alt={t.name} loading="lazy" /> : <div className="card__fallback">{t.name}</div>}
          <span>{t.name}</span>
          {t.subtitle && <small>{t.subtitle}</small>}
        </Link>
      ))}
    </div>
  );
}

export const personImg = (p: string | null) => img(p, 'w185');
