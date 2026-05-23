import { useCallback, useEffect, useState } from 'react';
import type { TradeResult, TradeView } from '@short-scanner/shared-types';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError, api } from '../lib/api';
import { fmtChange, fmtTime } from '../lib/format';

function fmtErr(e: unknown): string {
  if (e instanceof ApiError) return `[${e.status}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return 'error desconocido';
}

const RESULT_CLS: Record<TradeResult, string> = {
  WIN: 'text-accent-green',
  LOSS: 'text-accent-red',
  BREAKEVEN: 'text-zinc-400',
};

export function Trades() {
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTrades();
      setTrades(data);
      setError(null);
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClose = useCallback(
    async (id: string, result: TradeResult) => {
      setBusyId(id);
      try {
        await api.closeTrade(id, result);
        setError(null);
        await refresh();
      } catch (e) {
        setError(`Close: ${fmtErr(e)}`);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const open = trades.filter((t) => !t.closedAt);
  const closed = trades.filter((t) => t.closedAt);

  if (loading && !trades.length) {
    return <div className="text-center py-12 text-zinc-500 text-sm">Cargando trades...</div>;
  }

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <section className="rounded-lg border border-line bg-bg-2">
        <header className="px-4 py-3 border-b border-line">
          <h3 className="text-sm font-semibold text-zinc-100">
            Posiciones abiertas <span className="text-zinc-500 font-normal">({open.length})</span>
          </h3>
        </header>
        {open.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">
            Sin trades abiertos. Ve a Watchlist → click "Short" en un token activo.
          </div>
        ) : (
          <Table trades={open} busyId={busyId} onClose={handleClose} />
        )}
      </section>

      <section className="rounded-lg border border-line bg-bg-2">
        <header className="px-4 py-3 border-b border-line">
          <h3 className="text-sm font-semibold text-zinc-100">
            Histórico <span className="text-zinc-500 font-normal">({closed.length})</span>
          </h3>
        </header>
        {closed.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">Sin trades cerrados aún.</div>
        ) : (
          <Table trades={closed} busyId={busyId} />
        )}
      </section>
    </div>
  );
}

interface TableProps {
  trades: TradeView[];
  busyId: string | null;
  onClose?: (id: string, r: TradeResult) => void;
}

function Table({ trades, busyId, onClose }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-mono">
        <thead className="bg-bg-3 text-zinc-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Símbolo</th>
            <th className="px-3 py-2 text-left">Abierto</th>
            <th className="px-3 py-2 text-right">Score entry</th>
            <th className="px-3 py-2 text-right">RSI peak</th>
            <th className="px-3 py-2 text-right">Δ24h peak</th>
            <th className="px-3 py-2 text-right">Días activos</th>
            <th className="px-3 py-2 text-left">Cerrado</th>
            <th className="px-3 py-2 text-left">Resultado</th>
            <th className="px-3 py-2 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {trades.map((t) => (
            <tr key={t.id} className="hover:bg-zinc-800/40 transition">
              <td className="px-3 py-2">
                <span className="text-zinc-100 font-semibold">{t.symbol.replace('USDT', '')}</span>
                <span className="text-zinc-600 text-xs">/USDT</span>
              </td>
              <td className="px-3 py-2 text-xs text-zinc-500">
                {fmtTime(new Date(t.openedAt).getTime())}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                {t.entryScore ?? '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                {t.entryRsi !== null ? t.entryRsi.toFixed(0) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-accent-green">
                {t.entryChange24h !== null ? fmtChange(t.entryChange24h) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                {t.daysActiveAtEntry ?? '—'}d
              </td>
              <td className="px-3 py-2 text-xs text-zinc-500">
                {t.closedAt ? fmtTime(new Date(t.closedAt).getTime()) : '—'}
              </td>
              <td className="px-3 py-2">
                {t.result ? (
                  <span className={`text-xs font-semibold ${RESULT_CLS[t.result]}`}>
                    {t.result}
                  </span>
                ) : (
                  <span className="text-zinc-600 text-xs">abierto</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {onClose && !t.closedAt && (
                  <div className="flex gap-1 justify-end">
                    {(['WIN', 'LOSS', 'BREAKEVEN'] as TradeResult[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => onClose(t.id, r)}
                        className={`px-2 py-1 text-xs font-semibold rounded transition disabled:opacity-50 ${
                          r === 'WIN'
                            ? 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
                            : r === 'LOSS'
                              ? 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                              : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
