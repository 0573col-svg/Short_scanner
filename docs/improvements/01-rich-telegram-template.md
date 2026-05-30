# 01 — Plantilla rica para alertas de Telegram

## Problema que resuelve

La plantilla actual de los mensajes de Telegram (`telegram.service.ts:formatAlert`) era muy delgada: solo mostraba verdict, base, score, cambio 24h, RSI y timestamp. Cuando llega una alerta el operador no tiene contexto suficiente para decidir si entrar o no — falta funding, divergencia, velas rojas, BTC, volumen y modo activo. Tampoco había noción de cuánto falta para el cierre de la vela 4H, que es información operativa clave para timing.

El backend **ya calcula todos esos datos** en cada scan (`scoring.service.ts` + `indicators.service.ts`), pero el tipo `ScanAlert` los descartaba en `toAlert()`. Esta fase amplía el contrato para que el formatter pueda usarlos.

La plantilla nueva está basada en el formato del scanner v22 (el HTML monolito original `short-scanner-v22.html` que precede a la migración NestJS). Esta fase **restaura** el detalle operativo que se simplificó al portar la app a Nest, ahora sobre la infraestructura nueva.

## Antes vs Después

**Antes** (formato actual en `main`):

```
🟡 CERCA TEST/USDT

Score 65  ·  24h +12.50%  ·  RSI 78
Sun, 25 May 2026 16:30:00 GMT
```

**Después** (esta fase):

```
🔵 CERCA — TEST
⚙️ Modo: Flexible

💰 Precio: $0.1234
📊 24h: +12.50%
📊 Score: 65/100

✅ Funding: +5.000%
✅ RSI 4h: 78
⬜ Divergencia: no
✅ Velas rojas: 2 (cerradas)
📊 BTC: +1.21%
✅ Volumen: 12.5M

⏰ Cierre vela 4H en: 1h 25min
```

## Qué cambia

Cada alerta enviada a Telegram ahora tiene esta forma:

```
🔵 CERCA — TEST
⚙️ Modo: Flexible

💰 Precio: $0.1234
📊 24h: +12.50%
📊 Score: 65/100

✅ Funding: +5.000%
✅ RSI 4h: 78
⬜ Divergencia: no
✅ Velas rojas: 2 (cerradas)
📊 BTC: +1.21%
✅ Volumen: 12.5M

⏰ Cierre vela 4H en: 1h 25min
```

- **Header:** `🔵` para CERCA (aviso preliminar), `🔴` para GO SHORT (señal lista para operar). El base va sin sufijo `/USDT` (es implícito en este scanner).
- **Modo:** `⚙️ Modo: Flexible` o `⚙️ Modo: Strict` — icono fijo (engranaje, neutral); el color queda reservado para el verdict.
- **Bloque informativo:** precio, cambio 24h y score.
- **Bloque de indicadores:** cada uno con `✅` (passed) o `⬜` (not passed) según el grade calculado por `scoring.service.ts`. Excepción: **BTC va sin checkbox**, solo como dato (porque "BTC subiendo" es malo para shorts, así que el sentido del check sería confuso — decisión consciente, ver "Decisiones de diseño").
- **Cierre vela 4H:** minutos hasta el próximo cierre alineado a `00,04,08,12,16,20 UTC`. Formato `Xmin` si <60, `Xh Ymin` si ≥60.

Lo que **no** cambia: la rama del Telegram envío (sigue siendo `TelegramService.send` con `parse_mode=HTML`), el dedup por 4h-block, los filtros del processor (`nearAlertsEnabled` sigue gating CERCA vs GO_SHORT).

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `packages/shared-types/src/scoring.ts` | `ScanAlert` extendido con `mode`, `price`, `vol`, `fundingRate`, `redCount`, `btcChange`, `passed: {funding, rsi, divergence, redCandles, liquidity}`. |
| `apps/api/src/modules/scanner/scanner.state.ts` | `applyUserResults()` toma 2 args nuevos `mode + btcChange` y los inyecta a `toAlert()`. `toAlert()` ahora población de los campos nuevos. |
| `apps/api/src/modules/scanner/scanner.service.ts` | Los 2 call-sites de `applyUserResults` pasan `user.mode` y `btc.change`. |
| `apps/api/src/modules/telegram/telegram.service.ts` | `formatAlert()` reescrito según la plantilla. Helpers privados: `esc`, `checkbox`, `fmtSignedPct`, `fmtFunding`, `fmtRsi`, `fmtPrice`, `fmtVol`, `fmtMinutes`. |
| `apps/api/src/modules/scanner/scanner.state.spec.ts` | Helper `scoredToken()` ahora pobla `grades` con stubs reales (antes era `{} as never`). Los 8 call-sites de `applyUserResults` pasan los nuevos args. |
| `apps/api/src/health/health.controller.spec.ts` | Los 2 call-sites de `applyUserResults` pasan los nuevos args. |

## Cómo probarlo

### Setup (si el local no está corriendo)

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm install
pnpm --filter=@short-scanner/api migration:run
pnpm dev
```

### Validar que typecheck y tests pasan

```bash
pnpm typecheck
pnpm --filter=@short-scanner/api test
```

### Validar el formato visualmente

1. Hacer signup + configurar Telegram (`PUT /api/me/telegram` con bot token + chat ID propio).
2. Disparar `POST /api/me/telegram/test` → llega el mensaje de prueba (no usa la plantilla rica, usa un texto fijo). Sirve para validar que el chat está bien.
3. Para ver la plantilla rica en acción sin esperar señal de mercado, inyectar un job mock en la queue `alerts`:

```bash
# desde apps/api/ (donde está node_modules con bullmq):
cat > /tmp/inject.cjs << 'EOF'
const { Queue } = require('bullmq');
const q = new Queue('alerts', { connection: { host: 'localhost', port: 6380 } });
q.add('telegram', {
  userId: '<TU-USER-ID>',
  alert: {
    symbol: 'TESTUSDT', base: 'TEST', verdict: 'CERCA',
    score: 65, change: 12.5, rsi: 78, ts: Date.now(),
    mode: 'FLEX', price: 0.1234, vol: 12_500_000,
    fundingRate: 0.05, redCount: 2, btcChange: 1.21,
    passed: { funding: true, rsi: true, divergence: false, redCandles: true, liquidity: true },
  },
}).then(() => q.close());
EOF
NODE_PATH=apps/api/node_modules node /tmp/inject.cjs && rm /tmp/inject.cjs
```

El mensaje debe llegar al chat configurado con el formato de arriba.

### Validar con una alerta real

Esperar al ciclo automático de scan (cada 2min) hasta que el mercado produzca un CERCA o GO_SHORT. Los logs del scanner muestran `... · N new alerts` — cuando `N > 0`, una alerta se despachó y debería llegar con la plantilla rica.

## Impacto en deploy

Esta fase **no requiere**:

- Migraciones de BD (todo el cambio vive en memoria + en el shape de un tipo TypeScript).
- Variables de entorno nuevas (sin secrets ni toggles nuevos).
- Dependencias nuevas (no se agregó nada al `package.json`).

Solo necesita: `git pull` + reiniciar el servicio (`pnpm dev` en local, o el equivalente del deploy en prod). El primer mensaje que se despache después del restart ya usa el formato nuevo.

## Troubleshooting post-deploy

**Si después del deploy llega una alerta con el formato viejo:**
El proceso de Node anterior probablemente sigue corriendo en memoria con el código viejo. Asegurate de que el servicio se haya reiniciado realmente (kill + start, no solo `pnpm install`). Verificá los logs de boot: tiene que aparecer un `Nest application successfully started` posterior al deploy. Si usás PM2 o systemd, mirá el timestamp del proceso actual (`pm2 list` o `systemctl status`).

**Si llega malformada** (entidades HTML visibles como `&lt;` o `&amp;` en el texto, o un mensaje sin negrita/cursiva):
Telegram no parseó el `parse_mode=HTML`. Revisar logs de `TelegramService` buscando `telegram send failed (status=400): can't parse entities…`. La causa típica es algún campo nuevo que contiene `<`, `>` o `&` sin escapar. El helper `esc()` en `telegram.service.ts` escapa solo `alert.base` — si en el futuro se agregan campos derivados de input externo (ej. nombre de exchange, nota del usuario), hay que pasarlos por `esc()` también.

## Decisiones de diseño

1. **BTC sin checkbox.** El template del usuario en su forma original mostraba `BTC: +X%` sin marca de pass/fail. La razón: "BTC subiendo" es la condición que **bloquea** un short (gradeBtcOk pasa solo si BTC `>=0`, lo cual es contra-intuitivo para un trader que está mirando shorts). Mostrar `✅` cuando BTC sube confundiría al lector. Decisión: solo informativo, con icono neutro `📊`.

2. **Modo en línea aparte, no en el header.** `⚙️ Modo: Flexible/Strict` va debajo del header en su propia línea. Esto deja el header limpio con verdict + symbol (la info más crítica para scanear el mensaje rápido) y reserva el modo como contexto secundario.

3. **Sin `/USDT` en el header.** El scanner solo opera pares USDT, mostrar el sufijo es ruido. Header más limpio.

4. **`🔵` para CERCA, `🔴` para GO SHORT.** El color del header refleja el nivel de urgencia del verdict, no el modo del usuario. Azul = aviso preliminar (mirar, no operar todavía); rojo = setup completo (listo para operar). El modo (Strict/Flex) lleva un icono neutro `⚙️` aparte para no competir por la atención visual con el verdict.

5. **Cierre vela 4H calculado inline en `formatAlert`.** Es una función pura de `Date.now()` — no necesita plumbear klines ni timezone. Las velas 4H de Binance cierran a `00,04,08,12,16,20 UTC`, igual en todo el mundo. La misma fórmula ya está en uso en `scanner.state.ts:block4h()` y `alert-dispatcher.service.ts`.

6. **Funding con 3 decimales.** Funding rates típicos son del orden de `0.01%` a `0.1%` (decimal 0.0001 a 0.001). Con 2 decimales se perdían distinciones útiles (`0.05%` vs `0.07%`). Con 3 se ve bien (`+0.050%` vs `+0.070%`).

7. **Precio adaptativo según magnitud.** Cripto rangos amplísimos: BTC vale ~$60k, memecoins ~$0.000001. Lógica: `≥1` → 4 decimales, `<0.001` → notación científica, intermedio → 6 decimales. Suficiente para ver cambios relevantes en cualquier escala.

8. **Volumen abreviado (M/K/B).** Volúmenes 24h son siempre >1M USD (por el `minVolUsd` default), así que el formato `12.5M` es siempre legible y compacto. Sin abreviación serían números de 8 dígitos que ensucian el mensaje.

9. **Test fixture `scoredToken()`: grades reales.** El helper de testing tenía `grades: {} as never` porque el `toAlert` viejo no los leía. Con el nuevo `toAlert` accediendo a `r.grades.X.passed`, los tests crasheaban en runtime. Los pobré con stubs `{ points: 10, state: 'ok', passed: true }` para todos los indicadores — los tests siguen probando lo mismo (dedup), solo que ahora el fixture es type-safe end-to-end.

## No bloquea Fases siguientes

Esta fase **no toca persistencia** (los alertas siguen siendo in-memory en `ScannerStateStore`) ni agrega query histórica. Sirve como base para [02-alerts-persistence](./02-alerts-persistence.md) y [03-others-today](./03-others-today.md), pero es funcionalmente completa por sí sola.

## Impacto en el frontend

**Ninguno.** El web (`useScanStream.ts`, `AlertLog.tsx`) consume `ScanAlert` por structural typing y solo lee los campos viejos (`verdict, base, score, change, rsi, ts`). Los campos nuevos se ignoran sin warning ni error. Se podría enriquecer la UI en una mejora futura, pero no es bloqueante.
