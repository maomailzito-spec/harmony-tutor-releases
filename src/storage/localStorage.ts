export function getStorage(): Storage | null {
  try {
    const ls = (globalThis as any)?.localStorage as Storage | undefined;
    return ls ?? null;
  } catch {
    return null;
  }
}

export function getString(key: string, fallback = ''): string {
  const ls = getStorage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    return raw == null ? fallback : String(raw);
  } catch {
    return fallback;
  }
}

export function setString(key: string, value: string): void {
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.setItem(key, value);
  } catch {
    // ignore
  }
}

export function getJSON<T>(key: string, fallback: T): T {
  const ls = getStorage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
