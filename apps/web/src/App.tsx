import { useState } from 'react';
import { LoginMock } from './components/LoginMock';
import { Scanner } from './pages/Scanner';
import { Watchlist } from './pages/Watchlist';
import { Trades } from './pages/Trades';
import { Settings } from './pages/Settings';

type Tab = 'scanner' | 'watchlist' | 'trades' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'scanner', label: 'Scanner' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'trades', label: 'Trades' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => sessionStorage.getItem('mockAuth') === '1');
  const [tab, setTab] = useState<Tab>('scanner');

  if (!authed) {
    return (
      <LoginMock
        onLogin={() => {
          sessionStorage.setItem('mockAuth', '1');
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-bg text-zinc-100">
      <header className="border-b border-line bg-bg-1 sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">
            Short Scanner <span className="text-zinc-500 font-normal">/ Fase 3</span>
          </h1>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem('mockAuth');
              setAuthed(false);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-200 transition"
          >
            Salir
          </button>
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
