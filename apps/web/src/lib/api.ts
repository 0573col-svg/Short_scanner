import type {
  KlineView,
  Mode,
  ScanState,
  Thresholds,
  TrackedStatus,
  TrackedTokenView,
  TradeResult,
  TradeView,
  UserView,
} from '@short-scanner/shared-types';
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setTokens,
  type StoredUser,
} from './auth-store';

/**
 * Error de la API que preserva el body de la respuesta para que el UI pueda
 * mostrar el mensaje real del servidor (ej. detalles de validación).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Body crudo del error (puede ser objeto o string) */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Endpoints que NO mandan Authorization (signup/login/refresh). */
const PUBLIC_PATHS = new Set(['/auth/signup', '/auth/login', '/auth/refresh']);

async function http<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (!PUBLIC_PATHS.has(path)) {
    const tok = getAccessToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  }
  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 401 && !isRetry && !PUBLIC_PATHS.has(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) return http<T>(path, init, true);
    clearAuth();
    throw new ApiError(401, 'Sesión expirada');
  }

  if (!res.ok) {
    const body = await safeReadBody(res);
    throw new ApiError(res.status, extractMessage(body, res.status, path), body);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

async function safeReadBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(body: unknown, status: number, path: string): string {
  if (typeof body === 'string' && body) return body;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (Array.isArray(obj.message)) return obj.message.join(' · ');
  }
  return `HTTP ${status} en ${path}`;
}

// In-flight refresh para evitar duplicados (varias requests fallan en paralelo)
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const rt = getRefreshToken();
    if (!rt) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface AuthResponse {
  user: StoredUser;
  tokens: { accessToken: string; refreshToken: string };
}

export const api = {
  // ── Auth ─────────────────────────────────────────────────
  signup: async (email: string, password: string): Promise<StoredUser> => {
    const r = await http<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setTokens(r.tokens.accessToken, r.tokens.refreshToken, r.user);
    return r.user;
  },
  login: async (email: string, password: string): Promise<StoredUser> => {
    const r = await http<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setTokens(r.tokens.accessToken, r.tokens.refreshToken, r.user);
    return r.user;
  },
  logout: () => {
    clearAuth();
  },

  // ── Scanner ──────────────────────────────────────────────
  getCurrentScan: () => http<ScanState>('/scans/current'),
  patchSettings: (body: { mode?: Mode; thresholds?: Partial<Thresholds> }) =>
    http<ScanState>('/scans/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  runNow: () => http<{ ok: true; status: 'launched' }>('/scans/run', { method: 'POST' }),
  getKlines: (symbol: string, interval = '4h', limit = 42) => {
    const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
    return http<KlineView[]>(`/scans/klines?${q.toString()}`);
  },

  // ── Tracking ─────────────────────────────────────────────
  listTracking: (statuses?: TrackedStatus[]) => {
    const q = statuses?.length ? `?status=${statuses.join(',')}` : '';
    return http<TrackedTokenView[]>(`/tracking${q}`);
  },
  openShort: (id: string, notes?: string) =>
    http<{ tracked: TrackedTokenView; trade: TradeView }>(`/tracking/${id}/short`, {
      method: 'POST',
      body: JSON.stringify({ notes: notes ?? undefined }),
    }),
  deleteTracked: (id: string) =>
    http<{ ok: true }>(`/tracking/${id}`, { method: 'DELETE' }),

  // ── Trades ───────────────────────────────────────────────
  listTrades: () => http<TradeView[]>('/trades'),
  closeTrade: (id: string, result: TradeResult, notes?: string) =>
    http<TradeView>(`/trades/${id}/close`, {
      method: 'PATCH',
      body: JSON.stringify({ result, notes }),
    }),

  // ── Me / Settings ────────────────────────────────────────
  getMe: () => http<UserView>('/me'),
  setTelegram: (body: { token: string; chatId: string; nearAlertsEnabled?: boolean }) =>
    http<{ ok: true }>('/me/telegram', { method: 'PUT', body: JSON.stringify(body) }),
  deleteTelegram: () => http<void>('/me/telegram', { method: 'DELETE' }),
  testTelegram: () => http<{ ok: true }>('/me/telegram/test', { method: 'POST' }),
  claimDefault: () =>
    http<{
      trades: number;
      trackedTokens: { moved: number; merged: number };
      telegramReassigned: boolean;
    }>('/me/claim-default', { method: 'POST' }),
};
