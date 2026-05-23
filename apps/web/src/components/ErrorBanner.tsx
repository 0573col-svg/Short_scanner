interface Props {
  message: string | null;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-accent-red/40 bg-accent-red/10 px-4 py-3 text-sm"
    >
      <span className="text-accent-red font-mono text-xs uppercase tracking-wider mt-0.5">
        Error
      </span>
      <p className="flex-1 text-zinc-100 font-mono text-xs">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-zinc-500 hover:text-zinc-100 transition"
        aria-label="Cerrar"
      >
        ×
      </button>
    </div>
  );
}
