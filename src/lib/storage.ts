export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`mh:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === undefined || value === null) localStorage.removeItem(`mh:${key}`);
    else localStorage.setItem(`mh:${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}
