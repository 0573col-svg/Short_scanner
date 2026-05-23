import { useEffect, useRef, useState } from 'react';
import type {
  ScanAlert,
  ScanState,
  ScanTickPayload,
  ScanUpdatePayload,
} from '@short-scanner/shared-types';
import { getScanSocket } from '../lib/socket';

const MAX_ALERTS = 50;

export interface ScanStream {
  state: ScanState | null;
  alerts: ScanAlert[];
  tick: ScanTickPayload | null;
  connected: boolean;
  lastUpdate: ScanUpdatePayload | null;
  flashSet: Set<string>;
}

export function useScanStream(): ScanStream {
  const [state, setState] = useState<ScanState | null>(null);
  const [alerts, setAlerts] = useState<ScanAlert[]>([]);
  const [tick, setTick] = useState<ScanTickPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<ScanUpdatePayload | null>(null);
  const [flashSet, setFlashSet] = useState<Set<string>>(new Set());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const socket = getScanSocket();
    const timersRef = flashTimers.current;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onStatus = (s: ScanState) => setState(s);
    const onUpdate = (u: ScanUpdatePayload) => {
      setLastUpdate(u);
      // Marcar como flash los símbolos con alertas nuevas
      if (u.newAlerts.length > 0) {
        setFlashSet((prev) => {
          const next = new Set(prev);
          for (const a of u.newAlerts) {
            next.add(a.symbol);
            const existing = timersRef.get(a.symbol);
            if (existing) clearTimeout(existing);
            const timer = setTimeout(() => {
              setFlashSet((p) => {
                const np = new Set(p);
                np.delete(a.symbol);
                return np;
              });
              timersRef.delete(a.symbol);
            }, 4000);
            timersRef.set(a.symbol, timer);
          }
          return next;
        });
      }
    };
    const onTick = (t: ScanTickPayload) => setTick(t);
    const onAlert = (a: ScanAlert) =>
      setAlerts((prev) => [a, ...prev].slice(0, MAX_ALERTS));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('scan:status', onStatus);
    socket.on('scan:update', onUpdate);
    socket.on('scan:tick', onTick);
    socket.on('alert:new', onAlert);
    socket.emit('scan:subscribe');

    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('scan:status', onStatus);
      socket.off('scan:update', onUpdate);
      socket.off('scan:tick', onTick);
      socket.off('alert:new', onAlert);
      timersRef.forEach((t) => clearTimeout(t));
      timersRef.clear();
    };
  }, []);

  return { state, alerts, tick, connected, lastUpdate, flashSet };
}
