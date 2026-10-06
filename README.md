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

- Open the app, expand **Dev ▸** and toggle **Perf HUD** for live FPS, flush time, tick→paint latency, commits per section and network counters. The dev bar changes trade rate, backend batch interval, latency and drop rate, or forces a reconnect.
- Scripted benchmark (dev server or profiling build only; the normal production build ignores `?bench=`): `pnpm build:profile && pnpm preview` (the profiling build keeps `<Profiler>` timings in production), then open `http://localhost:4173/?bench=<mode>` in a **visible** tab — rAF is throttled in hidden tabs.
  - `?bench=quick`: 34 phases × 4 s, ≈3 min. `?bench=matrix`: 34 phases × 12 s, ≈9 min. `?bench=deep`: slippage phases × 20 s + batch phases × 15 s at higher probe frequency, ≈16 min. `?bench=scale`: 13 phases × 12 s (1k–10k trades/s × full/compact aggregation at 100 ms; batch 4/8/16/33 ms compact and 16 ms full at 5k/s; the 100 ms batch points are the 5k/s load phases), ≈3.5 min.
  - Phases: **load** (5–1000 trades/s at 100 ms batches), **batch** (16–250 ms at 100 and 500 trades/s), **slippage** (order probe: $5 every second, 1/3/5/10¢ tolerance, quote age 0 or 1000 ms, at 100 and 500 trades/s) and **faults** (3 disconnects; 10% drop + 200 ms latency).
  - Probe phases reset the mock balance to $1000 through the dev-only `set_balance` command, so every probe phase starts from the same cash. The run ends (or is cancelled) with the server back at the default rate/batch/latency/drop.
- Results: the bottom-right panel (`[data-testid=bench-result]`) and the console (`[bench]` + JSON). While running, `<html data-bench-phase="…">` names the current phase (`done` at the end).
- CPU numbers: `scripts/bench-cdp.js` is a Playwright `async (page) => {...}` function that opens the bench URL, samples CDP `Performance.getMetrics` every 500 ms keyed by `data-bench-phase`, and prints main-thread busy %, script/layout/style ms per second and heap per measured window. Run it with a Playwright `page` runner, e.g. Playwright MCP `browser_run_code_unsafe` with `filename: "scripts/bench-cdp.js"`; edit `BENCH_URL` at its top to pick `quick|matrix|deep|scale`, and set `CPU_THROTTLE` (1 = none, e.g. 4 or 6) to apply CDP CPU throttling for phone-like numbers. The script returns only the per-phase CDP aggregate; read the bench JSON from `[data-testid=bench-result]` afterwards.
- Documented results: `../common/research/perf-results.md`.
