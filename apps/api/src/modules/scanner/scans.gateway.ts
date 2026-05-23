import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  SCAN_NAMESPACE,
  ScanAlert,
  ScanTickPayload,
  ScanUpdatePayload,
} from '@short-scanner/shared-types';
import { ScannerStateStore } from './scanner.state';

// El decorador se evalúa en module-load, antes de que NestJS provea ConfigService,
// por eso leemos directo de process.env. Coincide con cómo main.ts arma CORS HTTP.
type OriginCallback = (err: Error | null, allow?: boolean) => void;

function buildCorsOrigin() {
  return (origin: string | undefined, cb: OriginCallback) => {
    const raw = process.env.CORS_ORIGINS ?? 'http://localhost:5173';
    const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    // Sin Origin (ej. herramientas CLI / same-origin) → permitir
    if (!origin) return cb(null, true);
    cb(null, allowed.includes(origin));
  };
}

@WebSocketGateway({
  namespace: SCAN_NAMESPACE,
  cors: { origin: buildCorsOrigin(), credentials: true },
})
export class ScansGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ScansGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly state: ScannerStateStore) {}

  handleConnection(client: Socket): void {
    this.logger.debug(`client connected: ${client.id}`);
    // Push del estado actual para que el cliente vea algo inmediatamente
    client.emit('scan:status', this.state.get());
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`client disconnected: ${client.id}`);
  }

  @SubscribeMessage('scan:subscribe')
  handleSubscribe(client: Socket): void {
    client.emit('scan:status', this.state.get());
  }

  emitScanUpdate(payload: ScanUpdatePayload): void {
    this.server?.emit('scan:update', payload);
    this.server?.emit('scan:status', this.state.get());
  }

  emitTick(payload: ScanTickPayload): void {
    this.server?.emit('scan:tick', payload);
  }

  emitAlert(alert: ScanAlert): void {
    this.server?.emit('alert:new', alert);
  }
}
