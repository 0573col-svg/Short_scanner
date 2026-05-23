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
