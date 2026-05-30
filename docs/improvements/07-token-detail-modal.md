# 07 — Modal de detalle del token (Backlog A)

> **Fase multi-sub-fase.** Este documento cubre el modal de detalle del token, entregado en sub-fases que van rellenando los placeholders:
> - **07.1** *(hecho)* — modal, header, panel de las 7 condiciones, placeholders de tracking y chart.
> - **07.2** *(hecho)* — sección **Tracking** con datos reales de `tracked_tokens` (Ever-flags, activeMs, peak price, maduración).
> - **07.3** *(pendiente)* — **Gráfico de precio** (últimos 7 días).

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

## Impacto en deploy

**Frontend puro.** No requiere migración, ni variables de entorno, ni dependencias nuevas, ni cambios en `shared-types` ni en el API. Es un cambio de build de `apps/web` y nada más. Sin orden de deploy especial.

## Pendiente (sub-fases siguientes)

- **07.3 — Gráfico de precio (7 días).** El histórico multi-día **no está disponible** en la API hoy: `TrackedToken` solo guarda peaks + current, no snapshots intermedios. Opciones (a decidir en 07.3): (a) tabla nueva `tracked_token_snapshots` (cambio de schema), o (b) reconstruir al vuelo desde Binance por click como hacía el v22 (sin schema, más latencia). Render con `lightweight-charts`.
