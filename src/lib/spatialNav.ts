/**
 * D-pad navigation for the 10-foot UI: arrow keys move focus to the nearest focusable element in
 * that direction, Enter activates it, Back / Escape goes back. Works with a TV remote over HDMI-CEC,
 * a keyboard, or an air-mouse remote.
 */
type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'a[href], button:not([disabled]), select, input:not([type=hidden]):not([type=range]), [tabindex="0"]';
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function visible(el: HTMLElement) {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.opacity !== '0';
}

/** The region navigation is confined to: an open drawer/overlay, else the whole page. */
function scope(): ParentNode {
  return document.querySelector('.sources, .postplay, .nextup') ?? document;
}

export function candidates(root: ParentNode = scope()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/** Pick the best element in `dir` from `from`: close along the axis, well aligned across it. */
export function nearest(from: DOMRect, dir: Dir, rects: { el: HTMLElement; r: DOMRect }[]) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const { el, r } of rects) {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let main: number;
    let cross: number;
    if (dir === 'right') (main = r.left - from.right), (cross = Math.abs(y - cy));
    else if (dir === 'left') (main = from.left - r.right), (cross = Math.abs(y - cy));
    else if (dir === 'down') (main = r.top - from.bottom), (cross = Math.abs(x - cx));
    else (main = from.top - r.bottom), (cross = Math.abs(x - cx));
    // Must actually lie in that direction (small tolerance for overlapping edges).
    const centerAhead =
      dir === 'right' ? x > cx : dir === 'left' ? x < cx : dir === 'down' ? y > cy : y < cy;
    if (main < -8 || !centerAhead) continue;
    const score = Math.max(main, 0) + cross * 2;
    if (score < bestScore) (bestScore = score), (best = el);
  }
  return best;
}

export function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

export function focusInitial() {
  const root = scope();
  // During playback OK = play/pause, so keep focus off the player's own buttons.
  if (root === document && document.querySelector('[data-player-keys]')) {
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }
  const el =
    root.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ??
    candidates(root).find((e) => !e.closest('.nav'));
  if (el && visible(el)) focusEl(el);
}

export function installSpatialNav(goBack: () => void) {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // The player owns the keys while playing (seek / pause), unless a drawer or overlay is open.
    if (document.querySelector('[data-player-keys]') && !document.querySelector('.sources')) return;
    const typing = target.matches('input:not([type=checkbox]), textarea');

    if (e.key === 'Escape' || e.key === 'BrowserBack' || e.key === 'GoBack' || (e.key === 'Backspace' && !typing)) {
      if (document.querySelector('.player')) return; // player handles Back itself
      e.preventDefault();
      goBack();
      return;
    }
    if (e.key === 'Enter' && target.matches('input[type=checkbox]')) {
      e.preventDefault();
      target.click();
      return;
    }
    const dir = KEY_DIR[e.key];
    if (!dir) return;
    if (typing && (dir === 'left' || dir === 'right')) return; // move the text caret
    if (target.matches('select') && (dir === 'up' || dir === 'down')) return; // change the option

    e.preventDefault();
    const list = candidates();
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || !list.includes(active)) {
      focusInitial();
      return;
    }
    const next = nearest(
      active.getBoundingClientRect(),
      dir,
      list.filter((el) => el !== active).map((el) => ({ el, r: el.getBoundingClientRect() })),
    );
    if (next) focusEl(next);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/**
 * Keep focus somewhere useful as the page changes: on route changes (content loads async, so retry
 * briefly) and whenever an overlay opens that doesn't already contain the focus.
 */
export function watchFocus(): () => void {
  let frame = 0;
  const check = () => {
    frame = 0;
    const overlay = document.querySelector('.sources, .postplay, .nextup');
    const active = document.activeElement;
    const lost = !active || active === document.body || !document.contains(active);
    if ((overlay && !overlay.contains(active)) || lost) focusInitial();
  };
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(check);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
