# 07 — Modal de detalle del token (Backlog A)

> **Fase multi-sub-fase.** Este documento cubre **07.1 — modal base + panel de condiciones**. Las sub-fases siguientes conectan datos reales en los placeholders que 07.1 deja montados:
> - **07.1** *(esta entrega)* — modal, header, panel de las 7 condiciones, placeholders de tracking y chart.
> - **07.2** *(siguiente)* — sección **Tracking** con datos reales de `tracked_tokens` (Ever-flags, activeMs, peak price, maduración).
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

## Impacto en deploy

**Frontend puro.** No requiere migración, ni variables de entorno, ni dependencias nuevas, ni cambios en `shared-types` ni en el API. Es un cambio de build de `apps/web` y nada más. Sin orden de deploy especial.

## Pendiente (sub-fases siguientes)

- **07.2 — Tracking real.** Conectar la sección Tracking a `tracked_tokens`: mostrar las 4 Ever-flags con su timestamp, `activeMs` en monitoreo, peak price y ratio actual, y el estado de maduración (`maturedVerdict`). Requiere endpoint que cruce el símbolo del modal con su fila de tracking (probablemente reusar `GET /api/tracking/:id` o filtrar por símbolo).
- **07.3 — Gráfico de precio (7 días).** El histórico multi-día **no está disponible** en la API hoy: `TrackedToken` solo guarda peaks + current, no snapshots intermedios. Opciones (a decidir en 07.3): (a) tabla nueva `tracked_token_snapshots` (cambio de schema), o (b) reconstruir al vuelo desde Binance por click como hacía el v22 (sin schema, más latencia).
