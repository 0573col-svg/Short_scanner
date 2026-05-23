import { useState } from 'react';
import type { Mode, ScanState, Thresholds } from '@short-scanner/shared-types';

interface Props {
  state: ScanState;
  onChange: (patch: { mode?: Mode; thresholds?: Partial<Thresholds> }) => void;
  onRunNow: () => void;
}

export function ScannerToolbar({ state, onChange, onRunNow }: Props) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-lg border border-line bg-bg-2 p-4 flex flex-wrap items-end gap-4">
      <Field label="Pump %">
        <input
          type="number"
          defaultValue={state.thresholds.pumpPct}
          min={1}
          className="w-20 bg-bg-3 border border-line rounded px-2 py-1 font-mono text-sm focus:outline-none focus:border-accent-amber"
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v > 0) onChange({ thresholds: { pumpPct: v } });
          }}
        />
      </Field>
      <Field label="Top N">
        <input
          type="number"
          defaultValue={state.thresholds.topN}
          min={1}
          max={200}
          className="w-20 bg-bg-3 border border-line rounded px-2 py-1 font-mono text-sm focus:outline-none focus:border-accent-amber"
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v > 0) onChange({ thresholds: { topN: v } });
          }}
        />
      </Field>
      <Field label="Vol min USD">
        <input
          type="number"
          defaultValue={state.thresholds.minVolUsd}
          min={0}
          step={100000}
          className="w-32 bg-bg-3 border border-line rounded px-2 py-1 font-mono text-sm focus:outline-none focus:border-accent-amber"
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0) onChange({ thresholds: { minVolUsd: v } });
          }}
        />
      </Field>
      <Field label="Modo">
        <div className="flex bg-bg-3 border border-line rounded overflow-hidden">
          {(['STRICT', 'FLEX'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ mode: m })}
              className={`px-3 py-1 text-xs font-semibold transition ${
                state.mode === m ? 'bg-accent-red text-white' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex-1" />
      <button
        type="button"
        disabled={busy || state.running}
        onClick={async () => {
          setBusy(true);
          try {
            await onRunNow();
          } finally {
            setBusy(false);
          }
        }}
        className="px-4 py-2 text-sm font-semibold bg-accent-red hover:bg-accent-red/90 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.running ? 'Escaneando…' : busy ? 'Lanzando…' : 'Forzar scan'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}
