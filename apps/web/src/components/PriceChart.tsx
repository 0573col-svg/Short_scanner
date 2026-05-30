import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { KlineView } from '@short-scanner/shared-types';

interface Props {
  candles: KlineView[];
}

// Colores del theme (tailwind.config.js) — lightweight-charts necesita strings, no clases.
const COLORS = {
  bg: '#161616', // bg-2
  grid: '#232323', // line
  text: '#a1a1aa', // zinc-400
  up: '#4ade80', // accent-green
  down: '#e34c5c', // accent-red
} as const;

/**
 * Gráfico de velas (candlestick) con lightweight-charts v5.
 *
 * Componente "pesado" cargado de forma lazy (React.lazy en el modal) para que la
 * librería (~45kb gzip) solo entre al bundle al abrir el detalle. Se monta con
 * `key={symbol}` desde el modal, así cada token arranca con un chart limpio y el
 * cleanup (`chart.remove()`) corre en cada cambio de símbolo — sin leaks.
 */
export default function PriceChart({ candles }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Crear el chart una sola vez al montar; destruirlo al desmontar.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true, // observa el contenedor vía ResizeObserver interno
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      timeScale: { borderColor: COLORS.grid, timeVisible: false },
      rightPriceScale: { borderColor: COLORS.grid },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Pintar / repintar datos cuando cambian las velas.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data: CandlestickData<UTCTimestamp>[] = candles.map((k) => ({
      time: k.time as UTCTimestamp,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} className="h-[280px] w-full" />;
}
