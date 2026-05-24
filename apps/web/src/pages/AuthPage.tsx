import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../lib/api';

type Mode = 'login' | 'signup';

interface Props {
  onAuthed: () => void;
}

function fmtErr(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'error desconocido';
}

export function AuthPage({ onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        await api.signup(email.trim(), password);
      } else {
        await api.login(email.trim(), password);
      }
      onAuthed();
    } catch (err) {
      setError(fmtErr(err));
    } finally {
      setBusy(false);
    }
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
            {mode === 'login' ? 'Entrar a tu cuenta' : 'Crear cuenta nueva'}
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
            autoComplete="email"
          />
        </label>

        <label className="block">
          <span className="text-xs text-zinc-400 uppercase tracking-wider">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-bg-3 border border-line rounded px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent-amber"
            required
            minLength={mode === 'signup' ? 8 : 1}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {mode === 'signup' && (
            <span className="text-xs text-zinc-500 mt-1 block">mínimo 8 caracteres</span>
          )}
        </label>

        {error && (
          <div className="rounded border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red font-mono">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-accent-red hover:bg-accent-red/90 text-white font-semibold py-2 rounded transition disabled:opacity-50"
        >
          {busy
            ? mode === 'signup'
              ? 'Creando…'
              : 'Entrando…'
            : mode === 'signup'
              ? 'Crear cuenta'
              : 'Entrar'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
          }}
          className="w-full text-xs text-zinc-500 hover:text-zinc-200 transition"
        >
          {mode === 'login' ? '¿No tenés cuenta? Crear una' : '¿Ya tenés cuenta? Entrar'}
        </button>
      </form>
    </div>
  );
}
