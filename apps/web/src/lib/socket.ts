import { io, type Socket } from 'socket.io-client';
import {
  SCAN_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@short-scanner/shared-types';
import { getAccessToken } from './auth-store';

export type ScanSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ScanSocket | null = null;

export function getScanSocket(): ScanSocket {
  if (!socket) {
    socket = io(SCAN_NAMESPACE, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      // Token JWT en el handshake (el ScansGateway lo valida en handleConnection)
      auth: (cb) => cb({ token: getAccessToken() ?? '' }),
    }) as ScanSocket;
  }
  return socket;
}

/**
 * Reset del socket — usar tras logout/login para que el handshake use el nuevo token.
 */
export function resetScanSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
