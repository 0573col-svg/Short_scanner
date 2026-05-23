import type { ScanState, ScanTickPayload } from '@short-scanner/shared-types';
import { fmtChange, fmtTime } from '../lib/format';

interface Props {
  state: ScanState | null;
  tick: ScanTickPayload | null;
  connected: boolean;
}

export function ScanStatusBar({ state, tick, connected }: Props) {
  const status = !connected
    ? { text: 'desconectado', cls: 'text-accent-red', dotCls: 'bg-accent-red animate-pulse' }
    : state?.running || tick?.status === 'scanning'
      ? { text: 'escaneando', cls: 'text-accent-amber', dotCls: 'bg-accent-amber animate-pulse' }
      : tick?.status === 'error'
        ? { text: `error: ${tick.message ?? ''}`, cls: 'text-accent-red', dotCls: 'bg-accent-red' }
        : { text: 'activo', cls: 'text-accent-green', dotCls: 'bg-accent-green' };

  return (
    <div className="flex items-center gap-4 text-xs font-mono text-zinc-400">
      <span className="inline-flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${status.dotCls}`} />
        <span className={status.cls}>{status.text}</span>
      </span>
      {state && state.ranAt > 0 && (
        <span>
          últ. scan <span className="text-zinc-200">{fmtTime(state.ranAt)}</span>
        </span>
      )}
      {state && (
        <span>
          BTC{' '}
          <span
            className={
              state.btc.falling
                ? 'text-accent-red'
                : state.btc.change < 0
                  ? 'text-accent-amber'
                  : 'text-accent-green'
            }
          >
            {fmtChange(state.btc.change)}
          </span>
        </span>
      )}
      {state && state.results.length > 0 && (
        <span>
          tokens <span className="text-zinc-200">{state.results.length}</span>
        </span>
      )}
    </div>
  );
}
