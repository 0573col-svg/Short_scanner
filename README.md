# Short Scanner

Sistema cliente/servidor para detectar candidatos a short en Binance.
Migración del v22 monolítico (un solo HTML) a NestJS + React. Plan completo en
[`MIGRATION-NESTJS.md`](./MIGRATION-NESTJS.md).

> **Estado actual: Fase 1 — scanner funcional.** El motor de scanning (Binance +
> RSI/divergencia + scoring + cron 2min + WebSocket + tabla viva) ya está
> portado. Falta persistencia, trades y Telegram (Fase 2 y 3).

---

## Estructura

```
.
├── apps/
│   ├── api/                # NestJS — health check por ahora
│   └── web/                # React + Vite + Tailwind — login mock + ping al API
├── packages/
│   └── shared-types/       # DTOs compartidos API ↔ Web
├── docker/
│   ├── docker-compose.yml  # Postgres 15 + Redis 7 para dev local
│   ├── api.Dockerfile
│   ├── web.Dockerfile
│   └── nginx.conf
├── .github/workflows/      # CI: lint + typecheck + build + test
├── short-scanner-v22.html  # versión legacy (no tocar)
└── MIGRATION-NESTJS.md     # plan completo de migración
```

## Requisitos

- Node 20+ (`.nvmrc` fija la mayor)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10.30.0 --activate`)
- Docker + Docker Compose (opcional en Fase 0; obligatorio desde Fase 2 cuando entre Postgres/Redis)

## Cómo correr todo

### Primera vez (setup)

```sh
# 1. Instalar dependencias del workspace
pnpm install

# 2. (opcional en Fase 0) Levantar Postgres + Redis locales
docker compose -f docker/docker-compose.yml up -d

# 3. (opcional en Fase 0) Copiar el .env — defaults locales comentados al inicio
cp .env.example apps/api/.env
```

### Uso diario

```sh
# Levantar API (NestJS) + Web (Vite) en paralelo vía Turbo
pnpm dev
```

### Workspace de VSCode

Si trabajas en VSCode, abre el workspace para tener backend / frontend / shared-types
como folders separados con sus propios settings y tareas:

```sh
code short-scanner.code-workspace
```

Trae:
- 5 folders al sidebar (Root, API, Web, shared-types, docker)
- Tasks pre-configuradas (Cmd+Shift+P → "Tasks: Run Task"): "▶ Dev",
  "🐳 Docker compose up", "🔨 Build all", "🧪 Test API", "🧹 Lint all"
- Debug configs para Nest y Jest (F5)
- ESLint, Prettier, Tailwind IntelliSense por folder
- Extensiones recomendadas (te las propone al abrir)

Abrir en el navegador:

- **Interfaz web**: <http://localhost:5173> — login mock + badge de salud del API
- **API health**: <http://localhost:3000/api/healthz> — JSON crudo

`Ctrl+C` apaga ambos. Para parar Docker: `docker compose -f docker/docker-compose.yml down`.

### Qué vas a ver

En `localhost:5173`:

1. Pantalla de login mock — cualquier email + "Entrar"
2. **Header** con estado del scanner (activo/escaneando/error), timestamp del
   último ciclo, BTC trend, conteo de tokens
3. **Toolbar** con thresholds editables (pump %, top N, vol min) y toggle
   `STRICT`/`FLEX`, más botón "Forzar scan"
4. **Tabla viva** con tokens detectados: símbolo, precio, %24h, vol, funding
   rate, RSI, strip de velas 4H, score (0-100, barra de color), verdict
   (`GO SHORT` / `CERCA` / `VIGILAR` / `BTC ↓` / `—`)
5. **Panel de alertas** a la derecha — entradas nuevas cuando un token entra a
   GO_SHORT o CERCA
6. Filas `GO_SHORT` parpadean en rojo cuando son alertas nuevas (4s)

### Binance: requiere acceso sin geo-bloqueo

El scanner es **futures-only** y pega a `fapi.binance.com`. Responde **HTTP 451**
desde IPs en US sin VPN. Si pasa, el API arranca pero el primer scan falla con
un mensaje claro indicándolo.

**Soluciones**:

1. **VPN a nivel sistema** (recomendado) — activa una VPN fuera de US antes
   de levantar el API. Node usa la conexión del sistema.
2. **Testnet de futures** para tests/dev — en `apps/api/.env`:
   ```dotenv
   BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com
   ```
   (no hay equivalente "futures" en binance.us — binance.us es spot-only)

### Otros comandos útiles

```sh
# Solo el API
pnpm --filter @short-scanner/api dev

# Solo el web
pnpm --filter @short-scanner/web dev

# El v22 monolítico (versión legacy, sigue funcional)
open short-scanner-v22.html
```

## Scripts del workspace

| Script | Qué hace |
|---|---|
| `pnpm dev` | Levanta API y Web en paralelo vía Turbo |
| `pnpm build` | Build de todos los paquetes |
| `pnpm lint` | ESLint en todos los paquetes |
| `pnpm typecheck` | `tsc --noEmit` en todos los paquetes |
| `pnpm test` | Jest en todos los paquetes |
| `pnpm format` | Prettier sobre el repo |
| `pnpm clean` | Limpia `dist`, `.turbo`, `node_modules` |

## Tests

```sh
# Unit tests (API)
pnpm --filter @short-scanner/api test

# E2E del API (corre la app en proceso, hace GET /api/healthz)
pnpm --filter @short-scanner/api test:e2e
```

## Variables de entorno

Ver [`.env.example`](./.env.example) para la lista completa.

**Regla**: en `.env` van **secretos** y **endpoints configurables**. Tokens
Telegram per-usuario, credenciales personales, etc. → BD cifrados.

Para Fase 0 (sin Supabase, sin BD real) basta con:

```sh
NODE_ENV=development
PORT=3000
CORS_ORIGINS=http://localhost:5173
```

## Próximas fases

- ✅ **Fase 1 (completa)**: scanner real con Binance + indicators + scoring + cron 2min + WebSocket + tabla viva.
- **Fase 2** (siguiente): Postgres + TypeORM + tabla `trades` + UI de trades + histórico de scans.
- **Fase 3**: Telegram alerts via BullMQ + learning loop (recalibración de pesos).
- **Fase 4+**: tracking persistente cross-día (§4.11), auth multi-user, backtesting, ML.

Ver [`MIGRATION-NESTJS.md §10`](./MIGRATION-NESTJS.md) para el plan completo.

## Legacy

El v22 sigue siendo la versión que se usa hoy. Para ejecutarlo:

```sh
open short-scanner-v22.html
```

No tocar ese archivo durante la migración; los cambios van en `apps/` y
`packages/`.
