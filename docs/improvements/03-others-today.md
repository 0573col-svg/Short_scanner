# 03 — "Otros del día" en el mensaje de Telegram

## Problema que resuelve

Cuando llega una alerta, el operador ve la info de **ese** símbolo en aislamiento. No tiene contexto sobre qué otra actividad hubo en el día — si fue un día tranquilo (1 sola alerta), o si ya pasaron 5 antes, o si el mismo símbolo ya dio CERCA por la mañana y ahora subió a GO SHORT por la tarde. Ese contexto temporal es operativamente útil: ayuda a calibrar si la alerta actual es un evento aislado o parte de una tendencia.

La Fase 2 dejó el histórico persistido en la tabla `alerts`. Esta fase consume ese histórico y agrega al final de cada mensaje una sección **"Otros del día"** listando las demás alertas del usuario disparadas desde las 00:00 hora Colombia (UTC-5).

## Antes vs Después

**Antes** (mensaje de Fase 1, sin contexto histórico):

```
🔵 CERCA — NEWALT
⚙️ Modo: Flexible

💰 Precio: $0.500000
📊 24h: +22.10%
📊 Score: 67/100

✅ Funding: +5.500%
✅ RSI 4h: 78
✅ Divergencia: sí
✅ Velas rojas: 2 (cerradas)
📊 BTC: +0.50%
✅ Volumen: 20.0M

⏰ Cierre vela 4H en: 1h 25min
```

**Después** (Fase 3, si hay otras alertas en el día):

```
🔵 CERCA — NEWALT
⚙️ Modo: Flexible

💰 Precio: $0.500000
📊 24h: +22.10%
📊 Score: 67/100

✅ Funding: +5.500%
✅ RSI 4h: 78
✅ Divergencia: sí
✅ Velas rojas: 2 (cerradas)
📊 BTC: +0.50%
✅ Volumen: 20.0M

⏰ Cierre vela 4H en: 1h 25min

📋 Otros del día:
  • EDEN [CERCA] +61.4% (hace 8h, score 38)
  • XAN [CERCA] +45.2% (hace 4h, score 55)
  • PROVE [GO SHORT] +48.0% (hace 2h, score 75)
```

Si **no hay otras alertas en el día** (ej. primera del día), la sección **no se renderiza** — el mensaje termina exactamente como en Fase 1, en la línea de cierre 4H. No hay "Sin otras alertas hoy" ni nada similar; un placeholder vacío se vería raro y ocuparía espacio sin aportar.

## Qué cambia

Cuatro piezas chicas + un servicio nuevo:

1. **UUID client-side en el dispatcher.** `AlertDispatcher.dispatch()` genera el id con `crypto.randomUUID()` **antes** del `insert`, lo pasa explícitamente al insert (en vez de dejar que Postgres lo genere con `uuid_generate_v4()`), y lo agrega al payload de BullMQ. Esto mantiene 100% el patrón fire-and-forget de Fase 2 — no esperamos al insert para saber el id porque ya lo conocemos.

2. **Payload del job de BullMQ extendido.** `TelegramJobData` ahora tiene un campo opcional `currentAlertId?: string`. Marcado opcional por defensa: si tras un deploy quedaran jobs viejos encolados sin ese campo, el processor sigue funcionando — solo que la sección "Otros" de ese mensaje específico podría incluir la alerta actual (caso edge muy raro).

3. **Nuevo servicio `AlertsHistoryService`.** Una sola query: `getOthersToday(userId, excludeId?): Promise<OtherTodayAlert[]>`. Filtra por usuario, por `ts >= startOfTodayBogotaUTC()`, y excluye el id pasado. Ordena ASC (cronológico) y caps a 20 items.

4. **Processor consulta history y pasa al formatter.** Antes de llamar a `formatAlert`, el processor llama a `getOthersToday(userId, currentAlertId)`. Si la query falla (BD caída, timeout, etc.), atrapa el error, loguea, y pasa `[]` — el mensaje sale sin la sección extra. **Nunca bloquea el envío a Telegram.**

5. **`formatAlert(alert, othersToday)` renderiza la sección.** Si `othersToday.length === 0`, ignora. Si tiene items, agrega línea en blanco + header `📋 Otros del día:` + una línea por item con formato `  • {BASE} [{TAG}] {±X.X%} ({hace Xh}, score N)`.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `packages/shared-types/src/scoring.ts` | Nuevo tipo `OtherTodayAlert` (base, verdict, change, score, ts). Compartido entre history service, processor y formatter. |
| `apps/api/src/modules/alerts/alerts.queue.ts` | `TelegramJobData.currentAlertId?: string` (opcional por defensa). |
| `apps/api/src/modules/alerts/alert-dispatcher.service.ts` | Genera UUID con `randomUUID()`, lo incluye en el insert y en el payload del job. |
| `apps/api/src/modules/alerts/alerts.history.service.ts` *(NUEVO)* | Servicio con `getOthersToday()` + helper `startOfTodayBogotaUTC()`. Cap defensivo de 20 rows. |
| `apps/api/src/modules/alerts/alerts.module.ts` | Registra `AlertsHistoryService` en providers y exports. |
| `apps/api/src/modules/alerts/alerts.processor.ts` | Inyecta history service, consulta `getOthersToday` con try/catch, pasa el array al formatter. |
| `apps/api/src/modules/telegram/telegram.service.ts` | `formatAlert(alert, othersToday)` agrega sección si `othersToday.length > 0`. Helper privado `fmtAgo`. |

## Cómo probarlo

### Aplicar el código + verificar que arranca

```bash
git pull
pnpm install        # solo si hay deps nuevas (esta fase no agrega)
# No hay migración nueva: Fase 3 reusa la tabla 'alerts' de Fase 2.
pnpm dev
```

### Validar sin esperar alerta orgánica del mercado

Hay dos paths:

**(a) SQL seed + alerta orgánica:** seedear varias alertas "del día" directamente en BD para que la próxima alerta orgánica que dispare el scanner ya tenga "otros" que listar.

```sql
INSERT INTO alerts (id, "userId", symbol, base, verdict, mode, score, "change", rsi, price, vol, "fundingRate", "redCount", "btcChange", passed, ts) VALUES
  (uuid_generate_v4(), '<user-id>', 'EDENUSDT',  'EDEN',  'CERCA',    'FLEX', 38, 61.4, 78, 0.5, 20000000, 0.055, 2, 0.5,
   '{"funding":true,"rsi":false,"divergence":false,"redCandles":false,"liquidity":false}', now() - interval '8 hours'),
  (uuid_generate_v4(), '<user-id>', 'XANUSDT',   'XAN',   'CERCA',    'FLEX', 55, 45.2, 78, 0.5, 20000000, 0.055, 2, 0.5,
   '{"funding":true,"rsi":true,"divergence":true,"redCandles":true,"liquidity":true}',     now() - interval '4 hours'),
  (uuid_generate_v4(), '<user-id>', 'PROVEUSDT', 'PROVE', 'GO_SHORT', 'FLEX', 75, 48.0, 78, 0.5, 20000000, 0.055, 2, 0.5,
   '{"funding":true,"rsi":true,"divergence":true,"redCandles":true,"liquidity":true}',     now() - interval '2 hours');
```

Luego esperar al ciclo del scanner. Cuando dispare un GO_SHORT/CERCA orgánico, el mensaje a Telegram debería incluir las 3 alertas seeded en "Otros del día" (en orden cronológico ASC).

**(b) Mini-contexto Nest ad-hoc (no committeado).** Durante el desarrollo de esta fase se usó un script `inject-via-dispatcher.cjs` colocado en la raíz del repo (luego eliminado), que:
- Booteaba un `NestFactory.createApplicationContext(AppModule)` con `NODE_ENV=test` (para suprimir el scan inicial).
- Obtenía `AlertDispatcher` y `Repository<AlertEntity>` via `app.get(...)`.
- Por cada caso de test (multiple-others / first-of-day / same-symbol-evolution): hacía `repo.clear()`, seedeaba rows, llamaba `dispatcher.dispatch(USER_ID, mockAlert)`, esperaba ~8s y pasaba al siguiente.

Este path ejerce **toda la cadena real**: dispatcher → insert + queue.add → processor → history.getOthersToday → formatAlert → Telegram. El script no se mantiene en el repo porque es overhead de tooling para un test puntual; si se necesita rehacerlo, el patrón está documentado acá.

### Validar la query directamente con SQL

Lo que el código TS hace, en SQL equivalente:

```sql
-- Reemplazar :user-id y :exclude-id (la alerta actual recién insertada)
SELECT base, verdict, "change", score, ts
FROM alerts
WHERE "userId" = '<user-id>'
  AND ts >= date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'
  AND id != '<exclude-id>'  -- opcional
ORDER BY ts ASC
LIMIT 20;
```

### Validar que la timezone es la correcta

```sql
-- Debería devolver el inicio del día en hora Colombia (con offset -05)
SELECT date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota';
```

Si en el TS se calcula de otra forma (offset hardcoded), comparar que coincida con este valor. Tienen que dar exactamente el mismo timestamp UTC.

## Decisiones de diseño

1. **Filtro por `id`, no por `base`.** Permite ver la **evolución del mismo símbolo en el día** — si XAN dio CERCA por la mañana y luego GO SHORT por la tarde, el mensaje de la tarde muestra `XAN [CERCA] +45.2% (hace 6h, score 55)` en "Otros del día". Filtrar por `base` ocultaría esa evolución, que es justamente lo que da más contexto operativo. Requiere conocer el id de la alerta actual **antes** del insert — resuelto con UUID client-side.

2. **UUID client-side con `crypto.randomUUID()`.** TypeORM `repo.insert(...).identifiers[0].id` solo está disponible **tras** await el insert, lo cual rompería el patrón fire-and-forget de Fase 2 (la dispatch tendría que esperar al insert, metiendo latencia y modos de falla de BD en el path de Telegram). Generar el UUID en JS antes del insert resuelve sin compromisos: id disponible sincrónicamente, fire-and-forget intacto, sin nueva dependencia (`node:crypto` es nativo desde Node 14.17).

3. **Tag `[GO SHORT]` completo, no `[GO]`.** `[GO]` solo es más corto pero ambiguo a primera vista — podría leerse como "ir/entrada" cuando es la abreviatura de "GO SHORT". `[GO SHORT]` ocupa 4 chars más por línea pero deja zero ambigüedad. La diferencia visual con `[CERCA]` (más corto) ayuda a escanear rápido el tipo de cada item.

4. **Orden cronológico ASC** (más viejo arriba, más reciente abajo). El usuario lee el mensaje de la alerta nueva, y al final ve "qué pasó antes" en orden temporal natural — como un timeline. DESC funciona también pero invierte la dirección de lectura natural.

5. **Helper `fmtAgo`: `"recién"` para <1min.** Mostrar `"hace 0min"` se ve raro y poco informativo. `"recién"` comunica claramente "casi al mismo tiempo que la actual". Para 1-59 min usa `"hace Xmin"` (granularidad útil para alertas muy recientes). Para ≥1h usa `"hace Xh"` con `floor` (consistente: "hace 1h" = entre 60 y 119 minutos).

6. **Cap defensivo de 20 items.** Días típicos para un usuario tienen ~5-10 alerts; 20 es margen amplio sin riesgo de mensaje truncado por límite de Telegram (4096 chars). La plantilla base son ~400 chars, 20 items × ~50 chars cada uno = ~1000 chars extra. Total bien bajo el límite.

7. **Sin sección si está vacío.** En la primera alerta del día no hay "otros". Renderizar `📋 Otros del día:` seguido de nada, o un mensaje tipo "Sin otras alertas hoy", se ve mal y ocupa espacio sin aportar. Decisión: solo renderizar si hay al menos un item.

## Impacto en deploy

**No requiere migración nueva.** Esta fase consume la tabla `alerts` que ya creó la Fase 2 — depende **estrictamente** de que la migración de Fase 2 esté aplicada en la BD donde se va a deployar.

**No requiere variables de entorno nuevas.** No hay secrets ni toggles nuevos.

**No requiere dependencias nuevas.** `randomUUID` es nativo de Node.

### Orden de deploy

1. `git pull` (asume que Fase 2 ya está mergeada a main y aplicada).
2. (Si no se aplicó aún) `pnpm --filter=@short-scanner/api migration:run` para asegurar que la tabla `alerts` existe.
3. Restart del servicio.

### Riesgo si se deploya sin Fase 2 aplicada

El `history.getOthersToday()` haría `SELECT ... FROM alerts ...` contra una tabla que no existe, tiraría error, el try/catch del processor lo atrapa, loguea, y manda el mensaje **sin** sección "Otros". Funcionalmente no rompe nada, pero pierde la funcionalidad de Fase 3 hasta que se aplique la migración.

## Troubleshooting post-deploy

**Síntoma: los mensajes nunca incluyen sección "Otros del día", aunque haya alertas históricas en BD.**

Causas posibles:
1. La tabla `alerts` no existe o está vacía. Verificar con `SELECT COUNT(*) FROM alerts WHERE ts >= ...` (ver query SQL arriba). Si está vacía, esperar a que el scanner genere alertas (mínimo 2 distintas en el día para que aparezca "Otros" en la segunda).
2. La query está tirando excepción silenciosa. Buscar en logs del processor: `getOthersToday failed for user ...; sending alert without "Otros del día"`. Ese mensaje indica que el try/catch atrapó algo — el error siguiente en logs detalla la causa.
3. La timezone está mal calculada. Verificar que `startOfTodayBogotaUTC()` devuelva el inicio del día Colombia (UTC-5). Test rápido: si son las 22:00 Colombia del 25 de mayo, debe devolver `2026-05-25T05:00:00.000Z` (= 2026-05-25T00:00:00-05:00).

**Síntoma: el mismo símbolo aparece dos veces** (una en el header, otra en "Otros").

Esto es **comportamiento esperado** y deseado. Significa que el símbolo ya disparó otra alerta en el día (típicamente CERCA por la mañana evolucionado a GO_SHORT por la tarde, o viceversa). El filtro es por id, no por base — el design intent es ver la evolución.

**Síntoma: la sección "Otros" muestra una alerta que parece ser la actual** (mismo base + verdict + tiempo "recién").

Causas posibles:
1. El job se procesó dos veces (BullMQ no debería permitirlo con el jobId determinístico, pero si hubo edición manual de Redis o algún reset, es posible). Verificar `bull:alerts:tg_*` en Redis.
2. El payload del job no incluye `currentAlertId` — probablemente un job encolado antes del deploy de Fase 3 (compatibilidad). En ese caso, el filtro `excludeId` se salta y la alerta actual aparece en "Otros". Es transitorio: jobs nuevos sí lo incluyen.

**Síntoma: el mensaje a Telegram nunca llega después del deploy de Fase 3.**

Casi seguro NO es esta fase — Fase 3 envuelve la query en try/catch, no puede bloquear el envío. Revisar: bot token válido, chat ID correcto, dev server corriendo, BullMQ worker activo. Si la query de `getOthersToday` está fallando, el log lo indica pero el mensaje igual sale (sin la sección "Otros").

**Síntoma: el orden cronológico se ve invertido** (más reciente arriba, más viejo abajo).

Verificar que `getOthersToday()` use `.orderBy('a.ts', 'ASC')`. Si dice `DESC`, está mal — la decisión de diseño es ASC para que el usuario lea la timeline en sentido natural.

## Cierre del plan de mejoras

Esta fase completa el plan de tres fases (`01-rich-telegram-template.md`, `02-alerts-persistence.md`, `03-others-today.md`). Cada una se puede mergear y deployar de forma independiente con el orden 1 → 2 → 3 (Fase 3 depende de la tabla creada por Fase 2; Fase 1 es independiente de las otras dos).
