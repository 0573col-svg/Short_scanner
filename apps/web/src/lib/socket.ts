import { io, type Socket } from 'socket.io-client';
import {
  SCAN_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@short-scanner/shared-types';

export type ScanSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ScanSocket | null = null;

export function getScanSocket(): ScanSocket {
  if (!socket) {
    // Vite proxy redirige /socket.io/ al API en dev
    socket = io(SCAN_NAMESPACE, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
    }) as ScanSocket;
  }
  return socket;
}
