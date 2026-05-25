import { Inject, Logger, UnauthorizedException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ScannerService } from './scanner.service';
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
import { UsersService } from '../users/users.service';
import type { JwtPayload } from '../auth/auth.types';

// El decorador se evalúa en module-load, antes de que NestJS provea ConfigService,
// por eso leemos directo de process.env. Coincide con cómo main.ts arma CORS HTTP.
type OriginCallback = (err: Error | null, allow?: boolean) => void;

function buildCorsOrigin() {
  return (origin: string | undefined, cb: OriginCallback) => {
    const raw = process.env.CORS_ORIGINS ?? 'http://localhost:5173';
    const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin) return cb(null, true);
    cb(null, allowed.includes(origin));
  };
}

/** Decoramos el Socket con el userId que extraemos del JWT en handshake. */
interface AuthSocket extends Socket {
  data: { userId?: string; email?: string };
}

@WebSocketGateway({
  namespace: SCAN_NAMESPACE,
  cors: { origin: buildCorsOrigin(), credentials: true },
})
export class ScansGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ScansGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly state: ScannerStateStore,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    @Inject(forwardRef(() => ScannerService))
    private readonly scanner: ScannerService,
  ) {}

  /**
   * Valida JWT en el handshake y guarda userId en socket.data.
   * El cliente lo manda como `auth: { token }` al conectar.
   */
  async handleConnection(client: AuthSocket): Promise<void> {
    try {
      const token = (client.handshake.auth?.token ?? client.handshake.headers['authorization']) as
        | string
        | undefined;
      if (!token) throw new UnauthorizedException('Sin token');
      const clean = token.startsWith('Bearer ') ? token.slice(7) : token;
      const payload = await this.jwt.verifyAsync<JwtPayload>(clean, {
        secret: this.cfg.get<string>('JWT_SECRET'),
      });
      if (payload.type !== 'access') throw new UnauthorizedException('Usar access token');

      client.data.userId = payload.sub;
      client.data.email = payload.email;
      await client.join(`user:${payload.sub}`);
      this.logger.debug(`client connected: ${client.id} (user ${payload.email})`);

      // Push del estado actual al cliente con fallback de score-from-cache
      const state = await this.buildUserState(payload.sub);
      client.emit('scan:status', state);
    } catch (err) {
      this.logger.warn(`WS auth rejected: ${err instanceof Error ? err.message : err}`);
      client.emit('scan:auth-error', { message: 'No autorizado' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthSocket): void {
    if (client.data?.userId) {
      this.logger.debug(`client disconnected: ${client.id} (user ${client.data.email})`);
    }
  }

  @SubscribeMessage('scan:subscribe')
  async handleSubscribe(client: AuthSocket): Promise<void> {
    if (!client.data?.userId) return;
    // MISMO fallback que handleConnection — sin esto, si scan:subscribe llega
    // después del primer emit y aún no hay results del user, pisa el state
    // hidratado con uno vacío.
    const state = await this.buildUserState(client.data.userId);
    client.emit('scan:status', state);
  }

  /**
   * Construye el ScanState del usuario, con fallback de score-from-cache
   * si su PerUserState está vacío pero ya hay snapshot enriched cacheado.
   * Evita que la UI quede esperando 2 min al cron tras login/reconexión.
   */
  private async buildUserState(userId: string) {
    const u = await this.users.getById(userId);
    let state = this.state.getForUser(userId, u.mode, u.thresholds);
    if (state.results.length === 0) {
      const populated = await this.scanner.scoreUserFromCache(userId);
      if (populated) state = this.state.getForUser(userId, u.mode, u.thresholds);
    }
    return state;
  }

  /** Emit scan update solo a la room de UN usuario */
  emitScanUpdateForUser(userId: string, payload: ScanUpdatePayload): void {
    this.server?.to(`user:${userId}`).emit('scan:update', payload);
  }

  /** Emit alert solo a la room de UN usuario */
  emitAlertForUser(userId: string, alert: ScanAlert): void {
    this.server?.to(`user:${userId}`).emit('alert:new', alert);
  }

  /** Tick es shared (estado del cron compartido entre users) */
  emitTick(payload: ScanTickPayload): void {
    this.server?.emit('scan:tick', payload);
  }
}
