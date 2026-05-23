# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This repo is a **single self-contained HTML file**: `short-scanner-v22.html`. There is no build system, no package manager, no test suite, no backend. All HTML, CSS, and JavaScript live in that one file. The version is in the filename — a new version is a new file (e.g. `short-scanner-v23.html`), not a tag.

## Running it

Open the file directly in a browser:

```sh
open short-scanner-v22.html
```

No server needed — the page calls the public Binance REST APIs from the browser (CORS is allowed by Binance on these endpoints). `localStorage` is the only persistence layer; nothing is written to disk.

There is no lint, build, or test command. "Testing" means opening the page, clicking **Iniciar** in the Scanner tab, and watching the table populate over a 2-minute scan cycle.

## Architecture

### What the app does
Scans Binance for altcoins that are pumping and scores them as short-trade candidates. Runs entirely client-side on a 2-minute loop, surfacing alerts in-page and (optionally) via Telegram.

### Data flow (one scan cycle)
1. `fetchNow()` (line ~1170) is the entry point — called by the countdown timer and the "Actualizar" button. It is guarded by `isFetching` and `MIN_FETCH_INTERVAL_MS` to prevent concurrent / rapid-fire scans.
2. Pulls 24h ticker for **all USDT pairs** from `api.binance.com/api/v3/ticker/24hr`, drops stablecoins (see `STABLE` set, line 707) and low-volume pairs, takes top-N gainers.
3. For each survivor, in batches via `batchedMap` (line ~1156), fetches **4H klines** (`/api/v3/klines`) and **funding rate** (`fapi.binance.com/fapi/v1/premiumIndex`) in parallel.
4. Computes per-token signals: RSI, RSI series, bearish divergence over last ~25 candles, last-N candle colors, red-candle streak.
5. `calcScore()` (line ~1112) grades each of **7 conditions** (`pump, funding, rsi, divergence, redCandles, btcOk, liquidity`) into a 0–100 weighted score. Grades are **proportional to threshold proximity**, not binary.
6. `getVerdict()` (line ~1135) turns the grades into a label: `GO SHORT` / `CERCA` / `VIGILAR` / `BTC ↓` / `—`. Logic branches on `mode` (`strict` vs `flex`).
7. `renderTable()` paints the result; new `GO SHORT` rows flash and fire `sendShortAlert()` → Telegram.

### State (all module-level globals near line 764)
- `running`, `cntdwn`, `cntdwnTimer` — scan loop state.
- `allData` — last scan result; the table re-renders from this.
- `mode` — `'strict'` or `'flex'`; changes RSI threshold (80 vs 75) and the verdict logic.
- `btcTrend` — populated each scan; if BTC is falling >2%, alts get penalized.
- `WEIGHTS` (line 782) — per-condition point weights. **Mutated by the learning system** (see below).
- `trades` — array of user-recorded trades.
- `alertedSet`, `alertFirstSeen` — dedupe so we don't re-alert the same token within a session.

### Persistence (`localStorage`)
All keys are prefixed `sscanner_` and versioned. Constants at lines 773–778:
- `LS_TRADES` (`sscanner_trades_v8`) — recorded trades.
- `LS_WEIGHTS` (`sscanner_weights_v8`) — learned weights.
- `LS_MODE`, `LS_TG_TOKEN`, `LS_TG_CHATID`, `LS_TG_NEAR` — UI/config.
- `LS_LEGACY` (`['v7','v6','v5','v4']`) — migrated-from suffixes. **When bumping the storage schema, add the old suffix to `LS_LEGACY` and bump the live constants to the next `vN`** so users don't lose history.

### The learning loop
This is the non-obvious part of the app. `recalculateWeights()` (line ~1740) is called after each closed trade. After ≥3 closed trades it rebalances `WEIGHTS` based on the **win rate of each condition** across the user's own history — so the score formula drifts toward whichever signals actually predicted the user's wins. Any change to grading / scoring logic must keep the `grades[k].passed` boolean meaningful, because that's what feeds the learning system.

### Modes (strict vs flex)
Defined in `getVerdict()`. Both modes share the same grading but differ in:
- **RSI threshold**: 80 strict / 75 flex (in `calcScore`).
- **Verdict rules**: flex accepts `halfPump + techConfluence` as a valid GO SHORT, strict requires the full pump threshold.

If you touch verdict logic, change both branches consciously — they are deliberately not unified.

### Telegram integration
`sendTelegramMessage()` (line ~2035) posts to `api.telegram.org/bot<token>/sendMessage`. Credentials are user-supplied in the Info tab and stored only in `localStorage`. `sendShortAlert()` is fired from `renderTable` when a row transitions into `GO SHORT`. There is also a "near" alert toggle (`LS_TG_NEAR`).

### UI
Three tabs, switched by `switchTab()` (line ~1927):
- **Scanner** — toolbar (thresholds, mode toggle), stats grid, alert log, results table with expandable per-token detail (8d history via `historyCache`).
- **Aprendizaje** — trade list, learned weights table, learning stats.
- **Info y Glosario** — definitions and Telegram config.

The table rows have CSS classes `row-go`, `row-near`, `row-watch` matched to verdict — keep those in sync if verdict labels change.

## Editing conventions specific to this codebase

- **One file, no modules.** Functions are global; mutating module-level state is the norm. Don't refactor into modules without a reason — there is no bundler.
- **The UI is in Spanish.** All visible strings (labels, log messages, verdicts, glossary) are Spanish. Code identifiers are English. Keep that split.
- **Binance API calls go through `fetchWithTimeout`.** Don't call `fetch` directly for external requests — the timeout wrapper is what keeps a hung pair from stalling a whole scan batch.
- **Grading functions return `{ points, state, passed }`.** All `grade*` functions share that shape; the learning system depends on `passed`. New conditions must follow it.
- **Thresholds are proportional, not binary.** When adding a condition, award partial points as the value approaches the threshold (see `gradePump`, `gradeRSI` for the pattern). Don't return 0 or full max only.
- **Versioning by filename.** If you make a breaking change, save as `short-scanner-v23.html` rather than overwriting v22, and bump `LS_*` storage keys + extend `LS_LEGACY`.
