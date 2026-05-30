# 06 — Dispatch de alerta MADURA por Telegram

## Problema que resuelve

La Fase 5 dejó la lógica del verdict maduro corriendo: cada `reconcile()` ahora marca `maturedVerdict='GO_SHORT'` cuando un token cumple las 3 reglas (4 Ever-flags + precio ≥80% del pico + activeMs ≤ window). Pero ese estado vivía solo en BD — el operador no se enteraba. Tenía que mirar manualmente `tracked_tokens` para ver si alguno había madurado.

Esta fase conecta esa transición con Telegram: cuando un token pasa de `maturedVerdict=null` a `'GO_SHORT'`, se dispara un mensaje al canal con un header distintivo `🎯 MADURO` y un timeline de cuándo se cumplió cada condición. La alerta MADURA convive en paralelo con las alertas instant (`🔴 GO SHORT` / `🔵 CERCA`) durante **al menos 2 semanas** para que Kervin pueda comparar empíricamente cuál de las dos lógicas da mejores señales.

Restricción crítica del diseño: el dispatch a Redis no puede bloquear ni revertir las queries de BD del reconcile. Si Redis cae justo en el momento del dispatch, prefiere perder UNA alerta puntual antes que rollback completo de todo el ciclo (que afectaría el tracking de los otros 29 tokens). El dedup persistente (`maturedAlertedAt` en BD) garantiza que esa alerta perdida no se duplique en el siguiente scan.

## Antes vs Después

**Antes** (Fase 5): el reconcile detecta maduración pero el operador queda ciego.

```
[TrackingService] tracking reconcile · upserts=29 ... windowExpired=0
```

`SELECT symbol, maturedVerdict FROM tracked_tokens WHERE maturedVerdict='GO_SHORT'` mostraría el token maduro, pero solo si Kervin se acordaba de chequear.

**Después** (Fase 6): la transición se detecta, persiste, y dispara mensaje Telegram.

```
[TrackingService] tracking reconcile · upserts=29 ... maturedDispatched=1
```

Y al canal Shorter llega:

```
🎯 MADURO — ALLO
⚙️ Modo: Strict

💰 Precio: $0.264030 (83% del pico $0.319480)
⏱️ En monitoreo: 3min activas

Condiciones cumplidas:
  ✅ RSI 4h (hace 20h)
  ✅ Funding (hace 3min)
  ✅ Divergencia (hace 2min)
  ✅ Velas rojas (hace 32h)

📊 Volumen: 8.5M
📊 BTC: -0.32%

⏰ Cierre vela 4H en: 1h 25min

📋 Otros del día:
  • ALLO [CERCA] +51.2% (hace 4h, score 62)
```

(Captura real del smoke test del 2026-05-29 con `MATURED_WINDOW_MS=300000`. La sección "Otros del día" se reusa del template instant — Fase 3.)

## Qué cambia

Cuatro piezas:

1. **Migración + columna `kind` en `alerts`**. La tabla histórica gana `kind text NOT NULL DEFAULT 'INSTANT'`. Distingue alertas instantáneas de maduras para queries históricas, win-rate, etc. Default 'INSTANT' garantiza retro-compat con filas pre-Fase 6.

2. **Tipo nuevo `MaturedAlert` en shared-types**. Estructuralmente distinto de `ScanAlert`:
   - Sin `passed` booleans (todas las condiciones pasan por definición de maduro).
   - Sin `verdict` ni `score` (`verdict` se sintetiza en `dispatchMatured` como 'GO_SHORT' para schema; `score` no aplica conceptualmente).
   - Con `peakPrice` (para el ratio en el header).
   - Con `everPassedAt: { rsi, funding, divergence, redCandles }` — timestamps en epoch ms de cuándo se prendió cada Ever-flag. Driver del timeline en el mensaje.
   - Con `firstDetectedAt` y `activeMs` para mostrar tiempo de monitoreo.

3. **`AlertDispatcher.dispatchMatured()`**. Paralelo al `dispatch()` existente. UUID client-side, insert fire-and-forget en `alerts` (con `kind='MATURED'`, sintetizando `passed` desde `everPassedAt` para mantener el shape), enqueue BullMQ con payload discriminado por `kind`. `jobId` determinístico distinto al instant: `tg_${userId}_${symbol}_MATURED` — una alerta MADURA es única por token de por vida, jobId fijo basta para dedup defensivo en cola.

4. **Detección de transición en `TrackingService.reconcile`**. La parte crítica:
   - Captura `wasNotMatured = existing.maturedVerdict === null` ANTES de `applyMaturedVerdict`.
   - Después del applyMaturedVerdict, si el verdict cambió a `'GO_SHORT'` y `maturedAlertedAt` está vacío → es la transición.
   - **Dentro de la transacción**: setea `existing.maturedAlertedAt = now`. Esto garantiza el dedup persistente — si el dispatch real falla, la fila ya está marcada y no se vuelve a intentar.
   - Acumula la `MaturedAlert` en una lista local `pendingMaturedDispatches`.
   - **Después de cerrar la transacción**: itera la lista llamando `dispatcher.dispatchMatured`. Si tira, log + continúa (no se interrumpe el resto del scan).

El processor (`alerts.processor.ts`) discrimina por `job.data.kind`: si MATURED, llama `formatMaturedAlert` y no aplica el filtro de `nearAlertsEnabled` (una alerta MADURA siempre se manda — es siempre conceptualmente GO_SHORT).

## Convivencia con alertas instant durante 2 semanas

Las dos lógicas corren **en paralelo** sin coordinación cruzada:

- Un token puede generar 1 alerta instant (`🔴 GO SHORT` por verdict del scoring) y, días después, 1 alerta MADURA (`🎯 MADURO`) por completar las 4 Ever-flags.
- Ambas llegan al mismo canal Shorter, sin cooldown entre sí.
- Si un token cumple ambas en el mismo scan (improbable pero posible), llegan los 2 mensajes uno tras otro — el header distinto los hace inmediatamente diferenciables.

**Objetivo de los 2 semanas**: data empírica para decidir cuál lógica predice mejor entradas exitosas. Kervin registra trades manualmente; si los trades disparados por alertas MADURAS tienen mejor win rate que los instant, eso justifica eventualmente apagar el path instant (o dejar solo CERCA como heads-up). Si es al revés, esta fase queda como código vivo pero subordinado.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `apps/api/src/migrations/<ts>-AddAlertKind.ts` *(NUEVO)* | `ALTER TABLE alerts ADD COLUMN "kind" text NOT NULL DEFAULT 'INSTANT'`. |
| `apps/api/src/modules/alerts/alert.entity.ts` | `@Column kind` con default INSTANT. |
| `packages/shared-types/src/scoring.ts` | Nuevo type `MaturedAlert` (separado de `ScanAlert`). |
| `apps/api/src/modules/alerts/alerts.queue.ts` | `TelegramJobData` ahora es un discriminated union `InstantTelegramJobData \| MaturedTelegramJobData`. |
| `apps/api/src/modules/alerts/alert-dispatcher.service.ts` | Método nuevo `dispatchMatured()`. El `dispatch()` existente ahora explicitea `kind: 'INSTANT'` en su insert. |
| `apps/api/src/modules/alerts/alerts.processor.ts` | Discrimina por `job.data.kind === 'MATURED'` → `formatMaturedAlert`. Maduras saltean el filtro near-alerts. |
| `apps/api/src/modules/telegram/telegram.service.ts` | Nuevo `formatMaturedAlert(alert, othersToday)`. Helper `fmtActiveTime` ("Xmin activas" / "Xh activas"). |
| `apps/api/src/modules/telegram/telegram.service.spec.ts` *(NUEVO)* | 3 tests: render variante A + peak price, fmtActiveTime con activeMs<1h, sección "Otros del día". |
| `apps/api/src/modules/tracking/tracking.service.ts` | Inyecta `AlertDispatcher`. Detección de transición + acumulación en `pendingMaturedDispatches`. Dispatch FUERA de la tx después del commit. Helper `buildMaturedAlert`. Signature de `reconcile` ahora recibe `mode: Mode` y `btcChange: number`. |
| `apps/api/src/modules/tracking/tracking.service.spec.ts` | 2 tests nuevos: transición null→GO_SHORT dispara dispatchMatured + persiste maturedAlertedAt; token ya maduro no re-dispatcha. Mock de `AlertDispatcher` agregado a `makeService`. |
| `apps/api/src/modules/tracking/tracking.module.ts` | Importa `AlertsModule` para inyección del dispatcher. |
| `apps/api/src/modules/scanner/scanner.service.ts` | Pasa `user.mode` y `btc.change` a `reconcile`. |

## Cómo probarlo

### Validación rápida en aislamiento

```bash
pnpm --filter @short-scanner/api test
```

**72/72 tests pasando**. Los 5 nuevos (3 del formatter + 2 de transición) cubren el camino crítico.

### QA acelerado end-to-end (smoke real con window comprimido)

Para validar la cadena completa BD → transición → BullMQ → Telegram sin esperar 4 días reales:

```bash
MATURED_WINDOW_MS=300000 pnpm dev   # window de 5 minutos
```

Después seedear un token activo con las 4 Ever-flags prendidas y `activeMs` bajo:

```sql
UPDATE tracked_tokens SET
  "rsiEverPassed" = true,
  "rsiPassedAt" = COALESCE("rsiPassedAt", now() - interval '4 minutes'),
  "fundingEverPassed" = true,
  "fundingPassedAt" = COALESCE("fundingPassedAt", now() - interval '3 minutes'),
  "divergenceEverPassed" = true,
  "divergencePassedAt" = COALESCE("divergencePassedAt", now() - interval '2 minutes'),
  "redCandlesEverPassed" = true,
  "redCandlesPassedAt" = COALESCE("redCandlesPassedAt", now() - interval '1 minute'),
  "activeMs" = 60000,
  "maturedVerdict" = NULL,
  "maturedAt" = NULL,
  "maturedAlertedAt" = NULL
WHERE symbol = '<un-token-ACTIVE>' AND status = 'ACTIVE';
```

`COALESCE` preserva timestamps preexistentes — el seed solo prende lo que falta. En el próximo scan (≤2 min después), si `currentPrice >= peakPrice * 0.80`, el reconcile detecta la transición → mensaje MADURO al canal.

### Verificar los 3 efectos post-maduración

```bash
# 1. Log del scanner — debe aparecer maturedDispatched=1 en un solo scan
grep "maturedDispatched=1" <log-pnpm-dev>

# 2. Tabla alerts — row con kind=MATURED
docker exec shortscanner-postgres psql -U postgres -d shortscanner \
  -c "SELECT base, verdict, kind, ts FROM alerts WHERE kind='MATURED' ORDER BY ts DESC LIMIT 5;"

# 3. tracked_tokens — maturedAt y maturedAlertedAt seteados con mismo timestamp
docker exec shortscanner-postgres psql -U postgres -d shortscanner \
  -c "SELECT symbol, \"maturedVerdict\", \"maturedAt\", \"maturedAlertedAt\" FROM tracked_tokens WHERE symbol='<ese-token>';"
```

### Verificar idempotencia

Después de la primera maduración, el token reaparecerá en cada scan. **`maturedDispatched` debe quedar en 0 en los scans siguientes** — la transición ya pasó. Si vuelve a marcar 1, hay un bug en el guard `maturedAlertedAt === null`.

## Decisiones de diseño

1. **Dispatch FUERA de la transacción, dedup DENTRO.** El reconcile abre una `dataSource.transaction(...)` para upserts/updates atómicos. Si dispatchMatured estuviera dentro, un Redis caído reverteria toda la reconcile (los 29 tokens del scan no se actualizarían). Sacarlo afuera + persistir `maturedAlertedAt` dentro garantiza: (a) idempotencia incluso si Redis falla, (b) aislamiento de fallas — el resto del scan persiste.

2. **`MaturedAlert` como tipo separado, no extensión opcional de `ScanAlert`.** Mantener un type para "instant" y otro para "matured" hace explícito que son cosas conceptualmente distintas, no variantes del mismo evento. El formatter ramificado por `kind` evita condicionales internos del estilo `if (alert.maturedAt) { ... } else { ... }`. Cuesta unos campos duplicados pero el costo es bajo y la legibilidad sube.

3. **`passed` se sintetiza desde `everPassedAt` en el insert a `alerts`.** El schema actual de `alerts` exige `passed: jsonb`. En lugar de migrarlo a nullable o agregar columnas separadas, una alerta MADURA escribe `passed = { funding: hasTimestamp, rsi: hasTimestamp, ... }`. Es semánticamente correcto (si tiene timestamp → la flag se prendió → "passed" en algún momento) y deja queries históricas como `SELECT COUNT(*) FROM alerts WHERE passed->>'funding'='true'` funcionando sin ramificación por `kind`.

4. **`verdict='GO_SHORT'` y `score=100` por convención en el insert de alertas MADURAS.** El schema exige ambos NOT NULL. Para `verdict` la elección es natural — el mensaje conceptualmente equivale a "GO SHORT con confianza alta". Para `score`, 100 deja claro en queries que la fila MADURA no se comparó contra un cutoff de score y simplifica filtros `WHERE kind='MATURED'`.

5. **`jobId = tg_<userId>_<symbol>_MATURED`** (sin sufijo de bloque 4h, distinto al instant). Una alerta MADURA es única por token de por vida — el `maturedAlertedAt` en BD lo garantiza. El jobId fijo es dedup defensivo en cola (si por algún motivo se intentara encolar dos veces, BullMQ rechaza la segunda).

6. **Maduras saltean el filtro `nearAlertsEnabled`.** En el processor, antes de invocar `formatAlert` se chequea `cfg.nearAlertsEnabled` y se descartan CERCA si está off. Para MADURAS no aplica porque son siempre GO_SHORT — no hay gradación. Saltear la verificación es más simple que evaluar y siempre dar true.

7. **`reconcile` ahora recibe `mode` y `btcChange` como parámetros.** Antes la firma era `(userId, scanResults)`. Para construir el `MaturedAlert` se necesitan ambos. La alternativa era inyectar `UsersService` para leer mode adentro — costo de una query extra por reconcile, peor. Pasar como parámetros del caller es más limpio. `mode` tiene default `'STRICT'` para que tests viejos compilen sin cambios masivos.

8. **`fmtActiveTime` cambia unidad bajo 1h.** En producción con window=96h, los tokens maduros tendrán `activeMs` en horas. En QA con window=5min, en minutos. Mostrar "0h activas" en QA se ve roto; el switch a "Xmin activas" cuando `activeMs < 3600000` lo hace legible en ambos casos.

9. **Variant A + peak price del template (aprobado por el user 2026-05-29).** Cuerpo del mensaje mantiene paralelismo visual con el instant (header, mode, precio, indicadores, volumen, BTC, cierre 4H) para no obligar al operador a cambiar de modo de lectura. El bloque "Condiciones cumplidas" con timeline es lo que comunica "esto es maduro, no instant". El peak price en paréntesis se agregó al pedido del user para tener referencia explícita del valor del pico, no solo el ratio.

10. **`MATURED_WINDOW_MS` solo es env var, las demás constantes hardcoded.** Heredado de Fase 5. Para QA acelerado se setea via shell prefix (`MATURED_WINDOW_MS=300000 pnpm dev`), sin tocar `.env`. Cuando el proceso muere, la env var muere — vuelve a default 96h automáticamente. Ideal para sesiones puntuales de QA sin riesgo de dejarlo activo por error.

## Impacto en deploy

**Requiere migración.** `AddAlertKind` agrega la columna `kind` a `alerts` con default 'INSTANT'. Filas históricas mantienen su valor por default. No hay backfill.

**Variable de entorno opcional:** `MATURED_WINDOW_MS` (default 345600000 = 96h). En producción debe quedar en default. Solo setear para QA puntual.

**No requiere dependencias nuevas.**

### Orden de deploy

1. Asegurar que Fases 4 y 5 estén mergeadas y aplicadas (`migration:show` debe mostrar `[X] AddMaturedTracking`).
2. `git pull`.
3. `pnpm install` (defensivo).
4. `pnpm --filter @short-scanner/shared-types build`.
5. `pnpm --filter @short-scanner/api migration:run` para aplicar `AddAlertKind`.
6. Restart del servicio.

### Riesgo si se invierte el orden

Si el servicio arranca antes de aplicar la migración: el dispatcher tira al hacer insert con `kind='MATURED'` porque la columna no existe. La inserción cae en el `.catch` fire-and-forget, se loguea, y el dispatch a BullMQ sigue → el mensaje a Telegram igual sale, pero la fila histórica se pierde. Mitigación: aplicar migración y reiniciar.

## Troubleshooting post-deploy

**Síntoma: el log muestra `maturedDispatched=1` pero el mensaje no llega a Telegram.**

Verificar en orden:
1. Bot token / chat ID correctos en `telegram_configs` del user.
2. Connectividad a `api.telegram.org` desde la PC/servidor.
3. Logs del processor: si dice `telegram send failed (status=4xx)`, el problema está en la API de Telegram (probablemente token revocado o bot bloqueado en el chat).
4. BullMQ job: `bull:alerts:tg_<userId>_<symbol>_MATURED` debería estar en `completed`. Si está en `failed`, el `attempts: 3` ya lo descartó.

**Síntoma: el mismo token genera alertas MADURAS repetidas en cada scan.**

Bug crítico. El guard de transición no está funcionando. Verificar:
1. `maturedAlertedAt` se está persistiendo correctamente en el `save(existing)` (mutación in-place debe ser respetada).
2. El check `existing.maturedAlertedAt === null` ANTES del push a `pendingMaturedDispatches` está presente.
3. La transacción se está commiteando — si la transacción falla, `maturedAlertedAt` no persiste y el siguiente scan re-detecta la transición.

**Síntoma: el ratio % en el header del mensaje muestra `NaN%` o `0%`.**

`peakPrice` está en 0 o NULL. Sin sentido para un token que cumplió las 3 reglas (debería tener peakPrice histórico). Defensa en el formatter: `peakPrice > 0 ? round(...) : 0`. Si aparece 0%, revisar el row del token: probablemente fue creado con `peakPrice` mal poblado o hay un bug en el path de update.

**Síntoma: el timeline muestra timestamps en el futuro o "recién" para Ever-flags viejas.**

`<key>PassedAt` está null. Caso edge: si el flag está en `true` pero el timestamp es null, `fmtAgo(0)` devuelve "hace 56+ años" (epoch 0). Defensa: validar antes de formatear, mostrar `—` si timestamp es 0. Este caso solo aparece si hay data corrupta o backfilling manual.

**Síntoma: maduras siguen llegando con `MATURED_WINDOW_MS=300000` aunque se reinició el servicio.**

El env var se setea como prefix del comando — solo vive para ESE proceso. Si quedó persistente, alguien lo agregó al `.env` o al systemd unit. Verificar: `grep MATURED_WINDOW_MS apps/api/.env .env` debería no devolver nada en producción.

## Cierre del plan de mejoras

Esta fase **completa** el plan de Fases 4 + 5 + 6 sobre el verdict maduro: schema base → lógica → dispatch. Cada una se puede mergear y deployar de forma independiente con el orden 4 → 5 → 6 (5 depende del schema de 4; 6 depende de la columna `kind` de su propia migración + la lógica de 5 para tener algo que detectar).

**Futuro opcional (Fase 7)**: UI en `apps/web` con badge `MADURO` en la tabla del scanner y panel de detalle con progreso de las 4 Ever-flags y `activeMs`. No es prerequisito para nada — el path de alertas funciona end-to-end sin UI.
