import { Suspense, lazy } from 'react';
import type { KlineView } from '@short-scanner/shared-types';

// Lazy: la librería lightweight-charts (~45kb gzip) solo se carga al abrir el modal.
const PriceChart = lazy(() => import('./PriceChart'));

interface Props {
  symbol: string;
  candles: KlineView[];
  loading: boolean;
  error: string | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-bg-2">
      <header className="px-4 py-2.5 border-b border-line">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Precio (últimos 7 días · 4H)
        </h3>
      </header>
      {children}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[280px] flex items-center justify-center text-sm text-zinc-600 px-4 text-center">
      {children}
    </div>
  );
}

export function ChartSection({ symbol, candles, loading, error }: Props) {
  if (loading) {
    return (
      <Shell>
        <Centered>Cargando gráfico…</Centered>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <Centered>No se pudo cargar el gráfico — {error}</Centered>
      </Shell>
    );
  }
  if (candles.length === 0) {
    return (
      <Shell>
        <Centered>Sin datos de precio para este símbolo</Centered>
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="p-2">
        <Suspense fallback={<Centered>Cargando gráfico…</Centered>}>
          {/* key={symbol} → remonta el chart por token, cleanup garantizado sin leaks. */}
          <PriceChart key={symbol} candles={candles} />
        </Suspense>
      </div>
    </Shell>
  );
}
