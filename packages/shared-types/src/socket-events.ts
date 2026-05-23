import type { ScanAlert, ScanState, ScoredToken } from './scoring';

export const SCAN_NAMESPACE = '/scans';

export interface ServerToClientEvents {
  'scan:update': (payload: ScanUpdatePayload) => void;
  'scan:tick': (payload: ScanTickPayload) => void;
  'alert:new': (payload: ScanAlert) => void;
  'scan:status': (payload: ScanState) => void;
}

export interface ClientToServerEvents {
  'scan:subscribe': () => void;
}

export interface ScanUpdatePayload {
  ranAt: number;
  results: ScoredToken[];
  newAlerts: ScanAlert[];
}

export interface ScanTickPayload {
  /** Segundos restantes para el próximo scan */
  secondsToNext: number;
  /** Status libre — "scanning", "idle", "error" */
  status: 'scanning' | 'idle' | 'error';
  /** Mensaje libre para mostrar al usuario */
  message?: string;
}
