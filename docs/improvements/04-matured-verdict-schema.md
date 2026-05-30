# 04 — Schema base para verdict "maduro"

## Problema que resuelve

Hoy el scanner emite alertas `GO_SHORT` basadas en una **foto instantánea**: si en un solo scan se cumplen ciertas condiciones booleanas (`pump ∧ redCandles ∧ (funding ∨ rsi) ∧ btcOk` en STRICT), dispara. No tiene memoria de cómo evolucionó el activo en los días previos, así que dos tokens muy distintos pueden disparar idéntica alerta:

- Token A: hizo +80% en una sola vela, llegó a RSI=82, y disparó por primera vez todas las condiciones en el mismo scan.
- Token B: lleva 3 días pumpeando, en cada uno de esos días cumplió alguna condición distinta (un día RSI extremo, otro día divergencia bajista, otro día varias velas rojas), y hoy precio sigue ≥80% del pico.

Operativamente B es una señal **más madura**: el agotamiento del pump se construyó a lo largo del tiempo, no fue un spike instantáneo. Pero hoy ambas alertas se ven idénticas.

Esta fase pone la **base de datos** para distinguir esos dos casos. No cambia comportamiento de alertas todavía — solo agrega las columnas que las fases siguientes (lógica de Ever-flags y dispatch MADURO) van a poblar y consumir.

Además aplica un **filtro de entrada** al tracking: tokens con pump <50% no entran a `tracked_tokens`. Hoy se persiste todo el top-N por usuario, sin filtro propio; con el verdict maduro en marcha esos tokens chicos no son candidatos válidos a una señal de "agotamiento del pump", así que ocupan tabla sin aportar.

## Antes vs Después

**Antes** — tabla `tracked_tokens` (solo schema relevante):

```
id, userId, symbol, base, status
firstDetectedAt, lastSeenPumpingAt, archivedAt
firstDetectionSnapshot (jsonb)
peakScore, peakRsi, peakChange24h, peakPrice, peakAt
daysActive, scansActive, reappearances
currentScore, currentVerdict, currentGrades
tradeId
```

`reconcile()` persiste **todo** token del top-N del scan que no esté ya en ARCHIVED/CLOSED.

**Después** — `tracked_tokens` con **13 columnas nuevas**, agrupadas en tres bloques:

```
-- Flags "ever passed" (una vez true, no se desactivan dentro del período):
rsiEverPassed         bool      default false
rsiPassedAt           timestamptz null
fundingEverPassed     bool      default false
fundingPassedAt       timestamptz null
divergenceEverPassed  bool      default false
divergencePassedAt    timestamptz null
redCandlesEverPassed  bool      default false
redCandlesPassedAt    timestamptz null

-- Veredicto maduro (separado del instantáneo):
maturedVerdict        text       null      -- 'GO_SHORT' | null
maturedAt             timestamptz null
maturedAlertedAt      timestamptz null     -- dedup persistente

-- Estado instantáneo + reloj activo:
currentPrice          double precision null
activeMs              bigint     default 0
```

Más un índice nuevo para que la query de expiración por window de la Fase 5 sea barata:

```
CREATE INDEX IDX_tracked_tokens_active_ms ON tracked_tokens (status, activeMs);
```

Y el filtro de entrada en `reconcile()`: si el token no existe y `change24h < 50` → `continue`.

## Qué cambia

Tres piezas chicas:

1. **Migración aditiva sobre `tracked_tokens`.** Solo ADD COLUMN + CREATE INDEX. Filas existentes se quedan con defaults (booleans false, timestamps null, `activeMs=0`). No hay backfill — por diseño, los tokens viejos quedan inertes bajo la lógica nueva hasta que reaparezcan y la Fase 5 los actualice.

2. **Entity extendida.** `TrackedTokenEntity` gana las 13 propiedades. La columna `activeMs bigint` necesita un `transformer` porque `pg` la trae como string desde Postgres — el transformer la parsea a `number` al leer y la deja pasar como número al escribir. Sin esto, las comparaciones aritméticas (`activeMs >= 96 * 3600 * 1000`) que llegan en Fase 5 fallarían silenciosamente al comparar string vs number.

3. **Filtro de entrada en `reconcile()`.** Tres líneas, con guard explícito: si `!existing && r.snapshot.change < 50` → `continue`. **Existentes no se filtran**: si un token entró ayer al tracking con peakChange=85% y hoy bajó a 30% pero sigue en el scan, se actualiza normal. Mueren solo via el ciclo natural DORMANT→ARCHIVED a las 24h sin reaparecer. No los desalojamos retroactivamente.

`TrackedTokenView` también se extiende con los 13 campos nuevos para que el frontend pueda renderizar el progreso de Ever-flags y `activeMs` cuando Fase 5/6 lo necesiten. Estos campos se devuelven igual desde ya — solo que con defaults inertes hasta que la lógica los pueble.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `apps/api/src/migrations/<ts>-AddMaturedTracking.ts` *(NUEVO)* | 13 `ALTER TABLE ADD COLUMN` + `CREATE INDEX`. `down()` simétrico. |
| `apps/api/src/modules/tracking/tracked-token.entity.ts` | 13 propiedades nuevas + `bigintTransformer` para la columna `activeMs`. |
| `packages/shared-types/src/tracking.ts` | `TrackedTokenView` extendido con los 13 campos. Timestamps como `string \| null` (ISO 8601). |
| `apps/api/src/modules/tracking/tracking.service.ts` | Constante `TRACKING_ENTRY_MIN_CHANGE_PCT = 50`. Guard de entrada (`if !existing && change < 50 → continue`). `toView()` mapea los nuevos campos. |
| `apps/api/src/modules/tracking/tracking.service.spec.ts` *(NUEVO)* | 5 tests del filtro: <50% nuevo descartado, =50% nuevo creado, >50% nuevo creado, existente <50% actualizado, mezcla 3 tokens. |

## Cómo probarlo

### Aplicar el código + correr la migración

```bash
git pull
pnpm install
pnpm --filter @short-scanner/shared-types build   # imprescindible: TS chequea contra el dist
pnpm --filter @short-scanner/api migration:run    # crea las 13 columnas + el índice
pnpm dev
```

`migration:run` corre `pnpm build && typeorm -d dist/data-source.js migration:run`, así que rebuildeará la API y aplicará todas las migraciones pendientes. Si ya estaba `InitSchema` aplicada, solo corre `AddMaturedTracking`.

### Verificar el schema post-migración

```sql
\d tracked_tokens
```

Deberías ver al final de la lista de columnas:

```
 rsiEverPassed        | boolean                  | not null default false
 rsiPassedAt          | timestamp with time zone |
 fundingEverPassed    | boolean                  | not null default false
 fundingPassedAt      | timestamp with time zone |
 divergenceEverPassed | boolean                  | not null default false
 divergencePassedAt   | timestamp with time zone |
 redCandlesEverPassed | boolean                  | not null default false
 redCandlesPassedAt   | timestamp with time zone |
 maturedVerdict       | text                     |
 maturedAt            | timestamp with time zone |
 maturedAlertedAt     | timestamp with time zone |
 currentPrice         | double precision         |
 activeMs             | bigint                   | not null default '0'::bigint
```

Y en la sección de índices:

```
"IDX_tracked_tokens_active_ms" btree (status, "activeMs")
```

### Validar el filtro de entrada sin esperar un scan orgánico

Los tests unitarios cubren los 4 casos (`pnpm --filter @short-scanner/api test`). Para inspección manual contra BD real:

```sql
-- Antes del scan: snapshot de cuántos tokens hay con peakChange < 50
SELECT COUNT(*) FROM tracked_tokens WHERE "peakChange24h" < 50 AND status = 'ACTIVE';
```

Esperás que **post-deploy** ese número quede estable o decrezca (porque nuevos no entran), nunca crezca. Las filas viejas con `peakChange < 50` siguen ahí hasta que mueran por DORMANT TTL — eso es por diseño.

### Validar que filas viejas siguen actualizándose

```sql
-- Mirá los lastSeenPumpingAt de filas existentes con peakChange < 50.
-- Si después de un scan donde el símbolo apareció, lastSeenPumpingAt cambió a 'now',
-- el path de update está intacto.
SELECT symbol, "peakChange24h", "lastSeenPumpingAt", "scansActive"
FROM tracked_tokens
WHERE userId = '<tu-user-id>' AND "peakChange24h" < 50 AND status IN ('ACTIVE','DORMANT')
ORDER BY "lastSeenPumpingAt" DESC
LIMIT 10;
```

## Decisiones de diseño

1. **`text` para `maturedVerdict`, no enum.** Por ahora solo `'GO_SHORT'` o `NULL`. Si en el futuro agregamos un estado intermedio tipo `'NEAR_MATURED'` (3 de 4 condiciones cumplidas), no hace falta migrar el enum. El costo de validación en app — verificar que solo se escriban valores conocidos — es bajo y vale la flexibilidad.

2. **`activeMs bigint`, no `int`.** 4 días en ms (`345_600_000`) cabe en int, pero si en el futuro extendemos el window de monitoreo o decidimos trackear tokens muy longevos (ej. para análisis post-mortem de pumps largos), `int` overflowearía. `bigint` da ~292 millones de años de margen y no cuesta nada en perf.

3. **Transformer del bigint en la entity.** `pg` y TypeORM por default traen bigint como `string` para evitar pérdida de precisión. Para `activeMs`, cualquier valor sano (hasta días en ms) cabe sin problema en `Number`, así que un `parseInt` en el `from` es seguro y deja el resto del código tratándolo como número. Sin esto, comparaciones tipo `if (token.activeMs >= 96 * 3600 * 1000)` fallan silenciosamente porque `"0" >= 345600000` es false pero `"500000000" >= 345600000` también es false (comparación lexicográfica).

4. **Índice `(status, activeMs)`.** La query principal de la Fase 5 va a ser "tokens en ACTIVE o DORMANT cuyo `activeMs` excedió el window → archivar". Con el índice compuesto, esa query usa index range scan en vez de seq scan. Costo del índice: ~16 bytes por row, dos columnas chicas. Beneficio: cada scan ejecuta esa query → la querés barata.

5. **Filtro de entrada como guard separado, no como filtro del array.** Podría haber hecho `scanResults.filter(r => r.snapshot.change >= 50 || existeYa)` antes del loop, pero `existeYa` requiere consultar BD por cada símbolo. Lo más limpio y testeable es: hacer `findOne` igual (necesario en ambos paths) y luego ramificar con un guard. Cero queries adicionales vs el código previo.

6. **`TRACKING_ENTRY_MIN_CHANGE_PCT = 50` como constante en el service, no en `scoring.constants.ts`.** Es un parámetro del módulo de tracking, no del scoring. Mantenerlo local al `tracking.service.ts` evita que alguien en el futuro lo confunda con `pumpPct` (el threshold del grade pump, configurable per-user) y que lo cambie pensando que está tocando el otro.

7. **Sin backfill de columnas en filas existentes.** Toda la lógica de Ever-flags y `activeMs` aplica desde la próxima vez que el token reaparece en un scan. Hacer backfill (ej. setear `rsiEverPassed=true` si `peakRsi >= 80`) sería técnicamente correcto, pero requiere ejecutar la lógica de la Fase 5 sobre datos viejos, lo cual mete acoplamiento entre fases. Más limpio: filas viejas se van apagando, las nuevas usan la lógica nueva desde el principio.

## Impacto en deploy

**Requiere migración.** El deploy tiene que correr `pnpm --filter=@short-scanner/api migration:run` antes de arrancar el servicio. Si el servicio arranca primero, el primer scan va a tirar errores tipo `column "rsiEverPassed" of relation "tracked_tokens" does not exist` porque la entity ya las declara.

**No requiere variables de entorno nuevas.** Sin secrets ni toggles.

**No requiere dependencias nuevas.** Todo lo usado (`typeorm`, `pg`) ya estaba.

### Orden de deploy

1. Mergear PR a `main`.
2. `git pull` en el servidor.
3. `pnpm install` (no hay deps nuevas, pero es defensivo).
4. `pnpm --filter @short-scanner/shared-types build`.
5. `pnpm --filter @short-scanner/api migration:run`.
6. Restart del servicio (`pnpm dev` o lo que use producción).

### Riesgo si se invierte el orden

Si el servicio arranca antes de aplicar la migración: la entity referencia columnas que no existen → TypeORM falla al hacer `repo.findOne` con `EntityMetadata` mismatch. La app no arranca o tira errores en cada scan. Mitigación: aplicar la migración manualmente y reiniciar.

## Troubleshooting post-deploy

**Síntoma: la app no arranca, error tipo `column "rsiEverPassed" of relation "tracked_tokens" does not exist`.**

La migración no se aplicó. Correr `pnpm --filter @short-scanner/api migration:show` para ver el estado (debería listar `AddMaturedTracking1779931497700` como `[X]` aplicada). Si está `[ ]`, correr `migration:run`.

**Síntoma: `tracked_tokens` crece más lento de lo esperado, o pareciera no recibir tokens.**

Causa probable: el filtro de entrada está bloqueando muchos tokens. Verificar con el log del scan: el summary actual no reporta cuántos se filtraron — si querés visibilidad, en una fase posterior se puede agregar un contador `filteredByLowChange` al log. Por ahora, contraste rápido: comparar contra el endpoint `GET /scans/latest` (que devuelve los `scored` completos) y la tabla `tracked_tokens`. La diferencia entre "tokens en el scan" y "tokens persistidos" debería corresponder a los <50%.

**Síntoma: `activeMs` aparece como string en queries TypeORM.**

El `bigintTransformer` no se está aplicando. Verificar que la `@Column` use `{ type: 'bigint', default: 0, transformer: bigintTransformer }` y que la const `bigintTransformer` esté declarada **antes** del `@Entity`. Si está después de la clase, los decoradores se ejecutan antes y caen en TDZ del `const`.

**Síntoma: filas viejas (peakChange < 50) ya no se actualizan.**

El filtro está mal aplicado: el guard debe ser `if (!existing && r.snapshot.change < 50)`, no `if (r.snapshot.change < 50)`. Si el segundo está en el código, las existentes con change actual bajo se saltean → mueren prematuramente como si fueran DORMANT.

**Síntoma: el índice nuevo no aparece en `\d tracked_tokens`.**

La migración corrió parcialmente. `pnpm --filter @short-scanner/api migration:revert` para revertir, después `migration:run` de nuevo. Si Postgres reporta error en el CREATE INDEX porque ya existe (deploys parciales previos), eliminar el índice manualmente con `DROP INDEX "IDX_tracked_tokens_active_ms"` y volver a correr la migración.

## Siguientes fases (planeadas, no implementadas acá)

Esta fase es la **base de schema** para una secuencia de 3-4 fases:

- **Fase 5 — Ever-flags + `maturedVerdict` compute**. Reconcile actualiza los 4 booleans en cada scan donde `grades[k].passed=true`, incrementa `activeMs` (con threshold de continuidad), computa `maturedVerdict='GO_SHORT'` cuando las 3 reglas se cumplen, archiva por window expirado.
- **Fase 6 — Dispatch alerta MADURA por Telegram**. Variante del template con header `🎯 MADURO`. Dedup persistente vía `maturedAlertedAt`. Coexiste con la alerta instant existente durante 2 semanas para comparar.
- **Fase 7 (opcional) — UI**. Badge `MADURO` en la tabla del scanner, panel de detalle con progreso de las 4 Ever-flags.

El orden importa: Fase 5 antes que 6 (sin lógica que setee `maturedVerdict`, no hay alerta para disparar). Fase 7 es independiente y se puede hacer antes o después de la 6 según prioridad.
