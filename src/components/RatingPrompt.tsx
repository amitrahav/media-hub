import { useEffect, useRef, useState } from 'react';
import { rate, type TraktItem } from '../lib/trakt';

// Trakt's own labels for its 1–10 scale.
const LABELS = ['', 'Weak Sauce :(', 'Terrible', 'Bad', 'Poor', 'Meh', 'Fair', 'Good', 'Great', 'Superb', 'Totally Ninja!'];

interface Props {
  item: TraktItem;
  title: string;
  /** For the last episode of a series, also offer to rate the whole show. */
  offerShow?: boolean;
  compact?: boolean;
  /** Put the remote's focus on the hearts (TV). */
  autoFocus?: boolean;
  onDone?: () => void;
}

/** Post-watch "How was it?" — sends a 1–10 rating to Trakt. */
export function RatingPrompt({ item, title, offerShow, compact, autoFocus, onDone }: Props) {
  const stars = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(0);
  const [rating, setRating] = useState(0);
  const [target, setTarget] = useState<'item' | 'show'>('item');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const submit = async (n: number) => {
    setRating(n);
    setState('saving');
    try {
      await rate(item, n, target === 'show');
      setState('saved');
      setTimeout(() => onDone?.(), 900);
    } catch {
      setState('error');
    }
  };

  // Number keys rate directly (remote-friendly): 1–9, 0 = 10.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (state !== 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (!/^\d$/.test(e.key) || (e.target as HTMLElement).closest('input, textarea')) return;
      void submitRef.current(e.key === '0' ? 10 : Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  useEffect(() => {
    if (autoFocus) stars.current?.querySelectorAll('button')[7]?.focus();
  }, [autoFocus]);

  const shown = hover || rating;
  return (
    <div className={`rating ${compact ? 'rating--compact' : ''}`}>
      <div className="rating__q">
        {state === 'saved' ? 'Thanks! Saved to Trakt.' : <>How was <strong>{title}</strong>?</>}
      </div>
      {offerShow && item.kind === 'episode' && state === 'idle' && (
        <div className="segmented">
          <button className={target === 'item' ? 'is-on' : ''} onClick={() => setTarget('item')}>This episode</button>
          <button className={target === 'show' ? 'is-on' : ''} onClick={() => setTarget('show')}>Whole series</button>
        </div>
      )}
      <div className="rating__stars" ref={stars} onMouseLeave={() => setHover(0)}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={n <= shown ? 'is-on' : ''}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onClick={() => submit(n)}
            disabled={state === 'saving' || state === 'saved'}
            aria-label={`${n} – ${LABELS[n]}`}
          >
            ♥
          </button>
        ))}
      </div>
      <div className="rating__label">{shown ? `${shown}/10 · ${LABELS[shown]}` : state === 'error' ? 'Could not reach Trakt' : ' '}</div>
      {onDone && state === 'idle' && (
        <button className="link-btn" onClick={onDone}>Not now</button>
      )}
    </div>
  );
}
