# Migración a arquitectura escalable: NestJS + Frontend SPA

> **Objetivo**: convertir `short-scanner-v22.html` (app monolítica de un solo archivo HTML que corre en el navegador) en un sistema **cliente/servidor escalable** con un backend NestJS que centraliza el scanning y un frontend desacoplado con interfaz gráfica moderna.

---

## 1. Por qué migrar

### Limitaciones del v22 actual
- **Cada navegador escanea independientemente.** N usuarios = N veces el tráfico hacia Binance. No hay caché compartido.
- **Persistencia frágil**: `localStorage` se pierde si el usuario limpia el navegador o cambia de dispositivo.
- **Sin multi-dispositivo**: tus trades en el celular no aparecen en la laptop.
- **Sin histórico real**: no se guarda el resultado de scans pasados, no se puede hacer backtesting.
- **Aprendizaje aislado**: los pesos se entrenan solo con tu historia; con un backend se puede agregar entrenamiento global anónimo opcional.
- **Sin alertas si el navegador está cerrado**: el scan se detiene cuando cierras la pestaña.
- **Telegram credentials viven en el cliente**: cualquiera con acceso al navegador los ve.
- **No se puede correr 24/7** sin tener la pestaña abierta.

### Qué resuelve la migración
- **Un solo motor de scanning** que sirve a múltiples clientes vía WebSocket / REST.
- **Persistencia real** (Supabase / Postgres) con backups automáticos, multi-dispositivo, histórico completo.
- **Workers de scan corriendo 24/7** independientes del cliente.
- **Telegram, email, push** orquestados server-side.
- **Multi-usuario** con autenticación.
- **Base para features avanzadas**: backtesting, paper trading, modelos ML de scoring, dashboards históricos.

---

## 2. Arquitectura propuesta

```
┌────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (SPA)                            │
│              React + Vite + TypeScript + Tailwind                  │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────────────┐   │
│  │  Scanner UI  │  │  Trades UI  │  │   Settings / Telegram    │   │
│  └──────┬───────┘  └──────┬──────┘  └────────────┬─────────────┘   │
│         │                 │                      │                 │
│         └─────────┬───────┴──────────────────────┘                 │
│                   │   REST (HTTP)  +  WebSocket (Socket.IO)        │
└───────────────────┼────────────────────────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────────────────────────┐
│                        BACKEND (NestJS)                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  HTTP Layer:  AuthController · ScansController ·             │  │
│  │               TradesController · SettingsController          │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  WebSocket Gateway:  ScansGateway (emite ticks, alertas)     │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  Services / Domain:                                          │  │
│  │   · ScannerService     (orquesta el ciclo de 2 min)          │  │
│  │   · BinanceService     (cliente HTTP a api/fapi.binance)     │  │
│  │   · IndicatorsService  (RSI, divergencia, etc.)              │  │
│  │   · ScoringService     (calcScore + getVerdict)              │  │
│  │   · LearningService    (recalcula WEIGHTS por usuario)       │  │
│  │   · TelegramService    (envía alertas)                       │  │
│  │   · AlertDispatcher    (decide a quién avisar)               │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  Schedulers / Workers:                                       │  │
│  │   · @Cron('*/2 * * * *')  → ScannerService.runScan()         │  │
│  │   · BullMQ workers para fanout de alertas Telegram           │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  Repos (TypeORM):  User · Trade · Scan · Alert · TrackedToken│  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────┬─────────────────────┘
               │                               │
       ┌───────▼────────┐              ┌───────▼────────┐
       │    Supabase    │              │     Redis      │
       │ (Postgres+Auth)│              │ (cache+queues) │
       └────────────────┘              └────────────────┘
                                                │
                                  ┌─────────────▼────────────────┐
                                  │  APIs externas: Binance,     │
                                  │  Telegram                    │
                                  └──────────────────────────────┘
```

---

## 3. Stack recomendado

| Capa | Tecnología | Por qué |
|------|------------|---------|
| Backend framework | **NestJS** (TypeScript) | DI, modular, decoradores, scheduler integrado |
| ORM | **TypeORM** (`@nestjs/typeorm`) | Integración nativa con Nest vía `TypeOrmModule`, entidades como clases TS con decoradores, repositorios inyectables, migraciones versionadas |
| BD | **Supabase** (Postgres 15) | Postgres managed + backups + Auth + Realtime opcional. Tier gratuito (500MB + 50K MAU) suficiente para arrancar. La API NestJS se conecta vía `DATABASE_URL` como cualquier Postgres |
| Auth | **Supabase Auth** | Email/password + OAuth listos, JWTs firmados que NestJS valida vía JWKS. Evita re-implementar register/login/reset password/email verify. Ver §4.7 para la decisión |
| Cache/colas | **Redis 7** + **BullMQ** | Cache de tickers, colas de alertas Telegram |
| Realtime | **Socket.IO** (integrado en NestJS) | Push de resultados de scan, alertas |
| HTTP client | **axios** o `undici` | Llamadas a Binance |
| Auth client | **@supabase/supabase-js** (en el frontend) | Maneja login/refresh/logout/session sin código propio |
| Auth verify | **passport-jwt** + **jwks-rsa** | NestJS valida los JWT de Supabase contra el JWKS público del proyecto |
| Validación | **class-validator** + **Zod** | DTOs y payloads de WS |
| Logs | **pino** + **pino-pretty** dev | Bajo overhead |
| Métricas | **prom-client** + Grafana | Opcional, fase 2 |
| Tests | **Jest** + **supertest** | NestJS lo trae out-of-the-box |
| Frontend | **React 18 + Vite + TypeScript** | Rápido, comunidad |
| UI library | **shadcn/ui** + **Tailwind** | Look profesional sin reinventar |
| Gráficos | **lightweight-charts** (TradingView) | Velas, sparklines |
| Estado | **TanStack Query** + **Zustand** | Server-state + UI-state |
| WS client | **socket.io-client** | Match con backend |

**Alternativas razonables**: Fastify backend (más rápido que Express bajo Nest), Postgres self-hosted en vez de Supabase (más control, más mantenimiento), Next.js en vez de Vite SPA (si quieres SSR del landing).

**Por qué Supabase y no Postgres directo**:
- Backups point-in-time automáticos sin configurar nada.
- Dashboard SQL editor para queries ad-hoc sin abrir `psql`.
- Auth completo (signup/login/reset/OAuth) que ahorra ~500 líneas de código backend.
- Tier gratuito generoso para arrancar; upgrade a Pro ($25/mes) cuando se necesite.
- Se sigue siendo Postgres puro abajo: si en el futuro hay que migrar a RDS / Neon / self-hosted, solo cambian `DATABASE_URL` y el módulo de auth — las entidades TypeORM y las migraciones son portables.

---

## 4. Backend: módulos NestJS

Cada módulo es un directorio bajo `apps/api/src/modules/` con `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` (DTOs de request/response con `class-validator`), y `entities/` (clases TypeORM decoradas con `@Entity()`, `@Column()`, etc. — son simultáneamente el modelo de BD y el tipo del dominio).

### 4.1 `BinanceModule`
Envuelve toda la comunicación con `api.binance.com` y `fapi.binance.com`. Equivalente a las funciones `fetchAllPairs`, `fetchKlines`, `fetchFundingRate` del v22 (líneas ~834–847 del HTML).

```ts
// binance.service.ts
@Injectable()
export class BinanceService {
  async fetchAllTickers(): Promise<Ticker[]> { /* GET /api/v3/ticker/24hr */ }
  async fetchKlines(symbol: string, interval='4h', limit=50): Promise<Kline[]> {}
  async fetchFundingRate(symbol: string): Promise<number | null> {}
  async fetchManyInBatches<T>(items: string[], fn, batchSize=10): Promise<T[]> {}
}
```

- **Rate-limit aware**: respeta `X-MBX-USED-WEIGHT-1M`. Si supera 1100, mete pausa.
- **Caché Redis**: los tickers se cachean 30s para que dos scans cercanos no peguen dos veces.
- **Reintentos exponenciales** con jitter sobre errores 5xx y `ETIMEDOUT`.

### 4.2 `IndicatorsModule`
Lógica pura, sin I/O. Es una traducción directa de las funciones del v22:

| Función v22 (línea) | Servicio nuevo |
|---|---|
| `calcRSI` (855) | `IndicatorsService.rsi(klines, period)` |
| `calcRSISeries` (876) | `IndicatorsService.rsiSeries(klines, period)` |
| `findSwingHighs` (901), `findPeaks` (933) | helpers privados |
| `detectBearishDivergence` (939) | `IndicatorsService.bearishDivergence(klines, lookback)` |
| `lastCandlesColors`, `countLastRedCandles` (1008, 1016) | `IndicatorsService.candleStats(klines, n)` |

**Reglas de migración**:
- 100% determinístico → tests unitarios con fixtures de klines reales.
- No depende de tiempo ni de I/O → fácil de testear.

### 4.3 `ScoringModule`
Equivalente a las funciones `grade*` + `calcScore` + `getVerdict` (líneas 1034–1153 del v22).

```ts
@Injectable()
export class ScoringService {
  score(token: TokenSnapshot, weights: Weights, mode: Mode, thresholds: Thresholds): Score
  verdict(score: Score, token: TokenSnapshot, mode: Mode): Verdict
}
```

- **Recibe weights como parámetro** (no globales). Cada usuario tiene los suyos en BD.
- Conservar el shape `{ points, state, passed }` por condición — el módulo de aprendizaje depende de `passed`.
- Mantener proporcionalidad (no binario): un RSI de 78 da 85% de los puntos.

### 4.4 `ScannerModule` ⭐ núcleo del sistema

```ts
@Injectable()
export class ScannerService {
  @Cron('*/2 * * * *')   // cada 2 minutos
  async runScan() {
    const tickers = await this.binance.fetchAllTickers();
    const candidates = this.filterAndRank(tickers);  // top N gainers, sin stables
    const enriched = await this.enrich(candidates);  // klines + funding en paralelo
    const btcTrend = await this.computeBtcTrend();

    // Por cada usuario activo, scorear con SUS pesos y SU modo
    const users = await this.users.findActive();
    for (const u of users) {
      const scored = enriched.map(t => this.scoring.score(t, u.weights, u.mode, u.thresholds));
      const newAlerts = this.diffAgainstLastScan(u.id, scored);
      await this.scans.persist(u.id, scored);
      this.gateway.emitToUser(u.id, 'scan:update', scored);
      for (const a of newAlerts) this.alerts.dispatch(u.id, a);
    }
  }
}
```

Decisiones clave:
- **Una sola descarga de Binance por ciclo** sirve a todos los usuarios → el ahorro vs v22 escala lineal con número de usuarios.
- **El scoring sí es por usuario** porque cada uno tiene weights aprendidos distintos.
- **Diff contra el último scan** para no re-alertar el mismo token (equivalente a `alertedSet` del v22).
- **`runScan` debe ser idempotente y reentrante-safe**: usar un lock en Redis (`SET scan:lock NX EX 110`) para que dos instancias del pod no escaneen simultáneamente.

### 4.5 `AlertsModule` + Telegram
```ts
@Injectable()
export class AlertDispatcher {
  async dispatch(userId: string, alert: Alert) {
    await this.alertsRepo.create({ userId, ...alert });
    await this.alertsQueue.add('telegram', { userId, alert });
    this.gateway.emitToUser(userId, 'alert:new', alert);
  }
}

// worker.ts
@Processor('alerts')
export class AlertsProcessor {
  @Process('telegram')
  async sendTelegram(job: Job<{ userId, alert }>) {
    const cfg = await this.users.getTelegramConfig(job.data.userId);
    if (!cfg) return;
    await this.telegram.send(cfg.token, cfg.chatId, formatAlert(job.data.alert));
  }
}
```

- **Cola BullMQ** = retries automáticos, throttling per-user, observabilidad.
- **Tokens Telegram cifrados en BD** con KMS o `crypto.createCipheriv` + clave en env var.

### 4.6 `LearningModule`
Equivalente a `recalculateWeights` (línea 1740 del v22), pero **por usuario**.

```ts
@Injectable()
export class LearningService {
  async recalculate(userId: string) {
    const trades = await this.trades.findClosedByUser(userId);
    if (trades.length < 3) return DEFAULT_WEIGHTS;
    const winRates = computePerConditionWinRate(trades);
    const newWeights = rebalanceWeights(winRates);
    await this.users.updateWeights(userId, newWeights);
    return newWeights;
  }
}
```

Se dispara cuando el usuario marca el resultado de un trade (POST `/trades/:id/close`).

### 4.7 `AuthModule` — Supabase Auth + validación JWT en NestJS

**Decisión**: usamos **Supabase Auth** para signup/login/refresh/reset, y el backend NestJS **solo valida** los JWTs que Supabase emite. Esto elimina ~500 líneas de código de auth y nos da OAuth (Google, GitHub) gratis cuando se necesite.

#### Flujo

```
┌─────────────┐  signup/login    ┌────────────────┐
│  Frontend   │ ───────────────► │  Supabase Auth │
│             │ ◄─── access JWT  │   (auth.users) │
│             │     + refresh    └────────────────┘
└──────┬──────┘
       │ Authorization: Bearer <access JWT>
       ▼
┌────────────────────────────────────────────────┐
│  NestJS API                                    │
│  · Valida JWT contra JWKS público de Supabase  │
│  · Extrae sub (= UUID de auth.users)           │
│  · Carga/crea User local con FK a auth.users   │
└────────────────────────────────────────────────┘
```

#### Backend: `SupabaseJwtStrategy`

```ts
// modules/auth/strategies/supabase-jwt.strategy.ts
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'supabase-jwt') {
  constructor(cfg: ConfigService) {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${cfg.get('SUPABASE_URL')}/auth/v1/.well-known/jwks.json`,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: 'authenticated',
      issuer: `${cfg.get('SUPABASE_URL')}/auth/v1`,
      algorithms: ['ES256', 'RS256'],
    });
  }

  async validate(payload: SupabaseJwtPayload) {
    // payload.sub es el UUID de auth.users
    // payload.email, payload.role ('authenticated'), payload.user_metadata
    return { id: payload.sub, email: payload.email };
  }
}
```

```ts
// modules/auth/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('supabase-jwt') {}

// app.module.ts — aplicarlo global con bypass para @Public()
{ provide: APP_GUARD, useClass: JwtAuthGuard }
```

#### Provisionado del `User` local

Al primer request autenticado de cada usuario, un interceptor (`EnsureLocalUserInterceptor`) hace upsert del `User` local enlazado al `auth.users.id` de Supabase:

```ts
async ensureLocalUser(authUserId: string, email: string): Promise<User> {
  return this.users.upsert({
    id: authUserId,                                // mismo UUID que auth.users.id
    email,
    mode: Mode.STRICT,
    thresholds: DEFAULT_THRESHOLDS,
    weights: DEFAULT_WEIGHTS,
  }, { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true });
}
```

#### Endpoints

El backend **no expone** `POST /auth/register`, `/login`, `/refresh`, `/logout` — eso lo hace el cliente Supabase directamente contra `supabase.auth.signUp(...)`, `signInWithPassword(...)`, etc.

El backend **sí expone**:
- `GET /me` — perfil del usuario local (requiere JWT válido).
- `DELETE /me` — borrar cuenta (cascade hacia trades, scans, alerts; opcionalmente llamar a la Admin API de Supabase para borrar también `auth.users`).

#### Por qué no rolar nuestro propio JWT auth

- Email verification, password reset, magic links, rate-limiting de intentos: Supabase los trae listos.
- OAuth providers (Google, GitHub, Discord): un toggle en el dashboard, cero código backend.
- Rotación de claves automática; nuestro backend no maneja secretos de firma, solo valida contra JWKS público.

#### Si en el futuro quieres salir de Supabase Auth

Reemplazar `SupabaseJwtStrategy` por una estrategia propia (`argon2` + JWT firmado por nosotros). El `User.id` sigue siendo un UUID, las FKs no cambian. **El módulo de auth está aislado**: el resto del backend solo conoce `req.user.id`.

### 4.8 `UsersModule` / `SettingsModule`
- `GET/PATCH /me` — perfil, modo (`strict`/`flex`), thresholds, weights actuales.
- `PUT /me/telegram` — guarda token + chatId cifrados.
- `POST /me/telegram/test` — equivalente al `testTelegram()` del v22.

### 4.9 `ScansController` / `TradesController`
- `GET /scans/current` — último resultado del scan para el usuario.
- `GET /scans/history?from=&to=` — histórico (nuevo respecto a v22).
- `POST /trades` — registrar trade (snapshot de condiciones).
- `PATCH /trades/:id/close` — marcar win/loss → dispara `LearningService.recalculate`.
- `GET /trades?status=` — listar.

### 4.10 `ScansGateway` (WebSocket)
```ts
@WebSocketGateway({ namespace: '/scans', cors: { ... } })
export class ScansGateway implements OnGatewayConnection {
  @SubscribeMessage('subscribe')
  onSubscribe(client, payload) { client.join(`user:${client.userId}`); }

  emitToUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
```

Eventos que emite:
- `scan:tick` — heartbeat de progreso del ciclo (reemplaza la barra `progress-fill`).
- `scan:update` — payload completo del último scan.
- `alert:new` — alerta GO SHORT recién detectada (flash rojo del v22).
- `btc:trend` — cambio de BTC 24h.

---

## 4.11 `TrackingModule` — tracking persistente de tokens pumpeando ⭐

**Problema que resuelve**: en el v22, cada scan es un snapshot independiente. Si un token entra al top gainers, pumpea durante 6 horas, cae del top, y al día siguiente vuelve a subir, el sistema **lo trata como un token nuevo** y pierde toda la historia. Peor: a las **00:00 UTC** el `priceChangePercent` del ticker 24h de Binance se resetea, así que un rally que lleva 3 días seguidos "desaparece" del top gainers cada noche aunque siga vivo.

Esto es crítico para shortear bien: **un pump de día 1 con RSI 80 es muy distinto a un pump de día 4 con RSI 80**. El segundo está mucho más agotado y es mejor candidato. Sin tracking persistente esa distinción se pierde.

### Modelo conceptual

Cada token detectado pumpeando se convierte en un **`TrackedToken`** con ciclo de vida propio, independiente de los scans individuales:

```
       primer detect
            │
            ▼
       ┌─────────┐    sigue en gainers     ┌─────────┐
       │ ACTIVE  │ ◄─────────────────────► │ ACTIVE  │
       └────┬────┘                         └────┬────┘
            │                                   │
            │ sale del top gainers              │ usuario abre short
            ▼                                   ▼
       ┌─────────┐                         ┌─────────┐
       │ DORMANT │ ◄── vuelve a pumpear    │ SHORTED │
       └────┬────┘                         └────┬────┘
            │                                   │
            │ N horas sin reaparecer            │ se cierra el trade
            ▼                                   ▼
       ┌─────────┐                         ┌─────────┐
       │ARCHIVED │                         │ CLOSED  │
       └─────────┘                         └─────────┘
```

| Estado | Significado | Visible en UI |
|---|---|---|
| `ACTIVE` | Vino en el último scan, sigue pumpeando | Sí, en lista principal |
| `DORMANT` | Lo perdimos del top gainers pero sigue siendo candidato; ej. corrigió 5% y puede reanudar | Sí, en sección "En vigilancia" |
| `SHORTED` | El usuario abrió un short basándose en este tracking | Sí, en sección "Posiciones abiertas" |
| `CLOSED` | El trade cerró (win/loss/breakeven) | Solo en histórico |
| `ARCHIVED` | Pasó > N horas en DORMANT sin reaparecer; rally muerto | Solo en histórico |

### Comportamiento del scanner

```ts
@Injectable()
export class TrackingService {
  /**
   * Llamado por ScannerService al final de cada ciclo de scan,
   * después de calcular scores. Reconcilia el resultado del scan
   * con el estado persistente de tokens trackeados.
   */
  async reconcile(userId: string, scanResults: ScoredToken[]) {
    const now = new Date();
    const detectedSymbols = new Set(scanResults.map(s => s.symbol));

    // 1) Tokens nuevos o que reaparecen
    for (const t of scanResults) {
      const existing = await this.repo.findByUserAndSymbol(userId, t.symbol);

      if (!existing) {
        // Primera vez que lo vemos pumpeando
        await this.repo.create({
          userId,
          symbol: t.symbol,
          firstDetectedAt: now,
          lastSeenPumpingAt: now,
          status: 'ACTIVE',
          firstDetectionSnapshot: t.snapshot,
          peakScore: t.score,
          peakRsi: t.snapshot.rsi,
          peakChange24h: t.snapshot.change,
          peakPrice: t.snapshot.price,
          daysActive: 1,
          scansActive: 1,
        });
      } else {
        // Ya existía: actualizar high-water marks + contadores
        await this.repo.update(existing.id, {
          lastSeenPumpingAt: now,
          status: existing.status === 'DORMANT' ? 'ACTIVE' : existing.status,
          peakScore: Math.max(existing.peakScore, t.score),
          peakRsi: Math.max(existing.peakRsi, t.snapshot.rsi),
          peakChange24h: Math.max(existing.peakChange24h, t.snapshot.change),
          peakPrice: Math.max(existing.peakPrice, t.snapshot.price),
          // daysActive crece al cruzar medianoche UTC respecto a firstDetectedAt
          daysActive: daysSinceUTC(existing.firstDetectedAt, now),
          scansActive: existing.scansActive + 1,
          reappearances: existing.status === 'DORMANT'
            ? existing.reappearances + 1
            : existing.reappearances,
        });
      }

      // Siempre persistir el snapshot del scan vinculado al trackedToken
      await this.snapshots.append(existing?.id ?? newId, t.snapshot);
    }

    // 2) Tokens que estaban ACTIVE y NO aparecieron en este scan → DORMANT
    const previouslyActive = await this.repo.findByUserAndStatus(userId, 'ACTIVE');
    for (const tracked of previouslyActive) {
      if (!detectedSymbols.has(tracked.symbol)) {
        await this.repo.update(tracked.id, { status: 'DORMANT' });
      }
    }

    // 3) DORMANT que llevan > DORMANT_TTL sin reaparecer → ARCHIVED
    const dormant = await this.repo.findStaleDormant(userId, DORMANT_TTL_HOURS);
    for (const tracked of dormant) {
      await this.repo.update(tracked.id, { status: 'ARCHIVED' });
    }
  }
}
```

### Reglas clave

- **Por-usuario**: cada usuario tiene su propio set de tokens trackeados. Si Pepe shortea WLD y Juan no, ambos pueden tener WLD en estados distintos.
- **`scansActive` y `daysActive`** son la métrica de "qué tan agotado está el pump":
  - `daysActive ≥ 3` → flag `OVEREXTENDED_DAYS` en el scoring → bonus de puntos para shortear.
  - `scansActive ≥ 24` (≈ 48h continuos en top gainers) → flag `OVEREXTENDED_SCANS`.
- **`peakScore` y `peakRsi`** sirven para detectar **divergencia entre el peak histórico y el estado actual**: si peakRsi fue 88 hace 2 días y ahora está en 72 pero el precio sigue subiendo, eso es divergencia bajista a nivel macro (mucho más fuerte que la intra-vela de 4H).
- **`reappearances`**: cuántas veces salió y volvió a entrar al top gainers. Cada reaparición tras DORMANT es un intento de bull trap; alto número = mercado indeciso, oportunidad de short.
- **El reset diario UTC NO borra nada**: el ticker 24h se resetea, sí, pero nuestro `lastSeenPumpingAt` y `firstDetectedAt` son fechas absolutas. El campo `change24h` puede bajar de 50% a 3% en el cambio de día sin que perdamos el contexto del rally acumulado.

### Cómo se usa en el scoring

Cuando `ScoringService.score()` corre, además de los grades actuales (RSI, funding, etc.), consulta el `TrackedToken` correspondiente y añade puntos por:

| Señal de tracking | Puntos sugeridos | Cuándo activa |
|---|---|---|
| Pump multi-día | +10 | `daysActive ≥ 3` |
| Pump muy persistente | +5 | `scansActive ≥ 24` |
| Divergencia macro RSI | +15 | `peakRsi - currentRsi ≥ 10` y precio aún subiendo |
| Múltiples bull traps | +10 | `reappearances ≥ 2` |

Estos son **nuevos pesos** que el `LearningService` también puede recalibrar por usuario.

### Endpoints REST

- `GET /tracking?status=ACTIVE,DORMANT` — listar tokens trackeados del usuario.
- `GET /tracking/:id` — detalle con timeline completa de snapshots.
- `GET /tracking/:id/timeline` — serie temporal de score/rsi/precio/funding para graficar el rally.
- `POST /tracking/:id/short` → marca como `SHORTED` y crea un `Trade` enlazado.
- `DELETE /tracking/:id` — descartar manualmente (ej. el usuario considera que ya no aplica).

### Eventos WebSocket añadidos

- `tracking:new` — un token nuevo entró a tracking.
- `tracking:reappeared` — un token DORMANT volvió a aparecer (reaparece a ACTIVE).
- `tracking:peak` — el token rompió su peakScore previo (alerta visual).
- `tracking:overextended` — cruzó umbral de `daysActive ≥ 3`.

### UI: nueva sección "Watchlist"

Tab nueva en el frontend (después de "Scanner") con tres listas:

1. **Activos** — tokens pumpeando en el último scan, ordenados por `score` desc.
2. **En vigilancia** — DORMANT, ordenados por proximidad a reaparecer (`peakScore` desc).
3. **Histórico** — ARCHIVED + CLOSED, para análisis post-mortem.

Cada fila muestra: símbolo, **días activos**, **scans activos**, peakScore, current score, delta peak↔current RSI, reaparecencias, gráfico sparkline de la trayectoria completa.

---

## 5. Modelo de datos (TypeORM)

Las entidades son clases TypeScript con decoradores. Cada archivo vive en el módulo dueño: `modules/users/entities/user.entity.ts`, `modules/tracking/entities/tracked-token.entity.ts`, etc. Se registran en cada módulo con `TypeOrmModule.forFeature([...])`.

### Setup raíz (Supabase / Postgres)

Supabase expone **dos URLs de conexión**, y elegir la correcta es crítico:

| URL | Puerto | Modo | Cuándo usar |
|---|---|---|---|
| **Direct connection** | 5432 | Session | Migraciones (TypeORM CLI), local dev, scripts puntuales |
| **Session pooler** | 5432 (host distinto) | Session vía PgBouncer | Servidor persistente NestJS — **recomendado para nosotros** |
| **Transaction pooler** | 6543 | Transaction vía PgBouncer | Serverless / Edge Functions. **NO usar con TypeORM** (sin prepared statements, rompe queries con parámetros) |

NestJS corre como proceso persistente, así que usamos **Session pooler** para la app y **Direct connection** para migraciones.

```ts
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get('DATABASE_URL'),       // session pooler (puerto 5432)
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*.{ts,js}'],
        migrationsRun: false,                // correr migraciones via CLI, no en boot
        synchronize: false,                  // ⚠️ NUNCA true fuera de prototipos
        ssl: { rejectUnauthorized: false },  // Supabase requiere SSL
        extra: {
          max: 20,                           // pool size razonable para session pooler
          connectionTimeoutMillis: 10_000,
          idleTimeoutMillis: 30_000,
        },
        logging: cfg.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
      }),
    }),
  ],
})
export class AppModule {}
```

```ts
// data-source.ts (usado por TypeORM CLI para migraciones)
// IMPORTANTE: usa DATABASE_DIRECT_URL (puerto 5432 directo, NO pooler)
// porque las migraciones pueden ejecutar comandos DDL que el pooler bloquea.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_DIRECT_URL,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  ssl: { rejectUnauthorized: false },
});
```

#### Sobre RLS (Row-Level Security) de Supabase

Supabase ofrece RLS a nivel BD usando el JWT del usuario. **No la usamos** porque:
- El único cliente de la BD es nuestra API NestJS (no hay clientes Supabase JS hablando directo a `postgrest`).
- El control de acceso vive en los services NestJS (`WHERE userId = req.user.id`).
- RLS añade complejidad y latencia sin beneficio cuando la API es el único intermediario.

Si en el futuro se permite que el frontend lea ciertas tablas directamente vía supabase-js (ej. para Realtime), entonces sí habilitar RLS solo en esas tablas específicas.

### Enums compartidos

```ts
// modules/users/enums/mode.enum.ts
export enum Mode { STRICT = 'STRICT', FLEX = 'FLEX' }

// modules/tracking/enums/tracked-status.enum.ts
export enum TrackedStatus {
  ACTIVE   = 'ACTIVE',    // visto en el último scan
  DORMANT  = 'DORMANT',   // sigue trackeado pero no apareció en el último scan
  SHORTED  = 'SHORTED',   // usuario abrió posición
  CLOSED   = 'CLOSED',    // trade cerrado
  ARCHIVED = 'ARCHIVED',  // > N horas en DORMANT, rally muerto
}

// modules/trades/enums/trade-result.enum.ts
export enum TradeResult { WIN = 'WIN', LOSS = 'LOSS', BREAKEVEN = 'BREAKEVEN' }
```

### `User`

```ts
// modules/users/entities/user.entity.ts
//
// El id NO se autogenera: es el mismo UUID que auth.users.id de Supabase.
// Se popula al primer request autenticado via EnsureLocalUserInterceptor (§4.7).
// No guardamos passwordHash — la auth la maneja Supabase Auth.
@Entity('users')
export class User {
  @PrimaryColumn('uuid') id: string;       // = auth.users.id (Supabase)

  @Index({ unique: true })
  @Column() email: string;

  @Column({ type: 'enum', enum: Mode, default: Mode.STRICT })
  mode: Mode;

  @Column({ type: 'jsonb' })
  thresholds: { pumpPct: number; topN: number; minVolUsd: number };

  @Column({ type: 'jsonb' })
  weights: {
    pump: number; funding: number; rsi: number; divergence: number;
    redCandles: number; btcOk: number; liquidity: number;
    // Pesos nuevos del tracking (§4.11):
    daysActive?: number; scansActive?: number;
    macroDivergence?: number; reappearances?: number;
  };

  @OneToOne(() => TelegramConfig, (tg) => tg.user, { cascade: true })
  telegram?: TelegramConfig;

  @OneToMany(() => Trade, (t) => t.user) trades: Trade[];
  @OneToMany(() => ScanResult, (s) => s.user) scans: ScanResult[];
  @OneToMany(() => Alert, (a) => a.user) alerts: Alert[];
  @OneToMany(() => TrackedToken, (t) => t.user) trackedTokens: TrackedToken[];

  @CreateDateColumn() createdAt: Date;
}
```

### `TelegramConfig`

```ts
// modules/users/entities/telegram-config.entity.ts
@Entity('telegram_configs')
export class TelegramConfig {
  @PrimaryColumn('uuid') userId: string;

  @OneToOne(() => User, (u) => u.telegram, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Cifrado AES-256-GCM con TELEGRAM_ENCRYPTION_KEY antes de persistir.
  // Se almacena el ciphertext + IV + authTag concatenados.
  @Column({ type: 'bytea' }) token: Buffer;

  @Column() chatId: string;

  @Column({ default: false }) nearAlertsEnabled: boolean;
}
```

### `ScanResult`

```ts
// modules/scans/entities/scan-result.entity.ts
@Entity('scan_results')
@Index(['userId', 'symbol', 'ts'])
@Index(['trackedTokenId', 'ts'])
@Index(['ts'])
export class ScanResult {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column('uuid') userId: string;
  @ManyToOne(() => User, (u) => u.scans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid', nullable: true }) trackedTokenId: string | null;
  @ManyToOne(() => TrackedToken, (t) => t.scans, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'trackedTokenId' })
  trackedToken?: TrackedToken;

  @Column() symbol: string;

  @CreateDateColumn({ type: 'timestamptz' }) ts: Date;

  @Column('int') score: number;
  @Column() verdict: string;

  // { change, rsi, fundingRate, divergence, redCount, vol, candleColors, price }
  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
}
```

### `TrackedToken` — núcleo del tracking persistente (§4.11)

```ts
// modules/tracking/entities/tracked-token.entity.ts
@Entity('tracked_tokens')
@Unique('uq_user_symbol_first_detected', ['userId', 'symbol', 'firstDetectedAt'])
@Index(['userId', 'status'])
@Index(['userId', 'symbol'])
@Index(['status', 'lastSeenPumpingAt'])
export class TrackedToken {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column('uuid') userId: string;
  @ManyToOne(() => User, (u) => u.trackedTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column() symbol: string;

  @Column({ type: 'enum', enum: TrackedStatus, default: TrackedStatus.ACTIVE })
  status: TrackedStatus;

  // ── Tiempos ──────────────────────────────────────────────
  @CreateDateColumn({ type: 'timestamptz' }) firstDetectedAt: Date;
  @Column({ type: 'timestamptz' }) lastSeenPumpingAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) archivedAt: Date | null;

  // ── Snapshot de la primera detección (post-mortem) ──────
  @Column({ type: 'jsonb' }) firstDetectionSnapshot: Record<string, unknown>;

  // ── High-water marks ────────────────────────────────────
  @Column('int') peakScore: number;
  @Column('float') peakRsi: number;
  @Column('float') peakChange24h: number;
  @Column('double precision') peakPrice: number;
  @Column({ type: 'timestamptz' }) peakAt: Date;

  // ── Contadores de persistencia (agotamiento del pump) ───
  @Column('int', { default: 1 }) daysActive: number;
  @Column('int', { default: 1 }) scansActive: number;
  @Column('int', { default: 0 }) reappearances: number;

  // ── Trade asociado (cuando el usuario abre short) ───────
  @Column({ type: 'uuid', nullable: true, unique: true }) tradeId: string | null;
  @OneToOne(() => Trade, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'tradeId' })
  trade?: Trade;

  @OneToMany(() => ScanResult, (s) => s.trackedToken) scans: ScanResult[];
}
```

### `Trade`

```ts
// modules/trades/entities/trade.entity.ts
@Entity('trades')
@Index(['userId', 'closedAt'])
export class Trade {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column('uuid') userId: string;
  @ManyToOne(() => User, (u) => u.trades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column() symbol: string;

  @CreateDateColumn({ type: 'timestamptz' }) openedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) closedAt: Date | null;

  @Column({ type: 'enum', enum: TradeResult, nullable: true })
  result: TradeResult | null;

  @Column({ type: 'jsonb' }) entrySnapshot: Record<string, unknown>;

  // Contexto del tracking al abrir el short
  @Column('int', { nullable: true }) daysActiveAtEntry: number | null;
  @Column('int', { nullable: true }) scansActiveAtEntry: number | null;
  @Column('int', { nullable: true }) peakScoreAtEntry: number | null;

  @Column({ type: 'text', nullable: true }) notes: string | null;
}
```

### `Alert`

```ts
// modules/alerts/entities/alert.entity.ts
@Entity('alerts')
@Index(['userId', 'sentAt'])
export class Alert {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column('uuid') userId: string;
  @ManyToOne(() => User, (u) => u.alerts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column() symbol: string;
  @Column() verdict: string;
  @Column('int') score: number;

  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' }) sentAt: Date;

  // { telegram: { sent: true, messageId }, ... }
  @Column({ type: 'jsonb' }) channels: Record<string, unknown>;
}
```

### Patrón de uso en servicios

```ts
// modules/tracking/tracking.service.ts
@Injectable()
export class TrackingService {
  constructor(
    @InjectRepository(TrackedToken)
    private readonly trackedRepo: Repository<TrackedToken>,
    @InjectRepository(ScanResult)
    private readonly scanRepo: Repository<ScanResult>,
    private readonly dataSource: DataSource,
  ) {}

  async reconcile(userId: string, scanResults: ScoredToken[]) {
    // Transacción: la reconciliación es atómica para evitar estados intermedios
    await this.dataSource.transaction(async (mgr) => {
      const trackedRepo = mgr.getRepository(TrackedToken);
      const scanRepo = mgr.getRepository(ScanResult);
      // ... lógica del §4.11
    });
  }
}
```

```ts
// modules/tracking/tracking.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([TrackedToken, ScanResult])],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
```

### Migraciones

```bash
# Generar migración a partir del diff entre entidades y BD
pnpm typeorm migration:generate src/migrations/AddTrackedToken -d src/data-source.ts

# Aplicar migraciones pendientes (en CI/deploy)
pnpm typeorm migration:run -d src/data-source.ts

# Revertir la última
pnpm typeorm migration:revert -d src/data-source.ts
```

- `synchronize: false` **siempre** fuera de prototipos. Toda mutación de schema pasa por migration files versionados en git.
- Las migraciones corren en CI antes del rollout (`migration:run`), no en el `onModuleInit` del proceso.
- Para campos `jsonb` con queries frecuentes (filtros sobre `snapshot.rsi`, etc.), añadir índices **GIN** en una migración manual:
  ```sql
  CREATE INDEX scan_results_snapshot_gin ON scan_results USING gin (snapshot jsonb_path_ops);
  ```

**Razón de guardar `snapshot` como `jsonb`**: el set de condiciones puede evolucionar (agregar nuevas señales) sin romper trades viejos. La penalización es que filtros sobre campos individuales requieren índices GIN.

---

## 6. Frontend

### Estructura
```
apps/web/
├── src/
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Scanner.tsx          ← equivalente al tab Scanner v22
│   │   ├── Trades.tsx           ← tab Aprendizaje
│   │   ├── Settings.tsx         ← tab Info + Telegram config
│   │   └── History.tsx          ← NUEVO: histórico de scans
│   ├── components/
│   │   ├── ScannerTable.tsx
│   │   ├── ScannerToolbar.tsx
│   │   ├── TokenDetailDrawer.tsx
│   │   ├── AlertLog.tsx
│   │   ├── StatsGrid.tsx
│   │   ├── CandleSparkline.tsx
│   │   └── ui/                  ← shadcn primitives
│   ├── hooks/
│   │   ├── useScanStream.ts     ← Socket.IO subscription
│   │   ├── useAuth.ts
│   │   └── useTrades.ts
│   ├── lib/
│   │   ├── api.ts               ← TanStack Query client
│   │   └── socket.ts
│   └── styles/
└── vite.config.ts
```

### Patrón de datos
- **REST (TanStack Query)** para datos snapshot: perfil, settings, trades, histórico.
- **WebSocket** para tiempo real: tick de scan, alertas nuevas, progreso del ciclo.
- **Zustand** para UI-state pequeño (modal abierto, drawer del token expandido, filtros).

### Estilo
Conservar la estética del v22 (dark mode, monospace para datos numéricos, paleta `--bg #0a0a0a` / `--red #e34c5c` / `--green #4ade80`). Migrarla a variables de Tailwind:

```js
// tailwind.config.js
theme: {
  extend: {
    colors: {
      bg: { DEFAULT: '#0a0a0a', 1: '#111', 2: '#161616', 3: '#1c1c1c' },
      line: { DEFAULT: '#232323', 2: '#2e2e2e' },
      // ...
    },
    fontFamily: {
      mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      sans: ['Inter', 'system-ui', 'sans-serif'],
    },
  },
}
```

### Componente clave: `ScannerTable`
Recibe `data` de `useScanStream()`, ordena por score desc, aplica clases `row-go` / `row-near` / `row-watch` igual que el v22. La expansión del row (8 días de velas) ahora hace fetch a `/scans/:symbol/history` con caché en TanStack Query.

---

## 7. Mapeo v22 → arquitectura nueva

| Concepto v22 | Dónde vive ahora |
|---|---|
| Funciones `grade*` (1034–1110) | `ScoringService` |
| `calcScore` (1112), `getVerdict` (1135) | `ScoringService` |
| `calcRSI`, `detectBearishDivergence` (855, 939) | `IndicatorsService` |
| `fetchNow` (1170) | `ScannerService.runScan()` (cron) |
| `batchedMap` (1156) | `BinanceService.fetchManyInBatches` |
| `WEIGHTS` global (782) | Columna `User.weights` (JSONB) |
| `trades` global (783) | Tabla `Trade` |
| `LS_*` keys (773–778) | Tablas Postgres + cookie de sesión |
| `LS_LEGACY` migrations | Migraciones TypeORM versionadas (`typeorm migration:run`) |
| `alertedSet`, `alertFirstSeen` | Tabla `Alert` + cache Redis para dedupe corto |
| _(no existe en v22)_ | **Tabla `TrackedToken`** — tracking persistente cross-día (ver §4.11) |
| Ticker 24h reseteándose a las 00:00 UTC | Resuelto: `TrackedToken.firstDetectedAt` y `daysActive` sobreviven el reset |
| `sendShortAlert` (2081) | `AlertDispatcher` + worker BullMQ |
| `recalculateWeights` (1740) | `LearningService.recalculate` |
| `mode` global (771) | Columna `User.mode` |
| `STABLE` set (707) | Constante en `BinanceService` (no cambia) |
| Countdown UI | Servidor emite `scan:tick` por WS |
| `historyCache` (1396) | Endpoint `/scans/:sym/history` + TanStack Query |
| Modal `showModal` (2178) | shadcn `<Dialog>` |
| `beep()` (802) | Hook `useSoundAlert()` en el cliente |

---

## 8. Estructura de monorepo sugerida

```
short-scanner/
├── apps/
│   ├── api/                     ← NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── data-source.ts          ← DataSource de TypeORM (CLI + runtime)
│   │   │   ├── migrations/              ← migraciones TypeORM versionadas
│   │   │   │   ├── 1700000000000-InitSchema.ts
│   │   │   │   └── 1700000001000-AddTrackedToken.ts
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── binance/
│   │   │       ├── indicators/
│   │   │       ├── scoring/
│   │   │       ├── scanner/
│   │   │       ├── tracking/            ← TrackedToken + reconcile (§4.11)
│   │   │       │   ├── entities/
│   │   │       │   │   └── tracked-token.entity.ts
│   │   │       │   ├── enums/
│   │   │       │   ├── tracking.module.ts
│   │   │       │   ├── tracking.service.ts
│   │   │       │   └── tracking.controller.ts
│   │   │       ├── alerts/
│   │   │       ├── learning/
│   │   │       ├── users/
│   │   │       │   └── entities/
│   │   │       │       ├── user.entity.ts
│   │   │       │       └── telegram-config.entity.ts
│   │   │       ├── trades/
│   │   │       │   └── entities/trade.entity.ts
│   │   │       └── scans/
│   │   │           └── entities/scan-result.entity.ts
│   │   ├── test/
│   │   └── package.json
│   └── web/                     ← React/Vite
│       ├── src/
│       └── package.json
├── packages/
│   ├── shared-types/            ← DTOs compartidos API ↔ Web
│   │   └── src/
│   │       ├── alerts.ts
│   │       ├── scans.ts
│   │       └── trades.ts
│   └── eslint-config/
├── docker/
│   ├── api.Dockerfile
│   ├── web.Dockerfile
│   └── docker-compose.yml
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── pnpm-workspace.yaml
├── turbo.json                   ← Turborepo
└── README.md
```

**Gestor de paquetes**: `pnpm` + **Turborepo** (caché de builds, ejecución paralela).

---

## 9. Despliegue

### Setup recomendado (Supabase + managed everything, ~$0–30/mes para arrancar)
- **BD**: **Supabase** (Free tier: 500MB Postgres + 50K MAU + 5GB transfer; Pro $25/mes cuando se necesite).
- **API NestJS**: **Railway** / **Fly.io** / **Render** ($5–15/mes según uso).
- **Redis**: **Upstash** (Free tier: 10K commands/día, suficiente para arrancar).
- **Frontend**: **Vercel** o **Cloudflare Pages** (Free tier).
- **Reverse proxy / TLS**: incluido en el proveedor de la API.

Resultado: stack totalmente managed, cero VPS que mantener.

### Setup alternativo (single VPS, ~$10–20/mes)
- **VPS**: Hetzner CX22 / DigitalOcean droplet — 2 vCPU, 4GB RAM.
- **Docker Compose** con servicios: `api`, `web` (nginx sirviendo el build de Vite), `redis`.
- **BD**: sigue siendo **Supabase remoto** (no auto-hostear Postgres a menos que tengas razones específicas — pierdes backups, Auth, dashboard).
- **Caddy** o **Traefik** como reverse proxy con TLS automático.

### Escalado horizontal (cuando haga falta)
- Múltiples instancias de NestJS detrás del load balancer del proveedor.
- **Lock distribuido en Redis** (`SET scan:lock NX EX 110`) garantiza que solo una instancia ejecuta `runScan` cada ciclo.
- Supabase aguanta el crecimiento; subir de Free → Pro → Team según `MAU` y uso de BD.
- Métricas: Grafana Cloud free tier + `prom-client` exponiendo `/metrics`.

### Setup de Supabase paso a paso

1. **Crear proyecto** en [supabase.com](https://supabase.com) → región cercana al servidor de la API (latencia BD ↔ API es lo que más importa, no API ↔ usuario).
2. **Settings → Database**: copiar
   - **Direct connection** (puerto 5432, host `db.<ref>.supabase.co`) → `DATABASE_DIRECT_URL` (para migraciones).
   - **Session pooler** (mismo puerto 5432, host distinto con `pooler` en el nombre) → `DATABASE_URL` (para la app).
   - **NO usar el Transaction pooler** (6543) — rompe TypeORM por falta de prepared statements.
3. **Settings → API**: copiar
   - `Project URL` → `SUPABASE_URL`.
   - `anon public` key → `SUPABASE_ANON_KEY` (frontend la usa).
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (backend la usa para Admin API, ej. borrar `auth.users`). **Nunca exponer al frontend**.
4. **Authentication → Providers**: habilitar Email; opcionalmente Google/GitHub.
5. **Authentication → URL Configuration**: añadir `Site URL` y `Redirect URLs` del frontend.
6. **Database → Replication**: dejar el publication `supabase_realtime` por defecto (no necesitamos Realtime nativo de Supabase porque usamos Socket.IO, pero no estorba).
7. Correr migraciones contra `DATABASE_DIRECT_URL`:
   ```bash
   DATABASE_DIRECT_URL=postgresql://... pnpm typeorm migration:run -d dist/data-source.js
   ```

### Variables de entorno

**Regla**: en `.env` van **secretos** (passwords, claves de cifrado, service-role keys) y **endpoints configurables** (para poder cambiar entre prod / staging / local sin tocar código). **No** van URLs públicas inmutables, **no** van credenciales per-usuario (tokens de Telegram → BD cifrados).

```dotenv
# ─── Infraestructura ─────────────────────────────────────────────
NODE_ENV=production                              # development | production | test
PORT=3000
LOG_LEVEL=info                                   # debug | info | warn | error
CORS_ORIGINS=https://app.midominio.com           # separados por coma

# ─── Supabase ────────────────────────────────────────────────────
# Settings → API en el dashboard de Supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<eyJ...>                       # pública, también la usa el frontend
SUPABASE_SERVICE_ROLE_KEY=<eyJ...>               # ⚠️ SECRETO — solo backend
SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1
SUPABASE_JWT_JWKS_URI=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json

# ─── Base de datos (Supabase Postgres) ───────────────────────────
# Settings → Database → Connection string en el dashboard
# DATABASE_URL = Session pooler (para la app)
# DATABASE_DIRECT_URL = Direct connection (para migraciones)
DATABASE_URL=postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_DIRECT_URL=postgresql://postgres:<pass>@db.<ref>.supabase.co:5432/postgres
# ⚠️ NO usar el transaction pooler (puerto 6543) con TypeORM.

# ─── Redis ───────────────────────────────────────────────────────
REDIS_URL=rediss://default:<pass>@<host>.upstash.io:6379

# ─── Cifrado (para tokens Telegram de usuarios en BD) ────────────
# Generar con: openssl rand -hex 32
TELEGRAM_ENCRYPTION_KEY=<32 bytes hex>           # AES-256-GCM
# ⚠️  Si rotas esta clave, los tokens de TG existentes quedan ilegibles.
#     Plan de rotación: re-cifrar con la nueva clave antes de borrar la vieja.

# ─── APIs externas (base URLs, NO son secretos) ──────────────────
BINANCE_SPOT_BASE_URL=https://api.binance.com
BINANCE_FUTURES_BASE_URL=https://fapi.binance.com
# Para desarrollo/tests usar testnet:
# BINANCE_SPOT_BASE_URL=https://testnet.binance.vision
# BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com
TELEGRAM_API_BASE_URL=https://api.telegram.org   # opcional, pública

# ─── Scanner ─────────────────────────────────────────────────────
SCAN_INTERVAL_CRON=*/2 * * * *                   # cada 2 minutos
SCAN_LOCK_TTL_SECONDS=110                        # lock distribuido en Redis
BINANCE_RATE_LIMIT_WEIGHT_BUDGET=1100            # margen bajo el límite real de 1200/min
BINANCE_BATCH_SIZE=10                            # equivalente a batchedMap del v22
BINANCE_REQUEST_TIMEOUT_MS=8000

# ─── Workers / colas ─────────────────────────────────────────────
BULLMQ_PREFIX=shortscanner
ALERTS_QUEUE_CONCURRENCY=5
```

**NUNCA poner en `.env`**:
- Token de Telegram de un usuario individual → cifrado en `TelegramConfig.token` (BD).
- Chat ID de un usuario → en `TelegramConfig.chatId` (BD, plain text está ok).
- API keys de Binance personales — el sistema **no las necesita**, todos los endpoints usados son públicos.
- **JWT secrets propios** — ya no aplican; Supabase Auth firma sus propios JWTs, nosotros solo validamos contra el JWKS público de Supabase.

**Buenas prácticas**:
- Versionar `.env.example` con placeholders, **nunca** `.env` real (agregar a `.gitignore`).
- En producción, inyectar via secretos del proveedor (Railway/Fly secrets, AWS Secrets Manager, Docker secrets) — no leer de archivo.
- Validar el shape del `.env` al boot con `class-validator` o `Zod` en `ConfigModule` de NestJS. El proceso debe **crashear al inicio** si falta una var crítica, no fallar en runtime.

---

## 10. Estrategia de migración por fases

### Fase 0 — Preparación (1 semana)
- Inicializar monorepo (pnpm + Turborepo).
- Stub de NestJS con health check.
- Stub de React + Vite con login mock.
- CI básico (lint + typecheck).

### Fase 1 — Motor de scanning sin auth (1–2 semanas)
- `BinanceModule`, `IndicatorsModule`, `ScoringModule` con tests unitarios usando fixtures del v22.
- `ScannerService` con cron de 2 min, escribiendo a Postgres.
- Endpoint `GET /scans/current` que devuelve el último scan global.
- Frontend mínimo: tabla en vivo conectada vía WS, sin login.
- **Hito**: paridad funcional con el tab Scanner del v22, pero server-side.

### Fase 2 — Multi-usuario + persistencia (1–2 semanas)
- `AuthModule`, registro/login, JWT.
- `TradesController` + `LearningService`.
- **`TrackingModule`** completo (§4.11) — tabla `TrackedToken`, reconciliación al final de cada scan, transiciones ACTIVE↔DORMANT, conteo `daysActive`/`scansActive`/`reappearances`.
- Endpoints `/tracking/*` y eventos WS `tracking:*`.
- Frontend: nueva tab **Watchlist** con secciones Activos / En vigilancia / Histórico.
- Frontend: páginas de Trades y Settings.
- Migrar UI de Telegram config (cifrado server-side).
- **Hito**: un token que entra al top gainers el lunes y reaparece el jueves aparece como el MISMO `TrackedToken` con `daysActive=4`, no como uno nuevo.

### Fase 3 — Alertas + Telegram (1 semana)
- `AlertsModule` + BullMQ + worker Telegram.
- WS events `alert:new`.
- Histórico de alertas (`/alerts?from=&to=`).
- **Hito**: alerta GO SHORT en <2s desde detección, persistente, multi-canal.

### Fase 4 — Features nuevas (a partir de aquí)
- Backtesting: replay de scans históricos contra distintos pesos.
- Paper trading automático.
- Exportar/importar entre v22 (JSON) y la nueva BD para migrar usuarios existentes.
- Modelos ML opcionales en `ScoringService` (LightGBM exportado a ONNX).

---

## 11. Migración de datos del v22

Los usuarios existentes tienen `trades` y `weights` en `localStorage`. Plan:

1. **Endpoint de import**: `POST /me/import-from-v22` que acepta el JSON exportado por el botón "Exportar" del v22 actual (función `exportData`, línea ~1893).
2. **Botón en el v22**: agregar "Exportar a vNext" que descarga el JSON con formato versionado:
   ```json
   { "schemaVersion": 8, "trades": [...], "weights": {...}, "exportedAt": "..." }
   ```
3. **El backend valida** `schemaVersion` y mapea a tablas `Trade` + `User.weights`.

Esto preserva el aprendizaje acumulado del usuario al saltar de versión.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Binance rate-limit con muchos usuarios | Un solo scan compartido + cache Redis 30s + respeto a `X-MBX-USED-WEIGHT-1M` |
| `runScan` corriendo en dos pods a la vez | Lock distribuido en Redis (`SET scan:lock NX EX 110`) |
| Tokens Telegram filtrados | Cifrado en BD + variable `TELEGRAM_ENCRYPTION_KEY` rotable |
| Drift entre cliente y servidor | Tipos compartidos en `packages/shared-types` consumidos por API y Web |
| Migraciones de schema rompiendo datos | TypeORM `migration:run` versionado en git + backup pre-deploy en CI + `synchronize: false` siempre |
| Olvidar registrar entidad en `TypeOrmModule.forFeature` | Lint rule + tests de boot que validan que todos los repos esperados resuelvan |
| Pérdida de la paridad funcional con v22 | Fixtures de tests tomadas de scans reales del v22; comparación lado a lado en Fase 1 |
| Costo de Postgres con histórico de scans grande | Partitioning por mes en `ScanResult` + retention policy (drop > 90 días). En Supabase Free monitorear el límite de 500MB; subir a Pro ($25/mes, 8GB) si se alcanza |
| Usar Transaction pooler (6543) con TypeORM por error | Queries con parámetros fallan silenciosamente. **Forzar uso del Session pooler (5432)** en `DATABASE_URL` y documentarlo en el `.env.example` |
| Filtración del `SUPABASE_SERVICE_ROLE_KEY` | Esta key bypassa RLS y permite operaciones admin. **Nunca al frontend**, nunca en logs. Solo en secrets del proveedor server-side. Rotar inmediatamente si se sospecha leak (dashboard de Supabase) |
| Tier Free de Supabase pausando el proyecto por inactividad | Free tier pausa proyectos inactivos por 7 días. Para producción real: Pro ($25/mes) o ping de keep-alive desde la API cada N horas |
| Dependencia hard de Supabase Auth | Aislar la lógica de auth en `SupabaseJwtStrategy`. Migrar a JWT propio = reemplazar solo esa clase + añadir `passwordHash` a `User`. Las FK no cambian porque `User.id` ya es UUID |

---

## 13. Qué NO migrar (por ahora)

- **Sonido `beep()`** — vive en el cliente, sin cambio.
- **Modal de info / glosario** — contenido estático; pasarlo a páginas Markdown renderizadas en frontend.
- **Lógica de UI puramente cosmética** (animaciones, hover states) — se rehace en CSS de la SPA, no es lógica de dominio.

---

## 14. Definición de "hecho" para la v1 server-side

- [ ] Usuario puede registrarse, loguearse, recuperar sesión entre dispositivos.
- [ ] Backend hace scan cada 2 minutos sin intervención del cliente.
- [ ] Frontend muestra resultados en vivo vía WS con UX igual o mejor que v22.
- [ ] Usuario puede registrar trades, marcar resultados, ver pesos recalibrarse.
- [ ] Telegram funciona end-to-end con credenciales cifradas server-side.
- [ ] Histórico de scans consultable por rango de fechas.
- [ ] **Tracking persistente funcional**: un token que pumpea durante 3 días sobrevive 2 resets de ticker UTC, mantiene `firstDetectedAt` original, acumula `scansActive` correctamente, y muestra `daysActive=3` en la UI.
- [ ] **Reconciliación post-scan estable**: tokens DORMANT que reaparecen recuperan estado ACTIVE sin duplicar registros.
- [ ] Tests: cobertura >80% en `ScoringService` e `IndicatorsService` (lógica pura).
- [ ] Deployable con `docker compose up` en menos de 5 minutos.
- [ ] Migración v22 → vNext probada con un export real.
