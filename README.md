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
- Scripted benchmark: `pnpm build:profile && pnpm preview` (the profiling build keeps `<Profiler>` timings in production), then open `http://localhost:4173/?bench=matrix` (34 phases × 12 s, ≈8 min) or `?bench=quick` (same phases × 4 s, ≈3 min) in a **visible** tab — rAF is throttled in hidden tabs.
- Phases: **load** (5–1000 trades/s at 100 ms batches), **batch** (16–250 ms at 100 and 500 trades/s), **slippage** (order probe: $5 every second, 1/3/5/10¢ tolerance, quote age 0 or 1000 ms, at 100 and 500 trades/s) and **faults** (3 disconnects; 10% drop + 200 ms latency).
- Results: the bottom-right panel (`[data-testid=bench-result]`) and the console (`[bench]` + JSON). While running, `<html data-bench-phase="…">` names the current phase (`done` at the end) so an external Chrome DevTools Protocol sampler can align `Performance.getMetrics` with phases.
