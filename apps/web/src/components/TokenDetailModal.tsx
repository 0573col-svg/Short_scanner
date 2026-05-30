import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { KlineView, ScoredToken, TrackedTokenView } from '@short-scanner/shared-types';
import { fmtChange, fmtPrice } from '../lib/format';
import { GradesPanel } from './GradesPanel';
import { TrackingPanel } from './TrackingPanel';
import { ChartSection } from './ChartSection';
import { VerdictPill } from './VerdictPill';

interface Props {
  token: ScoredToken | null;
  /** % cambio 24h de BTC del último scan (se pasa al GradesPanel para mostrar el valor del grade btcOk). */
  btcChange: number | null;
  /** Edad del snapshot en ms — si > umbral, se muestra badge "datos del scan a las HH:MM". */
  snapshotAgeMs: number | null;
  /** Fila de tracking del símbolo, o null si no está monitoreado. */
  tracking: TrackedTokenView | null;
  /** True mientras se resuelve el tracking del símbolo (primer fetch). */
  trackingLoading: boolean;
  /** Klines OHLC para el gráfico de precio (7 días · 4H). */
  klines: KlineView[];
  klinesLoading: boolean;
  klinesError: string | null;
  onClose: () => void;
}

/** Umbral a partir del cual el snapshot del modal se marca como envejecido (el ciclo normal es 2 min). */
const STALE_AFTER_MS = 2 * 60_000;

export function TokenDetailModal({
  token,
  btcChange,
  snapshotAgeMs,
  tracking,
  trackingLoading,
  klines,
  klinesLoading,
  klinesError,
  onClose,
}: Props) {
  // Escape para cerrar + scroll lock del body mientras el modal está montado.
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [token, onClose]);

  if (!token) return null;

  const { snapshot, score, verdict, grades } = token;
  const stale = snapshotAgeMs !== null && snapshotAgeMs > STALE_AFTER_MS;
  const binanceUrl = `https://www.binance.com/en/futures/${snapshot.symbol}`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-detail-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl my-8 rounded-lg border border-line bg-bg-1 shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-baseline gap-2">
              <h2
                id="token-detail-title"
                className="text-lg font-semibold text-zinc-100 font-mono"
              >
                {snapshot.base}
                <span className="text-zinc-600 text-sm font-normal">/USDT</span>
              </h2>
              <VerdictPill verdict={verdict} />
            </div>
            <div className="flex items-center gap-4 text-sm font-mono">
              <span className="text-zinc-300 tabular-nums">${fmtPrice(snapshot.price)}</span>
              <span
                className={`tabular-nums ${
                  snapshot.change >= 0 ? 'text-accent-green' : 'text-accent-red'
                }`}
              >
                {fmtChange(snapshot.change)}
              </span>
              <span className="text-zinc-500 text-xs">
                Score <span className="text-zinc-200 font-semibold">{score}</span>
              </span>
            </div>
            {stale && (
              <span className="text-xs text-accent-amber">
                Datos del scan a las{' '}
                {new Date(snapshot.ts).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
                {' '}— este token salió del ranking
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-zinc-500 hover:text-zinc-100 transition text-2xl leading-none px-2 -mt-1"
          >
            ×
          </button>
        </header>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <GradesPanel grades={grades} snapshot={snapshot} btcChange={btcChange} />

          <TrackingPanel tracked={tracking} loading={trackingLoading} />

          <ChartSection
            symbol={snapshot.symbol}
            candles={klines}
            loading={klinesLoading}
            error={klinesError}
          />
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-line flex justify-end">
          <a
            href={binanceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-400 hover:text-zinc-100 transition underline underline-offset-2"
          >
            Abrir en Binance ↗
          </a>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
