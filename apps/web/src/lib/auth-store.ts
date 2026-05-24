/**
 * Storage simple de tokens auth en localStorage.
 * En prod podrías mover el refresh a httpOnly cookie para mitigar XSS,
 * pero para single-page app con misma origin esto es razonable.
 */
const ACCESS_KEY = 'shortscanner.access';
const REFRESH_KEY = 'shortscanner.refresh';
const USER_KEY = 'shortscanner.user';

export interface StoredUser {
  id: string;
  email: string;
}

type Listener = (authed: boolean) => void;
const listeners = new Set<Listener>();

function notify() {
  const authed = !!getAccessToken();
  listeners.forEach((l) => l(authed));
}

// Cross-tab sync: si otra pestaña hace login/logout, esta se entera.
// `storage` event NO dispara en la misma pestaña que escribió — perfecto.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ACCESS_KEY || e.key === REFRESH_KEY || e.key === USER_KEY) {
      notify();
    }
  });
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setTokens(accessToken: string, refreshToken: string, user: StoredUser): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  notify();
}

export function setAccessToken(accessToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  notify();
}

export function clearAuth(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  notify();
}

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
