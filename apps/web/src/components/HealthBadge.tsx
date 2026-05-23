import type { HealthResponse } from '@short-scanner/shared-types';

interface Props {
  health: HealthResponse | null;
  error: string | null;
}

export function HealthBadge({ health, error }: Props) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-mono text-accent-red">
        <span className="w-2 h-2 rounded-full bg-accent-red animate-pulse" />
        API down
      </span>
    );
  }
  if (!health) {
    return <span className="text-xs font-mono text-zinc-500">...</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs font-mono text-accent-green">
      <span className="w-2 h-2 rounded-full bg-accent-green" />
      API {health.status} · {health.uptimeSeconds}s
    </span>
  );
}
