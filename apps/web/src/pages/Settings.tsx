import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { UserView } from '@short-scanner/shared-types';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError, api } from '../lib/api';

function fmtErr(e: unknown): string {
  if (e instanceof ApiError) return `[${e.status}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return 'error desconocido';
}

export function Settings() {
  const [me, setMe] = useState<UserView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form state
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [nearAlerts, setNearAlerts] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getMe();
      setMe(data);
      if (data.telegram) {
        setChatId(data.telegram.chatId);
        setNearAlerts(data.telegram.nearAlertsEnabled);
      }
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() && !me?.telegram) {
      setError('Pega el token del bot');
      return;
    }
    setBusy(true);
    try {
      // Si el usuario no editó el token, mantenemos el actual (no enviamos nada).
      // Para cambiarlo realmente pegue uno nuevo.
      if (token.trim()) {
        await api.setTelegram({ token: token.trim(), chatId: chatId.trim(), nearAlertsEnabled: nearAlerts });
        setToken('');
        setInfo('Telegram guardado ✓');
      } else {
        // Solo actualizando flags / chatId → necesitamos el token actual,
        // pero el servidor no lo expone. En vez de eso, pedimos al usuario que re-pegue.
        setError('Para actualizar chatId o near-alerts pega también el token (no lo guardamos en el cliente).');
      }
      setError(null);
      await refresh();
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    try {
      await api.testTelegram();
      setInfo('Mensaje de prueba enviado ✓ revisá tu chat');
      setError(null);
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('¿Borrar la config de Telegram?')) return;
    setBusy(true);
    try {
      await api.deleteTelegram();
      setInfo('Config eliminada');
      setError(null);
      setToken('');
      setChatId('');
      setNearAlerts(false);
      await refresh();
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-zinc-500 text-sm">Cargando…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {info && (
        <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 px-4 py-2 text-sm text-accent-green font-mono flex items-center justify-between">
          <span>{info}</span>
          <button onClick={() => setInfo(null)} className="text-zinc-500 hover:text-zinc-100">×</button>
        </div>
      )}

      <section className="rounded-lg border border-line bg-bg-2 p-5 space-y-4">
        <header>
          <h2 className="text-base font-semibold">Telegram</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Recibe alertas GO_SHORT (y opcionalmente CERCA) en tu chat sin tener el navegador abierto.
            El token se cifra antes de guardarse.
          </p>
        </header>

        {me?.telegram && (
          <div className="rounded border border-line bg-bg-3 px-3 py-2 text-xs font-mono flex justify-between">
            <span className="text-zinc-400">
              Configurado: token <span className="text-accent-green">{me.telegram.tokenHint}</span>{' '}
              · chat <span className="text-zinc-200">{me.telegram.chatId}</span>{' '}
              · near-alerts {me.telegram.nearAlertsEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <Field label={me?.telegram ? 'Token (pega uno nuevo para reemplazar)' : 'Bot Token'}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:ABCdefGHI..."
              className="w-full bg-bg-3 border border-line rounded px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent-amber"
              autoComplete="off"
            />
          </Field>
          <Field label="Chat ID">
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890 o tu user id"
              className="w-full bg-bg-3 border border-line rounded px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent-amber"
              required
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={nearAlerts}
              onChange={(e) => setNearAlerts(e.target.checked)}
              className="accent-accent-red"
            />
            <span className="text-zinc-300">
              También alertar verdict <code className="text-accent-amber">CERCA</code> (no solo GO_SHORT)
            </span>
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-accent-red hover:bg-accent-red/90 text-white rounded transition disabled:opacity-50"
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            {me?.telegram && (
              <>
                <button
                  type="button"
                  onClick={onTest}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold bg-zinc-700 hover:bg-zinc-600 text-white rounded transition disabled:opacity-50"
                >
                  Enviar prueba
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  className="px-3 py-2 text-sm text-zinc-500 hover:text-accent-red transition"
                >
                  Borrar config
                </button>
              </>
            )}
          </div>
        </form>

        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">¿Cómo obtengo token + chatId?</summary>
          <ol className="list-decimal ml-5 mt-2 space-y-1">
            <li>
              Abre <code>@BotFather</code> en Telegram y crea un bot con <code>/newbot</code>. Te
              devuelve el <em>token</em> tipo <code>123456:AAH...</code>.
            </li>
            <li>
              Para tu chat ID personal: habla con <code>@userinfobot</code>. Devuelve tu user id (número).
            </li>
            <li>
              Para un grupo: agrega el bot al grupo y manda un <code>/start</code>, luego abre{' '}
              <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> y busca{' '}
              <code>chat.id</code> (los grupos empiezan con <code>-100</code>).
            </li>
          </ol>
        </details>
      </section>

      {me && (
        <section className="rounded-lg border border-line bg-bg-2 p-5 space-y-2">
          <h3 className="text-sm font-semibold">Pesos del scoring (read-only)</h3>
          <p className="text-xs text-zinc-500">Cuando entre el learning loop (Sprint 3 part 2), estos se recalibrarán automáticamente al cerrar trades.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {Object.entries(me.weights).map(([k, v]) => (
              <div key={k} className="bg-bg-3 border border-line rounded px-3 py-2 font-mono text-xs">
                <div className="text-zinc-500 uppercase">{k}</div>
                <div className="text-zinc-100 text-lg">{v}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}
