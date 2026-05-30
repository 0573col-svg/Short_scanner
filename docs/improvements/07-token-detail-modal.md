# 07 — Modal de detalle del token (Backlog A)

> **Fase multi-sub-fase — COMPLETA.** Este documento cubre el modal de detalle del token, entregado en tres sub-fases que fueron rellenando los placeholders. Cierra el **Backlog A**.
> - **07.1** *(hecho)* — modal, header, panel de las 7 condiciones, placeholders de tracking y chart.
> - **07.2** *(hecho)* — sección **Tracking** con datos reales de `tracked_tokens` (Ever-flags, activeMs, peak price, maduración).
> - **07.3** *(hecho)* — **Gráfico de velas** (últimos 7 días · 4H) vía proxy server-side de Binance + `lightweight-charts`.

## Problema que resuelve

El scanner v22 (el monolito HTML original) permitía hacer click en una fila de la tabla para abrir un detalle del activo: histórico, puntuación desglosada por condición, y por qué cada una pasaba o no. Kervin usaba mucho ese detalle para análisis manual antes de entrar a un short. Cuando el sistema se reescribió a la arquitectura NestJS + React, esa funcionalidad **no se migró** — la nueva web mostraba la tabla pero al clickear una fila no pasaba nada. Funcionalmente era una regresión respecto al v22.

Esta sub-fase reintroduce el punto de entrada: **click en una fila → modal de detalle**. El primer panel que se conecta es el desglose de las **7 condiciones del scoring**, que es el dato más demandado para decidir una entrada y, además, ya viaja completo en el response del scanner (`ScoredToken.grades`) — no requiere backend nuevo. Los otros dos paneles (tracking, gráfico) quedan como placeholders explícitos para las sub-fases 07.2 / 07.3.

## Antes vs Después

**Antes:** la tabla del scanner es de solo lectura. Click en una fila no hace nada. Para ver por qué un token tiene score 62 había que inferirlo de las columnas visibles o mirar el log del API.

**Después:** click en cualquier fila abre un modal centrado con:

```
┌─────────────────────────────────────────────┐
│ ALLO/USDT   [CERCA]                       ×  │
│ $0.264030   +51.2%   Score 62                │
│ (badge ámbar "datos del scan a las HH:MM"    │
│  solo si el token cayó del ranking)          │
├─────────────────────────────────────────────┤
│ CONDICIONES (7)                              │
│  ✅ Pump 24h        +51.2%                    │
│  ⬜ RSI 4H          68.4                      │
│  ✅ Funding rate    +0.043%                   │
│  ✅ Divergencia     detectada (fuerza 0.72)   │
│  ⚪ Velas rojas     1 consecutiva  ← ámbar    │
│  ✅ BTC OK          +0.33%                    │
│  ✅ Liquidez 24h    8.5M                      │
├─────────────────────────────────────────────┤
│ TRACKING                                     │
│   Aún no monitoreado    (placeholder 07.2)   │
├─────────────────────────────────────────────┤
│ PRECIO (últimos 7 días)                      │
│   Gráfico — disponible en 07.3 (placeholder) │
├─────────────────────────────────────────────┤
│                       Abrir en Binance ↗     │
└─────────────────────────────────────────────┘
```

Cierra con **Escape**, click en el backdrop, o la **×**. Mientras está abierto, el scroll del body queda bloqueado.

## Qué cambia

Cuatro piezas, todas en `apps/web` (cero backend, cero migración, cero cambio de tipos):

1. **`GradesPanel.tsx` *(NUEVO)*** — render del desglose de las 7 condiciones. Toma `grades`, el `snapshot` y el `btcChange` del último scan. Cada fila combina:
   - **Ícono de estado**: `✅` passed, `⬜` not-passed, `⚪` neutral (`g.neutral`).
   - **Color del valor**: verde si pasó, **ámbar si `state === 'near'`** (parcial — el caso de "1 de 2 velas rojas"), gris si no pasó ni está cerca, gris-medio si neutral.
   - **Valor humano por condición**: cada grade tiene su formateo (`formatRsi`, `formatFunding`, `formatDivergence`, `formatRedCandles`, `formatBtcOk`), porque el dato vive en campos distintos del `snapshot` y no en el `grade` mismo.

2. **`TokenDetailModal.tsx` *(NUEVO)*** — el contenedor. Renderiza vía `createPortal` a `document.body` (escapa el stacking context de la tabla). Maneja:
   - Listener de **Escape** + **scroll-lock** del body, montados/desmontados con el ciclo de vida del `token` (effect con cleanup).
   - Header con base/par, `VerdictPill`, precio, cambio 24h (verde/rojo), score.
   - **Badge de staleness** (ámbar): si `snapshotAgeMs > STALE_AFTER_MS` (2 min, = un ciclo de scan), muestra "Datos del scan a las HH:MM — este token salió del ranking". Cubre el caso en que el modal queda abierto y el token desaparece del top-N en el siguiente scan.
   - Body: `GradesPanel` + dos `<section>` placeholder (tracking, chart) con borde punteado.
   - Footer con link "Abrir en Binance ↗" (`target=_blank`, `rel=noopener`).

3. **`ScannerTable.tsx`** — prop opcional `onRowClick?: (row: ScoredToken) => void`. Si está presente, cada `<tr>` recibe el handler + `cursor-pointer`. Opcional para no romper otros usos de la tabla (la prop ausente deja la tabla en modo solo-lectura, sin cursor).

4. **`Scanner.tsx`** — orquesta el estado `selected: ScoredToken | null`. Cablea `onRowClick={setSelected}` y monta el modal. La pieza no trivial es el **re-bind del snapshot**:

   ```tsx
   // Al llegar scan:update, re-apunta el modal a la versión fresca del token.
   useEffect(() => {
     if (!selected || !state?.results) return;
     const fresh = state.results.find(
       (r) => r.snapshot.symbol === selected.snapshot.symbol,
     );
     if (fresh && fresh !== selected) setSelected(fresh);
   }, [state?.results, selected]);
   ```

   Sin esto, el modal mostraría datos congelados del momento del click. Con esto, mientras el token siga en el ranking el modal se actualiza vivo cada 2 min. Si **cae** del ranking, `fresh` es `undefined` y el modal **mantiene el último snapshot** (no se cierra) — y el badge de staleness explica por qué los datos están viejos. Es deliberado: que el token salga del top-N no debería arrancarle el detalle de la cara al operador a mitad de análisis.

   `snapshotAgeMs` se deriva de `state.ranAt - selected.snapshot.ts`; `btcChange` de `state.btc.change`. Ambos se pasan al modal.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `apps/web/src/components/GradesPanel.tsx` *(NUEVO)* | Render de las 7 condiciones con ícono/color/valor por grade. |
| `apps/web/src/components/TokenDetailModal.tsx` *(NUEVO)* | Modal vía portal: header, grades, placeholders tracking/chart, footer Binance. Escape + scroll-lock + badge staleness. |
| `apps/web/src/components/ScannerTable.tsx` | Prop opcional `onRowClick`; `<tr>` clickeable + `cursor-pointer` cuando está presente. |
| `apps/web/src/pages/Scanner.tsx` | Estado `selected`, montaje del modal, `useEffect` de re-bind del snapshot fresco, derivación de `snapshotAgeMs` y `btcChange`. |

## Cómo probarlo

No hay test automatizado para esta sub-fase (es UI pura, validación visual). Smoke manual:

```bash
pnpm dev      # api :3000 + web :5173
```

1. Abrir `http://localhost:5173`, esperar a que la tabla se pueble (≤2 min, primer scan).
2. **Click en cualquier fila** → debe abrir el modal con el panel de las 7 condiciones.
3. Verificar los colores: un token con **velas rojas parciales** (ej. "1 consecutiva" cuando el umbral pide 2) debe mostrar ese valor en **ámbar**, no verde ni gris.
4. Cerrar con **Escape**, con **click en el backdrop** (fuera de la tarjeta), y con la **×**. Las tres deben cerrar.
5. Con el modal abierto, confirmar que el **scroll del body está bloqueado**.
6. **Staleness** (opcional, requiere paciencia): dejar el modal abierto sobre un token marginal y esperar a que caiga del ranking en un scan posterior → debe aparecer el badge ámbar "datos del scan a las HH:MM" sin cerrarse.

## Decisiones de diseño

1. **`createPortal` a `document.body`.** El modal escapa el DOM de la tabla para no heredar `overflow`/`z-index`/`transform` de los contenedores del grid. Es la forma estándar de evitar clipping de overlays.

2. **El modal no se cierra cuando el token cae del ranking.** La alternativa (cerrar automáticamente) interrumpiría el análisis del operador justo cuando el dato dejó de actualizarse. Preferimos mantener el último snapshot + un badge honesto que diga "esto está viejo". El operador decide cuándo cerrar.

3. **Re-bind por igualdad referencial (`fresh !== selected`).** El effect solo re-setea si el objeto cambió de identidad, evitando un render-loop. Como el scanner emite objetos nuevos por scan, la comparación referencial alcanza para detectar "hay datos nuevos de este token".

4. **Valores formateados en `GradesPanel`, no en el grade.** El `Grade` solo trae `{ passed, state, neutral, ... }` — el valor numérico crudo (RSI, funding, etc.) vive en campos del `snapshot`. El panel mapea cada `GradeKey` a su fuente y su formateo. Mantiene el tipo `Grade` agnóstico de presentación.

5. **`STALE_AFTER_MS = 2 min` = un ciclo de scan.** Si el snapshot tiene más de un ciclo de antigüedad, por definición el token no apareció en el último scan → cayó del ranking. Es el umbral natural, no un número arbitrario.

6. **Placeholders explícitos en vez de ocultar las secciones.** Tracking y chart se muestran como cajas punteadas con su título y un texto "disponible en 07.x". Comunican que la funcionalidad está planificada (no rota ni olvidada) y dejan el layout final ya dimensionado, así 07.2/07.3 solo rellenan el contenido sin reflow del modal.

7. **`onRowClick` opcional en `ScannerTable`.** No se asume que toda instancia de la tabla quiera abrir el modal. Sin la prop, la tabla queda exactamente como antes (sin cursor, sin handler) — cambio no invasivo.

---

# 07.2 — Sección Tracking con datos reales

## Qué resuelve

07.1 dejó la sección Tracking como un placeholder "Aún no monitoreado" sin datos. 07.2 la conecta a la fila real de `tracked_tokens` del símbolo: estado del token, progreso de las **4 Ever-flags** del verdict maduro, tiempo en monitoreo, precio pico vs actual, y estado de maduración. Es la información que el operador necesita para saber *en qué punto de su ciclo de vida* está un token antes de entrar — complementa el "ahora mismo" del panel de condiciones (07.1) con el "cómo viene evolucionando".

Toda la data ya existía en `TrackedTokenView` (poblada por las Fases 4-5-6 del verdict maduro). 07.2 es **100% frontend**: cero backend, cero migración, cero cambio de tipos.

## Decisión: lookup por símbolo vía filtro client-side (Opción A)

El modal tiene `snapshot.symbol` (ej. `HEIUSDT`), pero el endpoint de detalle `GET /api/tracking/:id` busca por UUID. Dos caminos evaluados:

- **A (elegida)** — reusar `api.listTracking(...)` y filtrar por `symbol` en el cliente. Sin backend.
- **B (descartada por ahora)** — endpoint nuevo `GET /api/tracking/by-symbol/:symbol`.

Se eligió **A**: a la escala actual (solo tokens que cruzan el gate de entrada +50% 24h — decenas como mucho) el filtro es instantáneo, reusa el hook ya existente, y mantiene 07.2 como PR limpio de solo-frontend. Si algún día la lista escala lo suficiente para que traerla entera importe, se agrega B sin romper el contrato del componente (el hook seguiría devolviendo `TrackedTokenView | null`).

## Qué cambia

Cuatro piezas en `apps/web`:

1. **`lib/format.ts`** — dos helpers nuevos de tiempo:
   - `fmtAgo(iso)` — tiempo relativo en castellano: "recién" / "hace 40s" / "hace 12min" / "hace 4h" / "hace 3d". Devuelve `—` si el timestamp es null/0 (Ever-flag que nunca pasó, sin `*PassedAt`).
   - `fmtActiveTime(ms)` — duración de monitoreo legible que cambia de unidad por magnitud: "8min" / "3h 12min" / "2d 4h". Necesario porque en QA el `activeMs` está en minutos y en producción en horas/días.

2. **`hooks/useTrackedBySymbol.ts` *(NUEVO)*** — resuelve la fila de tracking de un símbolo:
   - `symbol === null` (modal cerrado) → no hace fetch, devuelve `tracked: null`.
   - `symbol` seteado → `api.listTracking(['ACTIVE','DORMANT','SHORTED','CLOSED'])` y `.find(t => t.symbol === symbol)`. Incluye SHORTED/CLOSED para que el panel siga mostrando tracking de un token que el user ya shorteó.
   - Re-fetch en cada `scan:update` mientras el modal esté abierto, para que las Ever-flags / maduración se actualicen en vivo (mismo patrón que el `useTracking` existente).

3. **`components/TrackingPanel.tsx` *(NUEVO)*** — render del panel, con tres estados:
   - **loading** (solo primer fetch) → "Cargando tracking…".
   - **`tracked === null`** → estado informativo "Aún no monitoreado — entra a tracking al superar +50% en 24h" (el token está en el scanner pero no cruzó el gate).
   - **`tracked`** → panel completo: badge de status (mismos colores que la Watchlist), badge de maduración (`🎯 MADURO` + `maturedAt`, o "aún no maduro"), **checklist de las 4 Ever-flags** (✅/⬜ + "hace X" por flag, contador X/4), grid con En-monitoreo (`activeMs`) / Detectado (`firstDetectedAt`) / Pico (`peakPrice`) / % del pico (`currentPrice/peakPrice`, rojo si ≥80% — el umbral que dispara maduración), y stats de persistencia (`daysActive` / `scansActive` / `reappearances`).

4. **`components/TokenDetailModal.tsx` + `pages/Scanner.tsx`** — `Scanner` invoca `useTrackedBySymbol(selected?.snapshot.symbol ?? null)` y pasa `tracking` + `trackingLoading` al modal, que reemplaza el placeholder de 07.1 por `<TrackingPanel>`.

## Archivos tocados (07.2)

| Archivo | Cambio |
|---|---|
| `apps/web/src/lib/format.ts` | + `fmtAgo(iso)` y `fmtActiveTime(ms)`. |
| `apps/web/src/hooks/useTrackedBySymbol.ts` *(NUEVO)* | Lookup por símbolo vía filtro client-side; gateado por símbolo; refresca en `scan:update`. |
| `apps/web/src/components/TrackingPanel.tsx` *(NUEVO)* | Render del tracking real: status, maduración, checklist 4 Ever-flags, monitoreo/pico, stats. Estados loading / no-trackeado. |
| `apps/web/src/components/TokenDetailModal.tsx` | Props `tracking` + `trackingLoading`; placeholder reemplazado por `<TrackingPanel>`. |
| `apps/web/src/pages/Scanner.tsx` | Invoca `useTrackedBySymbol` y cablea el resultado al modal. |

## Cómo probarlo (07.2)

```bash
pnpm dev      # api :3000 + web :5173
```

`pnpm --filter @short-scanner/web typecheck` y `lint` deben quedar en 0 (sin tests automatizados — UI pura, validación visual).

1. **Token trackeado** (cualquiera con tracking activo, ej. uno >50% 24h): la sección Tracking muestra status, X/4 condiciones con "hace X" por flag, monitoreo, pico + % del pico, y stats.
2. **Token NO trackeado** (ej. uno con cambio bajo que no cruzó el gate): muestra "Aún no monitoreado".
3. **Refresh en vivo**: dejar el modal abierto y esperar un scan — si una Ever-flag se prende o cambia `activeMs`/`% del pico`, debe reflejarse sin reabrir.

*(Validado el 2026-05-29: HEI +203% → ACTIVE, 1/4 (RSI hace 14h), monitoreo 25min, pico $0.1784 al 96%, 2d/18scans/0reaperturas. XAN +11.98% → "Aún no monitoreado".)*

## Decisiones de diseño (07.2)

1. **Filtro client-side (Opción A) en vez de endpoint dedicado.** Ver sección "Decisión" arriba. La clave: el contrato del hook (`TrackedTokenView | null`) no cambia si más adelante se migra a un endpoint `by-symbol`, así que la elección no se cementa.

2. **Incluir SHORTED/CLOSED en el lookup.** Un token que el user ya shorteó sigue siendo interesante de inspeccionar desde el scanner. Limitar a ACTIVE/DORMANT escondería su tracking justo cuando hay una posición abierta. ARCHIVED se omite (ruido histórico).

3. **El hook no hace fetch si no hay modal abierto.** `symbol === null` corta el fetch de raíz. Evita traer la lista de tracking en cada scan cuando nadie abrió el detalle — a diferencia del `useTracking` de la Watchlist, que sí necesita el polling continuo porque la tabla está siempre visible.

4. **`% del pico` en rojo a partir de 80%.** Es exactamente el umbral que el verdict maduro usa para considerar que el precio "se sostiene cerca del pico" (regla `currentPrice >= peakPrice * 0.80`). Pintarlo en rojo da una señal visual directa de "este token está en zona de maduración".

5. **Reusar los colores de status de la Watchlist** (`STATUS_CLS`). El mismo mapa ACTIVE→verde / DORMANT→ámbar / SHORTED→rojo que `TrackedTokenRow`, para que el operador no aprenda dos lenguajes de color. Se replica el objeto (no se extrae a un módulo compartido todavía) para no acoplar el modal a la tabla por una refactor prematura.

6. **`fmtAgo`/`fmtActiveTime` reimplementados en web, no compartidos con el backend.** El `telegram.service` tiene equivalentes (`fmtAgo`, `fmtActiveTime`) pero viven en el API y formatean para el mensaje de Telegram. Duplicar dos funciones triviales de formateo es más barato que crear una dependencia web→api o moverlas a `shared-types` (que es solo tipos, sin runtime). Si en el futuro hay un tercer consumidor, se evalúa centralizar.

---

# 07.3 — Gráfico de velas (7 días · 4H)

## Qué resuelve

07.1 dejó la sección "Precio (últimos 7 días)" como placeholder. 07.3 la conecta a un **gráfico de velas (candlestick)** real con OHLC de los últimos 7 días en velas de 4H. Cierra el detalle del token que existía en el v22 — donde Kervin miraba el histórico antes de entrar — y completa el **Backlog A**.

Se eligió candlestick sobre línea: para trading es más útil (cuerpo, mechas, OHLC por vela) y más profesional que una línea de cierres.

## Decisión: klines vía proxy server-side (Opción A)

El gráfico necesita klines históricos. Dos fuentes posibles:

- **A (elegida)** — endpoint `GET /api/scans/klines` que reusa `BinanceService.fetchKlines` (server-side).
- **B (descartada)** — `fetch` directo del browser a `fapi.binance.com`, como hacía el v22.

Se eligió **A**. El rewrite a NestJS centralizó **a propósito** todo el acceso a Binance en `BinanceService` (retry con backoff, manejo de geo-block 451, timeout). Volver al browser-directo reintroduce exactamente el riesgo que el server ya resuelve — y es material: Kervin opera desde **Colombia**, donde el geo-block 451 de Binance aparece. Los ~10 líneas de backend compran esa robustez. Costo: 07.3 **no es frontend puro** (toca `scans.controller` + un tipo en `shared-types`), a diferencia de 07.1/07.2.

**Aclaración sobre la "opción a/b" del plan original**: para un *gráfico de precio* la fuente correcta son los **klines de Binance** (OHLC continuo), no la idea descartada de una tabla `tracked_token_snapshots` (que daría puntos dispersos del scan, no velas). El histórico se reconstruye al vuelo desde Binance en cada apertura del modal.

**Intervalo/cantidad**: 4h × 42 velas (≈7 días). Mismo interval que usa el scoring; payload chico.

## Qué cambia

1. **Dependencia** — `lightweight-charts@5` en `apps/web`. La API v5 usa `chart.addSeries(CandlestickSeries, opts)`.

2. **Tipo compartido `KlineView`** (`packages/shared-types/src/market.ts`): `{ time, open, high, low, close }`, con `time` en **segundos UTC** (formato `UTCTimestamp` de lightweight-charts). El API convierte ms→s al mapear.

3. **Endpoint `GET /api/scans/klines?symbol=&interval=&limit=`** en `scans.controller.ts`. Reusa `BinanceService.fetchKlines`, mapea `Kline[]` → `KlineView[]` (ms→s). Si Binance devuelve null (error/geo-block) → `503 ServiceUnavailable`. Authed por el guard global (mismo que el resto de `/scans`). Query validado con `KlinesQueryDto` (symbol `^[A-Z0-9]+USDT$`, interval ∈ {1h,4h,1d}, limit 1–500).

4. **`api.getKlines` + `useKlines(symbol, interval, limit)`** — hook gateado por símbolo (no fetch si el modal está cerrado), **fetch on-open únicamente** (un chart de 7d no necesita refrescar cada scan), con guard `cancelled` para descartar respuestas de un símbolo anterior si el usuario cambia de token mientras el request está en vuelo.

5. **`PriceChart.tsx`** — render del candlestick con theming del modal (colores de `tailwind.config.js`), `autoSize` (ResizeObserver interno de la lib), y cleanup `chart.remove()` en unmount. Es el componente "pesado": se carga **lazy**.

6. **`ChartSection.tsx`** — wrapper que `lazy()`-importa `PriceChart` (la lib ~45kb gzip solo entra al bundle al abrir el modal) y maneja los estados loading / error / sin-datos. Monta el chart con **`key={symbol}`** para que cada token remonte limpio.

7. **`TokenDetailModal` + `Scanner`** — cablean `klines`/`klinesLoading`/`klinesError` y reemplazan el placeholder por `<ChartSection>`.

## Archivos tocados (07.3)

| Archivo | Cambio |
|---|---|
| `apps/web/package.json` | + `lightweight-charts@^5.2.0`. |
| `packages/shared-types/src/market.ts` *(NUEVO)* | Tipo `KlineView` (time en segundos UTC). |
| `packages/shared-types/src/index.ts` | Export de `./market`. |
| `apps/api/src/modules/scanner/dto/klines-query.dto.ts` *(NUEVO)* | Validación de symbol/interval/limit. |
| `apps/api/src/modules/scanner/scans.controller.ts` | Endpoint `GET /scans/klines`; inyecta `BinanceService`; mapea ms→s; 503 si Binance falla. |
| `apps/web/src/lib/api.ts` | + `api.getKlines(symbol, interval, limit)`. |
| `apps/web/src/hooks/useKlines.ts` *(NUEVO)* | Fetch on-open gateado por símbolo, guard `cancelled`. |
| `apps/web/src/components/PriceChart.tsx` *(NUEVO)* | Candlestick v5, theme, autoSize, cleanup. |
| `apps/web/src/components/ChartSection.tsx` *(NUEVO)* | Lazy-load + estados loading/error/vacío, `key={symbol}`. |
| `apps/web/src/components/TokenDetailModal.tsx` | Props `klines`/`klinesLoading`/`klinesError`; placeholder → `<ChartSection>`. |
| `apps/web/src/pages/Scanner.tsx` | Invoca `useKlines` y cablea al modal. |

## Cómo probarlo (07.3)

```bash
pnpm dev      # api :3000 + web :5173
```

`pnpm --filter @short-scanner/shared-types build` primero (lo consumen API y web). Después `typecheck` + `lint` de web y `build` de api deben quedar en 0. Smoke del endpoint sin auth → `401` (cableado + guard), no `404`.

1. **Gráfico**: click en un token → ~42 velas candlestick (verde sube / rojo baja, cuerpos + mechas), ejes de tiempo y precio.
2. **Sin leaks**: abrir/cerrar varios tokens seguidos → cada uno muestra su propio chart; el `key={symbol}` + `chart.remove()` garantizan remonte limpio.
3. **Estados**: símbolo sin klines → "Sin datos"; Binance caído → mensaje de error en vez del gráfico.

*(Validado visualmente el 2026-05-29.)*

## Decisiones de diseño (07.3)

1. **Proxy server-side (Opción A) por el geo-block colombiano.** Ver sección "Decisión" arriba. No es solo consistencia arquitectónica: es el riesgo real de 451 desde la IP del operador, que el server ya mitiga.

2. **Endpoint colgado de `/scans`, no un módulo `market` nuevo.** El klines proxy es conceptualmente parte del scanner (mismo `BinanceService`, mismo dominio). Un módulo nuevo sería sobre-ingeniería para un endpoint. Queda authed por el guard global sin config extra.

3. **`KlineView.time` en segundos, convertido en el API.** lightweight-charts espera `UTCTimestamp` en segundos; Binance devuelve ms. Convertir en el server deja al cliente sin transformaciones y al tipo compartido con un contrato claro ("segundos UTC").

4. **Fetch on-open, sin refresh por scan.** Un chart de 7 días en velas de 4H no cambia de forma relevante cada 2 min (la vela en curso se mueve, pero no justifica refetch). Mantener el hook simple (sin listener de `scan:update`) evita repintados y requests innecesarios. Si se quisiera la vela viva, sería una mejora futura acotada.

5. **Lazy-load de `lightweight-charts`.** La lib pesa ~45kb gzip. Cargarla con `React.lazy` detrás del modal evita inflar el bundle inicial del scanner — solo paga ese costo quien abre un detalle.

6. **`key={symbol}` en vez de actualizar el chart in-place entre tokens.** Remontar el componente por símbolo es más simple y robusto que diff-ear series entre tokens, y garantiza que el `chart.remove()` del cleanup corra en cada cambio — la defensa directa contra leaks de instancias de chart (lo que Kervin pidió verificar).

## Cierre del Backlog A

Las tres sub-fases (07.1 modal + grades, 07.2 tracking real, 07.3 gráfico de velas) **completan el Backlog A**: el detalle de activo al click que existía en el v22 y no se había migrado a la web NestJS. La web deja de ser regresiva respecto al monolito original en este punto.

## Impacto en deploy

- **07.1 y 07.2**: frontend puro. Sin migración, sin deps, sin cambios de API.
- **07.3**: **toca el API** (endpoint `GET /scans/klines` + tipo `KlineView` en `shared-types` + dep `lightweight-charts` en web). **No requiere migración** (no toca schema) ni variables de entorno.

### Orden de deploy (07.3)

1. `git pull`.
2. `pnpm install` (trae `lightweight-charts`).
3. `pnpm --filter @short-scanner/shared-types build` (el API y la web consumen `KlineView`).
4. Rebuild/restart del API (para exponer `/scans/klines`) y de la web.

Sin orden estricto entre API y web más allá de que `shared-types` se compile antes que ambos. El endpoint es aditivo — no rompe clientes viejos.
