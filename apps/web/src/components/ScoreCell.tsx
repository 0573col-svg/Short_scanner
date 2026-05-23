export function ScoreCell({ score }: { score: number }) {
  const color =
    score >= 75 ? 'bg-accent-red' : score >= 55 ? 'bg-accent-amber' : score >= 35 ? 'bg-blue-500' : 'bg-zinc-700';
  const textColor =
    score >= 75 ? 'text-accent-red' : score >= 55 ? 'text-accent-amber' : score >= 35 ? 'text-blue-400' : 'text-zinc-500';
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-semibold ${textColor} tabular-nums w-6 text-right`}>
        {score}
      </span>
    </div>
  );
}
