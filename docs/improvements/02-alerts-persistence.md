# 02 — Persistencia de alertas en Postgres

## Problema que resuelve

Hasta ahora las alertas existían **solo en memoria**, en el `Set<string>` del `ScannerStateStore` (ver `scanner.state.ts:alertedSet`). Ese set se usa únicamente para **dedup dentro del bloque 4H actual** — guarda IDs efímeros tipo `GO_BTC_${block4h}` y los purga cuando crecen mucho. Cuando la API se reinicia, todo se pierde.

Consecuencias del estado actual:

- **No hay histórico.** Imposible preguntar "¿cuántas alertas hubo ayer?" o "¿qué tokens dieron GO_SHORT esta semana?".
- **No hay forma de listar "Otros en CERCA hoy" en el mensaje de Telegram** (Fase 3 lo necesita).
- **Pérdida de info ante fallos.** Si Telegram falla o el bot está caído, la alerta no queda registrada en ningún lado.
- **No se pueden hacer stats** (win-rate por nivel de funding, RSI promedio en GO_SHORT, etc.).

Esta fase agrega una tabla `alerts` en Postgres que persiste **toda alerta generada por el scanner**, independientemente de si el envío a Telegram tuvo éxito.

## Antes vs Después

**Antes:**

```
ScannerService.processUser()
  → applyUserResults() añade ID al alertedSet (in-memory)
  → alerts.dispatch(userId, alert)
        → queue.add() → BullMQ → AlertsProcessor → Telegram.send()

[Si la API se reinicia → alertedSet vacío, no hay forma de saber qué se alertó]
```

**Después:**

```
ScannerService.processUser()
  → applyUserResults() añade ID al alertedSet (in-memory) — sigue igual
  → alerts.dispatch(userId, alert)
        ├── alertsRepo.insert(...) — fire-and-forget, NO bloquea
        └── queue.add() → BullMQ → AlertsProcessor → Telegram.send()

[Si la API se reinicia → la BD tiene todo el histórico persistido]
[Si Telegram falla → la fila igual quedó guardada]
[Si la BD falla → se loguea el error pero Telegram sigue funcionando]
```

## Qué tabla se crea

Tabla `alerts` (Postgres):

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | `uuid` PK | — | `uuid_generate_v4()` default |
| `userId` | `uuid` | NOT NULL | Parte del index compuesto |
| `symbol` | `varchar` | NOT NULL | ej. `BTCUSDT` |
| `base` | `varchar` | NOT NULL | ej. `BTC` |
| `verdict` | `varchar(16)` | NOT NULL | `GO_SHORT` o `CERCA` |
| `mode` | `varchar(16)` | NOT NULL | `STRICT` o `FLEX` |
| `score` | `integer` | NOT NULL | 0-100 |
| `change` | `double precision` | NOT NULL | % cambio 24h |
| `rsi` | `double precision` | NULL | Puede no estar disponible |
| `price` | `double precision` | NOT NULL | USD |
| `vol` | `double precision` | NOT NULL | quoteVolume 24h en USD |
| `fundingRate` | `double precision` | NULL | Decimal (0.05 = 5%) |
| `redCount` | `integer` | NOT NULL | Velas rojas consecutivas cerradas |
| `btcChange` | `double precision` | NOT NULL | % BTC 24h al momento del scan |
| `passed` | `jsonb` | NOT NULL | `{funding, rsi, divergence, redCandles, liquidity}` (booleans) |
| `ts` | `timestamptz` | NOT NULL | Momento del scan que generó la alerta |

**Index:** `idx_alerts_user_ts` btree sobre `(userId, ts)`. Una sola estructura sirve para:

- Filtrar por usuario solo (Postgres usa el leading column del btree compuesto).
- Filtrar por usuario + rango temporal (caso de Fase 3: "alertas de hoy de este usuario").

No agregué index sobre `ts` solo porque no tenemos queries cross-user.

## Garantía: si la BD falla, Telegram sigue funcionando

El `insert` en `AlertDispatcher.dispatch()` es **fire-and-forget**:

```ts
this.alertsRepo
  .insert({ /* ... */ })
  .catch((err) => {
    this.logger.error(`failed to persist alert (...); continuing with dispatch`, err);
  });

// El queue.add a Telegram corre INDEPENDIENTE de si el insert resolvió/falló
const jobId = `tg_${userId}_...`;
await this.queue.add('telegram', { userId, alert }, { jobId, ... });
```

- No hay `await` antes del catch → la promesa del insert vive aparte.
- El `queue.add()` ejecuta inmediatamente, sin esperar al insert.
- Si la BD está caída momentáneamente: aparece un log de error y nada más; el bot sigue enviando alertas.
- Si la BD está sana pero Telegram falla: la fila igual queda en `alerts` (porque el insert se disparó primero).

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `apps/api/src/modules/alerts/alert.entity.ts` | Nueva entidad `AlertEntity` con las 16 columnas + index compuesto. |
| `apps/api/src/modules/alerts/alerts.module.ts` | Import de `TypeOrmModule.forFeature([AlertEntity])` para registrar el repository. |
| `apps/api/src/modules/alerts/alert-dispatcher.service.ts` | Constructor inyecta `Repository<AlertEntity>`. Método `dispatch()` ahora hace `insert` fire-and-forget antes del `queue.add`. |
| `apps/api/src/migrations/1779742474538-AddAlertsTable.ts` | Migración TypeORM: `CREATE TABLE alerts` + `CREATE INDEX idx_alerts_user_ts`. `down()` simétrico con `DROP INDEX` + `DROP TABLE`. |

## Cómo probarlo

### Aplicar la migración

```bash
pnpm --filter=@short-scanner/api migration:run
```

Output esperado: `Migration AddAlertsTable1779742474538 has been executed successfully.`

### Verificar la estructura

```bash
docker exec shortscanner-postgres psql -U postgres shortscanner -c "\d alerts"
```

Debe mostrar las 16 columnas, PK en `id`, e index `idx_alerts_user_ts btree (userId, ts)`.

### Insertar manualmente para validar el schema

Script standalone (fuera de la app, usando el `AppDataSource` compilado):

```js
// /tmp/insert-test.cjs
const ROOT = 'C:/path/to/Short_scanner';
const { AppDataSource } = require(ROOT + '/apps/api/dist/data-source.js');
const { AlertEntity } = require(ROOT + '/apps/api/dist/modules/alerts/alert.entity.js');

(async () => {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(AlertEntity);
  const r = await repo.insert({
    userId: '<tu-user-id>',
    symbol: 'TESTUSDT', base: 'TEST', verdict: 'CERCA', mode: 'FLEX',
    score: 65, change: 12.5, rsi: 78, price: 0.1234, vol: 12_500_000,
    fundingRate: 0.05, redCount: 2, btcChange: 1.21,
    passed: { funding: true, rsi: true, divergence: false, redCandles: true, liquidity: true },
    ts: new Date(),
  });
  console.log('inserted:', r.identifiers[0].id);
  await AppDataSource.destroy();
})();
```

```bash
NODE_PATH=apps/api/node_modules node /tmp/insert-test.cjs
```

### Ver lo guardado

```sql
SELECT * FROM alerts ORDER BY ts DESC LIMIT 10;
```

### Query típica de Fase 3 (alertas de hoy para un usuario)

```sql
-- "hoy" en zona horaria Colombia (UTC-5)
SELECT base, verdict, score, change, ts
FROM alerts
WHERE "userId" = '<user-id>'
  AND ts >= date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'
ORDER BY ts DESC;
```

### Validar el path completo en runtime

El insert real solo se ejerce cuando `ScannerService.processUser()` detecta un GO_SHORT o CERCA en un ciclo de scan. Para validar:

1. Dejar la app corriendo (`pnpm dev`).
2. Esperar al ciclo de scan (cada 2min) hasta que el mercado produzca una alerta.
3. Cuando los logs muestren `... · N new alerts` con `N > 0`, ese alert ya debe estar persistido:

```sql
SELECT base, verdict, score, ts FROM alerts ORDER BY ts DESC LIMIT 5;
```

### Probar el rollback

```bash
pnpm --filter=@short-scanner/api migration:revert
# DROP INDEX + DROP TABLE → la tabla y sus datos desaparecen
docker exec shortscanner-postgres psql -U postgres shortscanner -c "\d alerts"
# → "Did not find any relation named alerts" ✓

pnpm --filter=@short-scanner/api migration:run
# CREATE TABLE + CREATE INDEX → tabla vuelve, vacía
```

### Limitación de la validación

Durante el desarrollo, el insert se probó vía TypeORM Repository directo (script `insert-direct.cjs`), lo cual validó el schema y los tipos **pero NO ejerció el código real del `AlertDispatcher`**. La integración completa `Scanner → Dispatcher → insert + queue` solo se valida con una alerta orgánica del scanner (o un test de integración que monte el contexto de Nest). Revisar el código del dispatcher en `alert-dispatcher.service.ts` con atención especial — esa es la parte que el test directo no cubre.

## Decisiones de diseño

1. **Persistir TODOS los campos del `ScanAlert`, no solo los mínimos para Fase 3.** La opción mínima sería guardar solo `{base, verdict, score, change, ts}` (lo que Fase 3 muestra en "Otros hoy"). Pero abrir espacio para stats futuras (win-rate por funding, RSI promedio en GO_SHORT, distribución de divergencias passing, etc.) es prácticamente gratis ahora — son ~10 columnas más sobre una tabla con volumen bajo (~10 alerts/día/usuario). Migrar después para agregar columnas sería peor que pagarlo de una.

2. **`passed` como `jsonb`, no columnas separadas.** Los 5 flags (funding/rsi/divergence/redCandles/liquidity) podrían ser 5 columnas booleanas. Decisión por `jsonb`: (a) no necesitamos filtrar/indexar por flag individual (las queries son por `userId+ts`, no "alerts donde divergencia passed"), (b) si en el futuro agregamos un indicador, no requiere migración nueva — solo cambia el shape del objeto, (c) refleja mejor la estructura del tipo TypeScript que es un objeto anidado.

3. **Index compuesto `(userId, ts)` y no separados.** Postgres puede usar la columna líder de un index compuesto para queries que filtren solo por `userId`. Tener `(userId, ts)` cubre tanto `WHERE userId=?` como `WHERE userId=? AND ts BETWEEN ...`. Un index separado sobre `userId` solo sería redundante.

4. **Sin foreign key a `users(id)`.** Las otras entidades (`trades`, `tracked_tokens`) **tampoco** referencian `users` con FK explícito — solo guardan `userId uuid`. Mantengo consistencia con esa convención del repo. Si se quisiera, se podría agregar la FK después.

5. **Insert antes del `queue.add`, no después.** Si lo hiciera después (en `AlertsProcessor` cuando confirma envío exitoso), perdería las alertas que Telegram rechaza. Mi prioridad es **registrar todo lo que el scanner generó**, no solo lo que llegó al usuario. Esta decisión la confirmó el operador del scanner.

6. **Sin verificación de duplicados a nivel BD.** El dedup ya lo hace `ScannerStateStore.alertedSet` (in-memory, por 4h-block). Si por alguna razón llegaran dos `dispatch()` con el mismo (userId, base, verdict, block4h), serían dos rows en BD — pero BullMQ los dedupea con el `jobId` determinístico. Doble protección a niveles distintos; no agregar un UNIQUE constraint que pueda romper inserts legítimos en escenarios edge.

7. **`ts` como `timestamptz`, no `bigint`.** El `ScanAlert.ts` viene como epoch ms (`number`). Convertir a `Date` al insertar (`new Date(alert.ts)`) y dejar Postgres manejar el formato como `timestamp with time zone` permite queries naturales con `date_trunc`, `BETWEEN`, etc. La conversión inversa al leer es trivial.

## Impacto en deploy

**Esta fase SÍ requiere migración de BD.** Es la diferencia clave con Fase 1.

### Orden obligatorio en el deploy:

1. **Pull del código nuevo** (`git pull`).
2. **Aplicar la migración** (`pnpm --filter=@short-scanner/api migration:run`).
3. **Recién después: restart del servicio** (`pnpm dev` / PM2 / systemd).

Si se reinicia el servicio antes de migrar, el código nuevo intentará hacer `INSERT INTO alerts (...)` y crashea con `relation "alerts" does not exist`. El `.catch()` del fire-and-forget atrapa el error y lo loguea, así que **no rompe el envío a Telegram**, pero todas las alertas hasta que se aplique la migración se pierden de la BD.

### Variables de entorno / dependencias

- **No requiere envs nuevas.** Usa la `DATABASE_URL` existente.
- **No requiere dependencias nuevas.** TypeORM y `@nestjs/typeorm` ya estaban en `package.json`.

### Backup antes de migrar (recomendación)

Antes de correr la migración por primera vez en producción, hacer `pg_dump` de la BD aunque sea chica. Es buena práctica con cualquier migración que crea estructuras nuevas. Para esta fase específica el riesgo es bajo (solo `CREATE TABLE` + `CREATE INDEX`, no modifica tablas existentes), pero el reflejo es válido — sirve para sentir confianza con el proceso y queda como red de seguridad para las próximas fases que sí toquen estructuras existentes.

```bash
pg_dump -U postgres -h <host> shortscanner > backup-pre-alerts-$(date +%Y%m%d).sql
```

### `migrationsRun: true` vs migrar a mano

`app.module.ts:36` tiene `migrationsRun: true` en la config de TypeORM. Funciona y es la opción más simple — la app aplica migraciones pendientes al boot. Pero conviene también poder ejecutar a mano (`pnpm --filter=@short-scanner/api migration:run`) para:

- **Auditar el SQL antes de aplicarlo.** Corriéndolo a mano se ve cada query y se puede abortar si algo no convence.
- **Separar el proceso de migrar del proceso de bootear el servicio.** Más auditable en logs y más fácil de detectar dónde estuvo el fallo si algo sale mal.
- **Facilitar rollback.** Más controlable cuando se hizo a mano que cuando la lanzó el boot — sabés exactamente qué se aplicó y cuándo.

En producción la recomendación es **migrar a mano antes del restart**. En dev local se puede confiar en el auto-apply.

## Troubleshooting post-deploy

**Síntoma: las alertas llegan a Telegram pero no aparecen en `SELECT * FROM alerts`.**

Causas posibles:
1. La migración no se aplicó. Verificar con `SELECT * FROM migrations ORDER BY id DESC;` — debe aparecer `AddAlertsTable1779742474538`. Si no está, correr `pnpm migration:run`.
2. El insert está fallando silenciosamente. Buscar en logs: `failed to persist alert (user=...); continuing with dispatch`. Ese log indica que el `catch` del fire-and-forget se ejecutó. Causas: BD desconectada, permisos, schema desfasado.
3. La app está corriendo código viejo. Verificar logs de boot: tiene que aparecer un `Nest application successfully started` posterior al deploy.

**Síntoma: el servicio no arranca después del deploy con error `relation "alerts" does not exist`.**

La migración no se aplicó antes del restart. Aplicar y reintentar:

```bash
pnpm --filter=@short-scanner/api migration:run
# luego: restart del servicio
```

**Síntoma: tras correr `migration:run` aparece `No migrations are pending` pero la tabla no existe.**

Posible mismatch entre el build de `dist/` y el código fuente. Forzar rebuild:

```bash
rm -rf apps/api/dist
pnpm --filter=@short-scanner/api build
pnpm --filter=@short-scanner/api migration:run
```

**Síntoma: al revertir la migración los datos se pierden.**

Esperado. El `DROP TABLE` borra todas las filas. Si se necesita preservar datos antes de revertir, hacer `pg_dump alerts > alerts-backup.sql` primero. Para dev local esto típicamente no importa; para prod sí.

**Síntoma: tras `migration:revert` la app crashea al recibir una alerta.**

Esperado. El código sigue intentando insertar en una tabla que ya no existe. El fire-and-forget atrapa el error y loguea, pero las alertas no se persisten. Re-aplicar la migración para recuperar.

## No bloquea Fase 3

Esta fase es **prerequisito** para Fase 3 (`03-others-today.md`), que consultará esta tabla para mostrar "Otros en CERCA hoy" en cada mensaje de Telegram. No tiene impacto en el frontend (los datos persistidos no se exponen aún por API).
