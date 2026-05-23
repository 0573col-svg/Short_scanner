import type {
  Mode,
  ScanState,
  Thresholds,
  TrackedStatus,
  TrackedTokenView,
  TradeResult,
  TradeView,
  UserView,
} from '@short-scanner/shared-types';

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

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await safeReadBody(res);
    throw new ApiError(res.status, extractMessage(body, res.status, path), body);
  }
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

/**
 * Extrae un mensaje legible del body. Cubre los formatos que Nest devuelve:
 * - HttpException con string: { statusCode, message: "x", error: "..." }
 * - HttpException con array (validation): { message: ["err1", "err2"], error: ... }
 * - ConflictException con objeto: { ok: false, status: ..., message: "..." }
 */
function extractMessage(body: unknown, status: number, path: string): string {
  if (typeof body === 'string' && body) return body;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (Array.isArray(obj.message)) return obj.message.join(' · ');
  }
  return `HTTP ${status} en ${path}`;
}

export const api = {
  getCurrentScan: () => http<ScanState>('/scans/current'),
  patchSettings: (body: { mode?: Mode; thresholds?: Partial<Thresholds> }) =>
    http<ScanState>('/scans/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  // El servidor devuelve `'launched'` en el happy path; el caso 'already-running'
  // se entrega como 409 → ApiError (status=409, message="Ya hay un scan en progreso.").
  runNow: () => http<{ ok: true; status: 'launched' }>('/scans/run', { method: 'POST' }),

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
  deleteTelegram: () =>
    fetch('/api/me/telegram', { method: 'DELETE' }).then((r) => {
      if (!r.ok && r.status !== 204) throw new ApiError(r.status, `HTTP ${r.status}`);
    }),
  testTelegram: () =>
    http<{ ok: true }>('/me/telegram/test', { method: 'POST' }),
};
