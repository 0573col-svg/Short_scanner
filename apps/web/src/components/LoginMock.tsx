import { type FormEvent, useState } from 'react';

interface Props {
  onLogin: () => void;
}

export function LoginMock({ onLogin }: Props) {
  const [email, setEmail] = useState('dev@example.com');
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onLogin();
    }, 250);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-line bg-bg-2 p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold">Short Scanner</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Login mock — Supabase Auth llega en Fase 2.
          </p>
        </div>

        <label className="block">
          <span className="text-xs text-zinc-400 uppercase tracking-wider">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-bg-3 border border-line rounded px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent-amber"
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-accent-red hover:bg-accent-red/90 text-white font-semibold py-2 rounded transition disabled:opacity-50"
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
