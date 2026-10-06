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
- CPU numbers: `scripts/bench-cdp.js` is a Playwright `async (page) => {...}` function that opens the bench URL, samples CDP `Performance.getMetrics` every 500 ms keyed by `data-bench-phase`, and prints main-thread busy %, script/layout/style ms per second and heap per measured window. Run it with a Playwright `page` runner, e.g. Playwright MCP `browser_run_code_unsafe` with `filename: "scripts/bench-cdp.js"`; edit `BENCH_URL` at its top to pick `realistic|soak` (or a historical mode), and set `CPU_THROTTLE` (1 = none, e.g. 4 or 6) to request CDP CPU throttling. **Caveat:** `Emulation.setCPUThrottlingRate` had no measurable effect in Playwright's automated Chromium (a calibration busy-loop ran ~50 ms with and without rate 4, also when re-applied after navigation), so throttled numbers from this script are unverified; the script returns `calibrationMs` so you can check (compare against a throttle-1 run). Measure phone-class numbers in real Chrome DevTools → Performance → CPU 4×/6× with `?bench=scale`. The script returns only the per-phase CDP aggregate; read the bench JSON from `[data-testid=bench-result]` afterwards.
- Documented results: `../common/research/perf-results.md`.
