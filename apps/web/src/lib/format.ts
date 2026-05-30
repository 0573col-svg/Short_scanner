export function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function fmtPrice(p: number): string {
  if (p < 0.0001) return p.toExponential(3);
  if (p < 0.01) return p.toFixed(6);
  if (p < 1) return p.toFixed(4);
  if (p < 100) return p.toFixed(3);
  return p.toFixed(2);
}

export function fmtTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function fmtChange(p: number): string {
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

/**
 * Tiempo relativo en castellano desde un timestamp ISO 8601 hacia ahora.
 * "recién" / "hace 40s" / "hace 12min" / "hace 4h" / "hace 3d".
 * Devuelve "—" si el timestamp es null/0/inválido (caso Ever-flag sin PassedAt).
 */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then) || then <= 0) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'recién';
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'recién';
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

/**
 * Duración de monitoreo acumulada (activeMs) en formato legible.
 * Cambia de unidad según magnitud — en QA el window es de minutos, en
 * producción de horas/días. "0min" si es 0 o negativo.
 * "8min" / "3h 12min" / "2d 4h".
 */
export function fmtActiveTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0min';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}min`;
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) {
    const m = totalMin % 60;
    return m > 0 ? `${totalH}h ${m}min` : `${totalH}h`;
  }
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}
