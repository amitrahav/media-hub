import { describe, expect, it } from 'vitest';
import { nearest } from './spatialNav';

const rect = (left: number, top: number, width = 100, height = 150) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
const el = (name: string) => ({ name }) as unknown as HTMLElement;

describe('spatial navigation', () => {
  // Two poster rows: row A at y=0, row B at y=300.
  const a = [0, 110, 220, 330].map((x, i) => ({ el: el(`a${i}`), r: rect(x, 0) }));
  const b = [0, 110, 220, 330].map((x, i) => ({ el: el(`b${i}`), r: rect(x + 40, 300) }));
  const all = [...a, ...b];

  it('moves along a row', () => {
    expect(nearest(a[1].r, 'right', all.filter((c) => c !== a[1]))).toBe(a[2].el);
    expect(nearest(a[1].r, 'left', all.filter((c) => c !== a[1]))).toBe(a[0].el);
  });

  it('moves to the best-aligned card in the next row', () => {
    expect(nearest(a[2].r, 'down', all.filter((c) => c !== a[2]))).toBe(b[2].el);
    expect(nearest(b[3].r, 'up', all.filter((c) => c !== b[3]))).toBe(a[3].el);
  });

  it('stays put at the edges', () => {
    expect(nearest(a[0].r, 'left', all.filter((c) => c !== a[0]))).toBeUndefined();
    expect(nearest(a[1].r, 'up', all.filter((c) => c !== a[1]))).toBeUndefined();
  });
});
