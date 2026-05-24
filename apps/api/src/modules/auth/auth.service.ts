import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
} from '../scoring/scoring.constants';
import { UserEntity } from '../users/user.entity';
import type {
  AuthResponse,
  AuthTokens,
  JwtPayload,
} from './auth.types';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  async signup(email: string, password: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase().trim();
    const existing = await this.users.findOne({ where: { email: normalized } });
    if (existing) {
      throw new ConflictException(`Ya existe una cuenta con email ${normalized}`);
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.users.save(
      this.users.create({
        id: randomUUID(),
        email: normalized,
        passwordHash,
        mode: 'STRICT',
        thresholds: DEFAULT_THRESHOLDS,
        weights: DEFAULT_WEIGHTS,
      }),
    );
    this.logger.log(`signup: ${user.email} (${user.id})`);
    return this.buildResponse(user);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase().trim();
    const user = await this.users.findOne({ where: { email: normalized } });
    // Mismo mensaje genérico independientemente de si existe o no, para no
    // permitir enumeración de usuarios. bcrypt.compare en hash fake para
    // mantener tiempo constante incluso cuando el usuario no existe.
    const hash = user?.passwordHash ?? '$2b$12$0000000000000000000000.0000000000000000000000000000';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !ok) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.buildResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.cfg.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Tipo de token incorrecto');
    }
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    return this.issueTokens(user);
  }

  private async buildResponse(user: UserEntity): Promise<AuthResponse> {
    const tokens = await this.issueTokens(user);
    return {
      user: { id: user.id, email: user.email },
      tokens,
    };
  }

  private async issueTokens(user: UserEntity): Promise<AuthTokens> {
    const secret = this.cfg.get<string>('JWT_SECRET')!;
    const basePayload = { sub: user.id, email: user.email };
    // El tipo de `expiresIn` en @nestjs/jwt v11 viene de `ms` y rechaza string genérico.
    // Como leemos del config (runtime), cast a any es la solución pragmática —
    // '15m', '7d' son strings válidos en runtime aunque el tipo no lo refleje.
    const accessTtl = this.cfg.get<string>('JWT_ACCESS_TTL', '15m');
    const refreshTtl = this.cfg.get<string>('JWT_REFRESH_TTL', '7d');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...basePayload, type: 'access' as const },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { secret, expiresIn: accessTtl as any },
      ),
      this.jwt.signAsync(
        { ...basePayload, type: 'refresh' as const },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { secret, expiresIn: refreshTtl as any },
      ),
    ]);
    return { accessToken, refreshToken };
  }
}
