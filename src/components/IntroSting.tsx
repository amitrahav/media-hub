import { useEffect, useState } from 'react';

/** Netflix-style launch sting. Plays once per browser session; click to skip. */
export function IntroSting({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), 1900);
    const b = setTimeout(onDone, 2400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [onDone]);
  return (
    <div className={`intro ${leaving ? 'intro--out' : ''}`} onClick={onDone} role="presentation">
      <div className="intro__logo">
        {'MEDIA HUB'.split('').map((c, i) => (
          <span key={i} style={{ animationDelay: `${i * 45}ms` }}>
            {c === ' ' ? ' ' : c}
          </span>
        ))}
      </div>
      <div className="intro__beam" />
    </div>
  );
}
