# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Performance

- Open the app, expand **Dev ▸** and toggle **Perf HUD** for live FPS, flush time, tick→paint latency, commits per section and network counters. The dev bar changes trade rate, backend batch interval, latency and drop rate, or forces a reconnect. A **Trades** full/compact toggle switches the server's trade aggregation (`full` ships every trade, `compact` collapses trades within a batch; the server default is `compact`). The HUD shows market trades/s, shipped trade items/s and KB/s received.
- Scripted benchmark (dev server or profiling build only; the normal production build ignores `?bench=`): `pnpm build:profile && pnpm preview` (the profiling build keeps `<Profiler>` timings in production), then open `http://localhost:4173/?bench=<mode>` in a **visible** tab — rAF is throttled in hidden tabs.
  - **Tracked set** — `?bench=realistic` and `?bench=soak`. Both run at the server defaults (`compact` aggregation, 100 ms batches) and reset the market from a fixed seed at phase start (sent once the client is `live`; each result reports `seed` and `seedApplied`), so every run replays the same deterministic arrivals/sizes. In probe phases the probe's own orders and quote timing are still wall-clock, so fills are not bit-identical across runs.
    - `?bench=realistic`: 30 phases, ≈11 min. **load**: steady 30/s and 300/s (12 s windows), burst 1,000/s (30 s window); **stress**: 5,000/s, a single limit run (12 s); **faults** at 100/s: 3 disconnects, and 10% drop + 200 ms latency (12 s each, recovery time p50/max reported); **slippage**: order probe $5 every 300 ms with 250 ms quote age, 1/3/5/10¢ tolerance × 30/100/300 trades/s × 0 or 150 ms injected one-way latency (`set_latency`), 20 s windows (24 phases).
    - Seeds: steady 30/s `30001`, steady 300/s `300001`, burst `1000001`, stress `5000001`, disconnects `100001`, drop + latency `100002`; slippage phases share one seed per rate (30/s `30101`, 100/s `100101`, 300/s `300101`) so every tolerance and latency at a rate sees the same trades.
    - `?bench=soak`: 30 min at 30 trades/s (seed `30303`), sampled every 60 s: heap MB (`performance.memory`, Chromium only — `n/a` elsewhere), frame p95, % frames over budget, LoAF per minute and gaps/resyncs/duplicates/reconnects per interval. The result adds heap growth in MB and % (last sample vs the first, so warm-up allocations are excluded), the worst frame p95 and LoAF/min, and counter totals.
  - **Historical** (reproduce the published v2 numbers; not tracked): `?bench=quick`: 34 phases × 4 s, ≈3 min. `?bench=matrix`: 34 phases × 12 s, ≈9 min. `?bench=deep`: slippage phases × 20 s + batch phases × 15 s at higher probe frequency, ≈16 min. `?bench=scale`: 13 phases × 12 s (1k–10k trades/s × full/compact aggregation at 100 ms; batch 4/8/16/33 ms compact and 16 ms full at 5k/s; the 100 ms batch points are the 5k/s load phases), ≈3.5 min.
    - quick/matrix/deep run with `full` aggregation on the live (unseeded) market, as the published numbers were measured; `scale` compares `full` and `compact`.
    - Phases: **load** (5–1000 trades/s at 100 ms batches), **batch** (16–250 ms at 100 and 500 trades/s), **slippage** (order probe: $5 every second, 1/3/5/10¢ tolerance, quote age 0 or 1000 ms, at 100 and 500 trades/s) and **faults** (3 disconnects; 10% drop + 200 ms latency).
  - Probe phases reset the mock balance to $1000 through the dev-only `set_balance` command, so every probe phase starts from the same cash. The run ends (or is cancelled) with the server back at the default rate/batch/latency/drop/aggregation.
- Results: the bottom-right panel (`[data-testid=bench-result]`) and the console (`[bench]` + JSON: an array of phase results, or one soak result object). While running, `<html data-bench-phase="…">` names the current phase (`warmup:<name>` before a window, `settle` after it, `done` at the end); the soak marks its single 30 min window the same way.
- **Method** (what makes two runs comparable):
  - Fixed seeds per phase (above), a warm-up before every measured window (dropped from all numbers) and a **visible, foreground** tab — background tabs throttle rAF and timers.
  - Frame budget is 60 Hz (16.7 ms); a frame counts as missed above 1.5 × vsync (`FRAME_MISS_THRESHOLD_MS`, ~25 ms), so normal jitter around one vsync is not a miss. Results report frame p50/p95/p99 and % of frames over that threshold; FPS is metadata only.
  - `RUNS` repeats (default 5, fresh navigation each); every key metric is reported as mean ± 95% confidence interval (t-distribution, n − 1 df) across runs. One run is an anecdote, not a number.
  - Mid-tier device: real Chrome DevTools → Performance → CPU throttling with the **calibrated** mid-tier preset (or a real Android device over remote debugging). CDP throttling from Playwright is not trusted (caveat below). Record what you used in the URL as `&cpu=<label>` (metadata only).
- **How to run**: `pnpm build:profile && pnpm preview` (port 4173), then run `scripts/bench-cdp.js` — a Playwright `async (page) => {...}` function, e.g. Playwright MCP `browser_run_code_unsafe` with `filename: "scripts/bench-cdp.js"`. Constants at its top: `BENCH_URL` (default `?bench=realistic`; `?bench=soak` or a historical mode), `RUNS` (5), `CPU_THROTTLE` (1 = none) and `KEEP_RAW` (include the full bench JSON per run). Each run samples CDP `Performance.getMetrics` every 500 ms keyed by `data-bench-phase` (main-thread busy %, script/layout/style ms per second, heap) and clicks the trade ticket inside measured windows — side toggle + amount preset every ~700 ms, Buy every ~3 s when the quote is ok but never in slippage phases (it would perturb the probe's fills) — so INP has real interactions. It returns one JSON string `{ meta, runs: [{ calibrationMs, clicks, seedNotApplied, phases }], summary }`: per run and phase the key metrics (frame p95, % frames over budget, LoAF/min, INP p75, data age p95, main-thread busy %, script ms/s, commits/s, fill rate in slippage phases, recovery p50/max in fault phases) plus the CDP aggregate, and `summary[phase][metric] = { mean, ci95, n }` (mean ± ci95). Save it to a file. Phases whose seed was not applied are listed in `meta.seedNotApplied` and flagged in the panel/console (`⚠ seed not applied`) — their numbers are not reproducible.
  - **Caveat:** `Emulation.setCPUThrottlingRate` (`CPU_THROTTLE`) had no measurable effect in Playwright's automated Chromium (a calibration busy-loop ran ~50 ms with and without rate 4), so throttled numbers from the script are unverified; each run reports `calibrationMs` so you can check against a throttle-1 run.
- **How to compare**: `node scripts/bench-compare.ts A.json B.json` (Node ≥ 23, no dependencies; A = baseline, B = candidate). For every phase and key metric it prints A and B as mean ± 95% CI and the difference B − A with a 95% Welch interval; a change is flagged (`** CHANGED (better|worse)`) **only when that interval excludes zero**. Everything else is noise at this sample size. The statistics live in `src/lib/perf/stats.ts` (unit-tested). Tiny example inputs: `scripts/fixtures/bench-a.json`, `bench-b.json`.
- Documented results: `../common/research/perf-results.md`.
