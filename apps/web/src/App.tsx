import { useCallback, useEffect, useState } from 'react';
import { AuthPage } from './pages/AuthPage';
import { Scanner } from './pages/Scanner';
import { Watchlist } from './pages/Watchlist';
import { Trades } from './pages/Trades';
import { Settings } from './pages/Settings';
import {
  getAccessToken,
  getStoredUser,
  onAuthChange,
  type StoredUser,
} from './lib/auth-store';
import { api } from './lib/api';
import { resetScanSocket } from './lib/socket';

type Tab = 'scanner' | 'watchlist' | 'trades' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'scanner', label: 'Scanner' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'trades', label: 'Trades' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getAccessToken());
  const [user, setUser] = useState<StoredUser | null>(() => getStoredUser());
  const [tab, setTab] = useState<Tab>('scanner');

  // Sincronizar con auth-store (cuando otra pestaña hace login/logout, o refresh interno)
  useEffect(() => {
    return onAuthChange((isAuthed) => {
      setAuthed(isAuthed);
      setUser(getStoredUser());
    });
  }, []);

  const handleAuthed = useCallback(() => {
    setAuthed(true);
    setUser(getStoredUser());
    // El socket se reconecta con el nuevo token en la próxima llamada a getScanSocket()
    resetScanSocket();
  }, []);

  const handleLogout = useCallback(() => {
    api.logout();
    resetScanSocket();
  }, []);

  if (!authed) {
    return <AuthPage onAuthed={handleAuthed} />;
  }

  return (
    <div className="min-h-screen bg-bg text-zinc-100">
      <header className="border-b border-line bg-bg-1 sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">
            Short Scanner <span className="text-zinc-500 font-normal">/ Fase 4</span>
          </h1>
          <div className="flex items-center gap-3 text-xs">
            {user && <span className="text-zinc-400 font-mono">{user.email}</span>}
            <button
              type="button"
              onClick={handleLogout}
              className="text-zinc-500 hover:text-zinc-200 transition"
            >
              Salir
            </button>
          </div>
        </div>
        <nav className="px-6 flex gap-1 border-t border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
                tab === t.id
                  ? 'border-accent-red text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="px-6 py-6 max-w-[1400px] mx-auto">
        {tab === 'scanner' && <Scanner />}
        {tab === 'watchlist' && <Watchlist />}
        {tab === 'trades' && <Trades />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
