# 05 — Lógica del verdict "maduro"

## Problema que resuelve

La Fase 4 dejó las columnas listas en `tracked_tokens` pero no las pobló — los Ever-flags, `activeMs`, `maturedVerdict` y `currentPrice` quedaron como defaults inertes (`false`, `0`, `null`). Esta fase es la que enciende esa máquina: cada `reconcile()` ahora actualiza los campos nuevos, computa el verdict maduro, y archiva tokens cuyo window expiró sin completar las condiciones.

**Lo que esta fase NO hace todavía:** no dispara alerta MADURA por Telegram. Esta fase solo deja `maturedVerdict='GO_SHORT'` persistido en BD cuando corresponde — la siguiente fase detecta la transición y manda el mensaje.

El sentido de separarlo en dos fases: la lógica de cálculo se puede verificar end-to-end (con `MATURED_WINDOW_MS` chico) sin riesgo de spammear el canal Shorter con alertas mientras se prueba. Recién cuando estamos seguros de que `maturedVerdict` se marca en los momentos correctos, conectamos el dispatcher de Telegram.

## Antes vs Después

**Antes** (Fase 4): cada reconcile actualizaba peak marks, scansActive, status. Las columnas matured-* quedaban exactamente como en el insert.

```sql
SELECT symbol, "activeMs", "rsiEverPassed", "maturedVerdict" FROM tracked_tokens LIMIT 3;
 symbol  | activeMs | rsiEverPassed | maturedVerdict
---------+----------+---------------+----------------
 XLMUSDT |        0 | f             |
 INUSDT  |        0 | f             |
 RIFUSDT |        0 | f             |
```

**Después** (Fase 5): los campos se actualizan en cada scan donde el token aparece.

```sql
 symbol  | activeMs | rsiEverPassed | fundingEverPassed | maturedVerdict
---------+----------+---------------+-------------------+----------------
 XLMUSDT |   171044 | t             | f                 |
 FFUSDT  |   171044 | f             | t                 |
 INUSDT  |   171044 | f             | f                 |
```

(Output real de un smoke test con 3 scans consecutivos. `activeMs ~171s` ≈ 2 intervalos de cron de 120s entre scans #1↔#2 y #2↔#3 menos el delta inicial.)

## Conceptos nuevos

### Ever-flag

Las **4 condiciones técnicas** del scoring (`rsi`, `funding`, `divergence`, `redCandles`) tienen, cada una, un par `<key>EverPassed: boolean` + `<key>PassedAt: timestamptz`.

**Regla**: en cada scan donde el token aparece, si `grades[key].passed === true` y el flag estaba en `false`, se prende y se guarda el timestamp. **Una vez prendida, no se desactiva** dentro de la vida del token (mientras esté en `ACTIVE | DORMANT | SHORTED`; ARCHIVED lo deja congelado).

**Por qué Ever-flag y no "passed actual"**: las 4 condiciones rara vez se cumplen simultáneamente en un mismo scan (un pump real tiene fases — primero RSI extremo, después funding sube, después aparece divergencia, después velas rojas). El verdict instantáneo del scoring (`GO_SHORT` clásico) exige confluencia en un solo scan; el verdict maduro acepta confluencia distribuida en el tiempo. Eso es lo que hace al maduro más "construido" — refleja agotamiento progresivo del pump, no spike instantáneo.

**Por qué no se desactiva**: si un Ever-flag pudiera desactivarse, el verdict maduro oscilaría con cada scan y disparar alertas se vuelve impredecible (¿alertar cada vez que se reprende? ¿solo la primera?). Mantenerlo monótono creciente da garantías simples: "una vez cumplida la condición, queda registrada para el resto de la vida del token".

### `activeMs` y el threshold de continuidad

Columna `activeMs bigint` que mide **milisegundos activos acumulados** del token. No es tiempo calendario — pausa cuando el token está DORMANT.

**Regla de incremento** en cada reaparición: se calcula `delta = now - lastSeenPumpingAt` (donde `lastSeenPumpingAt` es el valor VIEJO, antes de actualizarse). Si `delta` cae en `[0, CONTINUITY_THRESHOLD_MS]`, suma. Si `delta > CONTINUITY_THRESHOLD_MS`, no suma — el token estuvo DORMANT y el reloj quedó pausado.

```
CONTINUITY_THRESHOLD_MS = SCAN_INTERVAL_MS * 1.5 = 180_000  (= 3 minutos)
```

El 1.5× tolera un scan faltante ocasional (ej. un scan dura más de 2 min por latencia de Binance y el siguiente cron tick choca con el anterior). Pero descarta cualquier gap real de DORMANT (1 hora, 1 día, lo que sea).

**Por qué hace falta esta columna y no alcanza con `daysActive` o `scansActive`**:
- `daysActive` mide días calendarios desde `firstDetectedAt`. Si un token estuvo DORMANT 3 días y reapareció, `daysActive` sigue contando los 3 días dormidos.
- `scansActive` cuenta scans donde reapareció. Si el cron cambia (de */2 a */5), las cuentas históricas dejan de ser comparables.
- `activeMs` mide tiempo real de presencia continua, robusto a ambas cosas.

### Verdict maduro — las 3 reglas

`maturedVerdict` es `'GO_SHORT'` cuando **las 3** se cumplen, `null` en cualquier otro caso:

1. **4 Ever-flags en true** (`rsi ∧ funding ∧ divergence ∧ redCandles`). Confluencia distribuida en el tiempo.
2. **Precio cerca del pico** (`currentPrice >= peakPrice * 0.80`). Si el activo ya cayó más del 20% desde su pico, el pump se considera revertido — la ventana para shortear con esta lógica ya pasó. El número 0.80 es la constante `PRICE_NEAR_PEAK_RATIO`.
3. **Dentro del window de monitoreo** (`activeMs <= MATURED_WINDOW_MS`). Default 96 horas (4 días) de tiempo activo. Si el token estuvo activo más que eso sin completar las 4 condiciones, deja de ser candidato.

Una vez `maturedVerdict='GO_SHORT'`, **no se desactiva** (igual que los Ever-flags). El token queda marcado hasta que muera por DORMANT TTL natural (24h sin reaparecer). Esto:
- Simplifica el dedup de la alerta MADURA en la Fase 6 (la transición `null → 'GO_SHORT'` ocurre exactamente una vez por token).
- Evita oscilación del estado si el precio fluctúa cerca del 80% del peak.

### Expiración por window

Tokens que **NO maduraron** (`maturedVerdict IS NULL`) y cuyo `activeMs` excedió `MATURED_WINDOW_MS` se archivan automáticamente. Lógica: si pasaron 96h de actividad continua sin completar las 4 condiciones, el pump se agotó sin dar señal — el token deja de ser candidato útil y se saca de tracking.

Tokens que **SÍ maduraron** (`maturedAt !== null`) están **exentos** de esta expiración. Siguen vivos hasta que mueran por DORMANT TTL (24h sin reaparecer en scans).

Esta ruta de archive corre en cada reconcile, después del bloque `previouslyActive → DORMANT` y antes de `DORMANT > 24h → ARCHIVED`. El log nuevo `windowExpired=N` cuenta cuántas archivó.

## Qué cambia

Tres piezas:

1. **Módulo puro `maturity.ts`** con 4 funciones sin efectos secundarios externos (no tocan BD, no leen `Date.now()`, todas reciben `now: Date` explícito como parámetro):
   - `updateEverFlags(row, grades, now)`: muta los 4 pares Ever/timestamp.
   - `incrementActiveMs(row, now, threshold)`: muta `activeMs`.
   - `computeMaturedVerdict(row, currentPrice, windowMs, ratio) → 'GO_SHORT' | null`: puro.
   - `applyMaturedVerdict(row, currentPrice, now, windowMs, ratio)`: usa el anterior y muta `maturedVerdict` + `maturedAt` solo en la transición `null → 'GO_SHORT'`.
   - `shouldExpireByWindow(row, windowMs) → boolean`: puro, el caller decide qué hacer.

2. **Integración en `reconcile()`** en tres puntos:
   - Branch de **create** (token nuevo): `updateEverFlags` se llama por si el primer scan ya trae alguna condición passed. `activeMs=0` inicial. Sin `incrementActiveMs` (no hay `lastSeenPumpingAt` previo real) ni `applyMaturedVerdict` (activeMs=0 y todas las flags arrancan en false; imposible madurar en scan #1).
   - Branch de **update** (token existente): el orden importa.
     - `incrementActiveMs(existing, now, CONTINUITY_THRESHOLD_MS)` **antes** de actualizar `lastSeenPumpingAt` — necesita el delta contra el VALOR VIEJO.
     - `updateEverFlags(existing, r.grades, now)` con los grades del scan actual.
     - Pre-setear `existing.peakPrice = peakPriceNew` para que `applyMaturedVerdict` compare contra el peak correcto.
     - `applyMaturedVerdict(existing, r.snapshot.price, now, windowMs, ratio)`.
     - Después, el `Object.assign` actualiza el resto (timestamps, contadores, currentPrice, etc).
   - **Nueva ruta de archive por window** entre `previouslyActive → DORMANT` y `DORMANT TTL → ARCHIVED`. Query: `find({ status In ['ACTIVE','DORMANT'], activeMs > windowMs, maturedAt: IsNull() })`. Doble check con `shouldExpireByWindow` antes del update a defensiva.

3. **ConfigService inyectado** para leer `MATURED_WINDOW_MS` con default `96 * 3600 * 1000`. Las otras 3 constantes (`SCAN_INTERVAL_MS=120000`, `CONTINUITY_THRESHOLD_MS=180000`, `PRICE_NEAR_PEAK_RATIO=0.8`) quedan hardcoded con comentario — son decisiones de diseño, no parámetros operativos.

El return de `reconcile()` agrega un campo nuevo: `windowExpired: number`. El log se extiende: `tracking reconcile · upserts=X reactivated=Y dormanted=Z archived=W windowExpired=K`.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `apps/api/src/modules/tracking/maturity.ts` *(NUEVO)* | 4 funciones puras + type `MaturityRow`. |
| `apps/api/src/modules/tracking/maturity.spec.ts` *(NUEVO)* | 23 tests unitarios: cada función + 2 tests de flujo end-to-end (token que matura en 4 scans / gap DORMANT pausando reloj). |
| `apps/api/src/modules/tracking/tracking.service.ts` | Inyecta `ConfigService`. Constantes nuevas (window default, threshold continuidad, ratio precio, scan interval). Branch create con defaults + `updateEverFlags`. Branch update con las 4 fns de maturity. Nueva ruta archive por window. Log + return extendidos con `windowExpired`. |
| `apps/api/src/modules/tracking/tracking.service.spec.ts` | 5 tests nuevos de integración: Ever-flag desde primer scan, activeMs incremental + flags faltantes en segundo scan, archive por window, NO archive si maduró. Mock de `ConfigService` agregado a `makeService`. |

**No hay migración nueva.** Las columnas ya existen desde Fase 4.

## Cómo probarlo

### Validación rápida (sin esperar maduración real)

```bash
pnpm --filter @short-scanner/api test
```

Los 28 tests nuevos cubren todos los casos críticos en aislamiento — incluido el flujo completo de un token que matura a lo largo de 4 scans y otro que tiene un gap DORMANT pausando el reloj.

### Smoke contra Binance real (validar que `activeMs` y Ever-flags se pueblan)

```bash
pnpm --filter @short-scanner/api dev
# esperar 3 ciclos de cron (~6 min)
```

```sql
SELECT symbol, "scansActive", "activeMs",
       "rsiEverPassed", "fundingEverPassed", "divergenceEverPassed", "redCandlesEverPassed",
       "maturedVerdict", "currentPrice"
FROM tracked_tokens
WHERE status IN ('ACTIVE','DORMANT')
ORDER BY "activeMs" DESC LIMIT 15;
```

Lo que tiene que aparecer:
- `activeMs` > 0 para tokens que reaparecieron en scans consecutivos.
- Para tokens con scans seguidos sin gap, `activeMs` ≈ `(n_scans - 1) * 120000` ms (no exacto porque el initial scan post-deploy no incrementa — su `lastSeenPumpingAt` previo está fuera del threshold de continuidad).
- Algunos Ever-flags en `true` para tokens cuyo grade correspondiente passed=true en algún scan.
- `currentPrice` poblado con el precio del último scan.
- `maturedVerdict` puede estar NULL en todos — para ver `'GO_SHORT'` necesitás que un token acumule las 4 flags + precio ≥80% peak + activeMs ≤96h. En un smoke corto rara vez se da; ver QA acelerado abajo.

### QA acelerado de la maduración (window comprimido)

Para validar la transición `null → 'GO_SHORT'` end-to-end sin esperar 4 días reales, setear el env var:

```bash
MATURED_WINDOW_MS=300000 pnpm --filter @short-scanner/api dev
```

Con 5 minutos de window, cualquier token que acumule las 4 Ever-flags en ese período va a madurar. Para forzarlo aún más, podés seedearlo via SQL antes de arrancar:

```sql
-- Forzar un token a estar a punto de madurar: 3 flags ya prendidas + activeMs alto
UPDATE tracked_tokens SET
  "rsiEverPassed" = true, "rsiPassedAt" = now() - interval '4 minutes',
  "fundingEverPassed" = true, "fundingPassedAt" = now() - interval '3 minutes',
  "divergenceEverPassed" = true, "divergencePassedAt" = now() - interval '2 minutes',
  "activeMs" = 60000  -- 1 min activo, todavía dentro del window de 5 min
WHERE symbol = '<algun-token-que-esté-pumpeando>';
```

Cuando ese token reaparezca en el próximo scan, si `grades.redCandles.passed=true`, va a madurar (`maturedVerdict='GO_SHORT'`). Mirá `maturedAt` para confirmar el instante.

### Validar la pausa del reloj durante DORMANT

```sql
-- Antes: snapshot
SELECT symbol, "activeMs", "lastSeenPumpingAt" FROM tracked_tokens WHERE symbol = '<X>';

-- Esperar a que X se vaya del top-N (puede tomar varios ciclos hasta que su pump baje
-- bajo el threshold de otros tokens). Cuando status pase a DORMANT y luego reaparezca:
SELECT symbol, "activeMs", "lastSeenPumpingAt", reappearances FROM tracked_tokens WHERE symbol = '<X>';
```

`activeMs` debería haber incrementado SOLO en la última transición (la reaparición), no por el tiempo que estuvo DORMANT.

## Decisiones de diseño

1. **Módulo puro `maturity.ts` separado del service.** El service queda complejo (transacciones, queries de BD, mutaciones de status). Aislar las 4 funciones permite testearlas con `now` inyectado en `maturity.spec.ts` sin mockear `DataSource`. También deja `tracking.service.spec.ts` enfocado en la coordinación, no en la matemática.

2. **`MaturityRow` como type alias subset de la entity.** No se acopla a TypeORM. La entity completa satisface el type por estructural typing — el caller pasa la entity sin cast. Los tests pueden construir objetos plain que satisfagan el type sin instanciar la entity real.

3. **`MATURED_WINDOW_MS` via env, las demás constantes hardcoded.** El window es operativo — podés querer probar con 5 min en dev y 96h en prod. Las otras 3 son decisiones de diseño que no cambian sin reescribir lógica (si bajás `PRICE_NEAR_PEAK_RATIO` a 0.5 cambiás fundamentalmente lo que significa "maduro"). Hardcoding evita ruido de configuración.

4. **`SCAN_INTERVAL_MS = 120000` hardcoded en `tracking.service.ts`, no leído de config.** El cron del scanner usa `*/2 * * * *` (120s) hardcoded en `scanner.service.ts:17`. Para que tracking dependa de ese valor habría que compartirlo via config global. Por ahora la duplicación es pragmática — si alguien cambia el cron, hay un comentario explícito en ambos lugares que pide actualizar el par. Si en el futuro hace falta más flexibilidad, mover ambos a `ConfigService` es un refactor mecánico.

5. **`CONTINUITY_THRESHOLD_MS = SCAN_INTERVAL_MS * 1.5`.** Margen para tolerar un scan ocasional que dura más de 2 min sin perder la cuenta. Si fuera `* 1.0` exacto, cualquier latencia de Binance descontaría tiempo activo legítimo. Si fuera `* 3` o más, una transición ACTIVE→DORMANT→ACTIVE rápida (1 scan perdido) se contaría como continua y rompería la semántica de pausa.

6. **`applyMaturedVerdict` solo dispara la transición `null → 'GO_SHORT'`, nunca al revés.** Esto da garantías al dedup de Fase 6: el dispatcher solo necesita comparar `maturedVerdict (antes)` vs `maturedVerdict (después)` y mandar la alerta exactamente en la transición. No se necesita un "tipo de evento" — la transición es el evento.

7. **Token nuevo: `updateEverFlags` sí, `incrementActiveMs` no, `applyMaturedVerdict` no.** En el branch de create:
   - Si el primer scan ya trae condiciones passed, capturar esos Ever-flags desde el principio. No esperar a la próxima reaparición.
   - `incrementActiveMs` no aplica — no hay `lastSeenPumpingAt` previo real (sería el mismo `now`, delta=0).
   - `applyMaturedVerdict` no aplica — `activeMs=0` y máximo 1 flag prendida; matemáticamente imposible madurar en scan #1.

8. **Pre-setear `existing.peakPrice = peakPriceNew` antes de `applyMaturedVerdict`.** El verdict maduro compara `currentPrice` contra `peakPrice * 0.80`. Si el scan actual sube el peak (precio nuevo más alto que el anterior), querés comparar contra el peak NUEVO, no el viejo. Mutar antes evita tener que pasar `peakPriceNew` como parámetro extra.

9. **Doble check con `shouldExpireByWindow` después de la query SQL.** La query filtra por `activeMs > windowMs AND maturedAt IS NULL`, pero la regla canónica vive en la función pura testeable. Si en el futuro cambia (ej. agregar "y status no es SHORTED"), un solo lugar refleja la regla. La query es solo un pre-filtro para no traer toda la tabla.

10. **`windowExpired` en el log y en el return, separado de `archived`.** `archived` viene del flujo viejo DORMANT TTL — son tokens que se quedaron callados 24h. `windowExpired` es un evento nuevo: tokens que se quedaron pumpeando 4 días sin construir señal. Mezclarlos en un solo contador pierde información operativa.

## Impacto en deploy

**No requiere migración nueva.** Esta fase consume las columnas creadas por Fase 4 — depende **estrictamente** de que la migración `AddMaturedTracking1779931497700` esté aplicada en la BD donde se va a deployar.

**Variable de entorno opcional:** `MATURED_WINDOW_MS` (default 345600000 = 96h). Solo setear si querés window comprimido para QA — en producción debe quedar en default.

**No requiere dependencias nuevas.**

### Orden de deploy

1. Asegurarse que Fase 4 esté mergeada y la migración aplicada (`pnpm --filter @short-scanner/api migration:show` debe mostrar `[X] AddMaturedTracking`).
2. `git pull`.
3. `pnpm install` (defensivo; no hay deps nuevas).
4. `pnpm --filter @short-scanner/shared-types build`.
5. Restart del servicio.

### Riesgo si se deploya sin Fase 4 aplicada

`reconcile()` referencia columnas inexistentes → TypeORM falla al hacer `find/save` con `column "rsiEverPassed" does not exist`. La app no procesa scans. Mitigación: correr la migración manualmente y reiniciar. **No** hay forma de que esta fase corra a medias sin BD lista — la entity exige todas las columnas.

## Troubleshooting post-deploy

**Síntoma: `activeMs` se queda en 0 para todos los tokens, incluso después de varios scans.**

Causas posibles:
1. El delta `(now - lastSeenPumpingAt)` es siempre > `CONTINUITY_THRESHOLD_MS`. Probablemente porque el token quedó DORMANT entre scans (no apareció en el top-N intermedio). Verificar con `SELECT symbol, scansActive, reappearances FROM tracked_tokens WHERE symbol='<X>'` — si `reappearances` es alto, el token entra y sale del top-N rápido.
2. El cron no está corriendo (proceso colgado). Verificar log: debería ver `scan done in Nms` cada ~2 min. Si no, mirar errores arriba en el log o reiniciar.
3. El transformer del bigint no se aplicó al leer (devuelve string en lugar de number, las comparaciones aritméticas en JS fallan silenciosas). Test: `SELECT pg_typeof("activeMs") FROM tracked_tokens LIMIT 1` debería decir `bigint`. La conversión a number la hace el transformer al traer la fila a JS.

**Síntoma: un Ever-flag se prende y desprende entre scans.**

Bug. Por diseño no debería desactivarse nunca. Si pasa, revisar `updateEverFlags`: el guard `if (!row[everKey])` debe estar y no sobrescribir el campo cuando ya estaba en true. También revisar que el `Object.assign` posterior no esté incluyendo `<key>EverPassed: false` por error — las mutaciones de `updateEverFlags` viven en `existing`, el Object.assign no debe sobrescribirlas.

**Síntoma: token con las 4 flags prendidas no llega a `maturedVerdict='GO_SHORT'`.**

Verificar las otras 2 reglas:
- ¿`currentPrice >= peakPrice * 0.80`? Si el activo cayó más del 20% desde el pico, no madura. Lookup: `SELECT symbol, "peakPrice", "currentPrice", "currentPrice" / "peakPrice" AS ratio FROM tracked_tokens WHERE symbol='<X>'`.
- ¿`activeMs <= MATURED_WINDOW_MS`? Si superó el window, ya no es candidato. Si `MATURED_WINDOW_MS` está en su default (96h), `activeMs` debería ser <345600000.

**Síntoma: tokens archivados de más por `windowExpired`.**

Verificar que la query incluye `maturedAt: IsNull()` — sin eso, archivaría también tokens que ya maduraron. El doble check con `shouldExpireByWindow` actúa de defensa.

**Síntoma: `pnpm dev` muestra `[ConfigService] Configuration property "MATURED_WINDOW_MS" not found`.**

No es un error — `cfg.get(key, default)` retorna el default sin tirar excepción si el env var no está. El log podría aparecer si Nest config está en modo strict; revisar `apps/api/src/config/env.validation.ts` si afecta. Por ahora, setear `MATURED_WINDOW_MS=345600000` explícitamente en `.env` elimina cualquier warning.

## Siguientes fases

- **Fase 6 — Dispatch alerta MADURA por Telegram.** Detecta la transición `null → 'GO_SHORT'` en `maturedVerdict` y manda mensaje con header distintivo (sugerencia: `🎯 MADURO`). Dedup persistente via `maturedAlertedAt` (columna que ya existe pero no se toca en esta fase). Coexiste con la alerta instant existente durante 2 semanas para comparar.
- **Fase 7 (opcional) — UI.** Badge `MADURO` en la tabla del scanner, panel de detalle con progreso de las 4 Ever-flags y `activeMs`.
