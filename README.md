# Trading Chart — a realtime prediction market

A Polymarket-style trading UI for a 60-second YES/NO market. Users buy outcome shares, and a share's price (0–100¢) is the market's implied probability. At the centre is a live price chart fed by a WebSocket tick stream. Everything around it (order ticket, trade feed, round header, account) is built to stay smooth, correct and measurable under heavy realtime load.

**deployed app** https://tradingchart-khaki.vercel.app/

- **Prediction-market trading UI.** Live price chart, realtime trade feed and order ticket.
- **Messages.** About **13 messages/sec reach the browser at any market rate**. Tested up to **10,000 trades/sec** on the server; the smallest 4 ms batch peaks at ~180 msgs/sec.
- **Markets.** **1 live market** in rounds of 60 s.
- **Bounded memory.**
  - **≤ 61 chart points per round** (one per second, older rounds dropped).
  - **20 recent trades** in the feed and **20 resolved rounds** in history.
  - A **5,000-message replay ring** on the server.

## What it does

- **Live market.** A new round starts every minute at 50/50, with prices bounded to 15–85¢.
  - Prices come from an **LMSR market maker**; the mock traders and the user both move them.
  - A coin flip resolves the round, and each winning share pays $1.
- **Realtime chart.** One point per second. Sub-second ticks move the current second's point up and down, so the chart moves on Y within a second and steps on X once per second. It is drawn with TradingView Lightweight Charts v5.
- **Order ticket.**
  - Pick a side and an amount, then buy against a live quote that refreshes every 250 ms.
  - Slippage is an absolute tolerance in cents (3¢ by default, up to 10¢) and the server enforces it.
  - Before you buy, the ticket shows *"You pay $X · at least N shares · worst avg Y¢"*.
  - If an order is rejected for slippage, the ticket offers **"Retry at Z¢"**.
- **Trade feed, round header, account panel and round history.** All of these update live.
- **Resilience.** Reconnects use exponential backoff with full jitter. Missed messages are resynced by sequence number, and duplicates are dropped. Orders are idempotent (the client generates their ids), and in-flight orders are re-sent after a reconnect.
- **Dev tools.**
  - A dev bar changes the trade rate, batch interval, latency and drop rate, forces disconnects and switches server aggregation.
  - A Perf HUD shows live frame time, LoAF, data age, React commits per section and network counters.
  - A scripted benchmark runner (`?bench=`) is built into dev and profiling builds.

The frontend computes no prices. All pricing, fills, slippage checks and payouts happen on the backend, which here is a mock server running in a Web Worker behind a WebSocket-shaped interface.

## Architecture

```
┌──────────────── Web Worker (mock backend) ────────────────┐      ┌──────────────────── Main thread ────────────────────┐
│ MockTraders ─► MarketEngine (LMSR, rounds, fills, payout)  │      │ MockSocket ─► MarketClient                          │
│                    │                                       │ post │   seq ordering · gap → resync · dedupe ·            │
│ TradeCompaction ◄──┘  (compact: last trade per second,    │─────►│   reconnect w/ backoff · inflight order resend      │
│                        newest 12, all user trades)        │ msg  │        │                                            │
│ Outbox (monotonic seq + 5,000-msg replay ring)             │      │        ├─► TickBuffer ─► ChartFeeder ─► series.update()   (rAF, outside React)
│ Fault injection: latency · drop · forced disconnect        │      │        ├─► MarketStore  ─┐ throttled 250 ms         │
│ Batches every 100 ms                                       │      │        └─► AccountStore ─┴► useSyncExternalStore ─► leaf components
└────────────────────────────────────────────────────────────┘      └─────────────────────────────────────────────────────┘
```

- **`src/server/`** is the backend: the LMSR engine, rounds with a pluggable resolver (coinflip now, a BTC up/down resolver can slot in later), seeded RNG streams, mock traders, trade compaction and an outbox with a replay ring. It runs in a Web Worker, so the main thread pays only for messages, never for market simulation.
- **`src/lib/realtime/`** is the client.
  - `MarketClient` owns the protocol: sequence ordering, gap detection and resync, reconnection, and the in-flight order cache.
  - `TickBuffer` and `ChartFeeder` take ticks straight to the chart.
  - `MarketStore` and `AccountStore` are read-only external stores for everything React renders.
- **`src/hooks/`** holds all non-trivial UI logic (quotes, the trade ticket, the countdown, the chart lifecycle, the perf HUD, the bench). Components only render.
- **`src/lib/perf/`** is the measurement layer: frame budget, LoAF, INP, data age, recovery timeline, rolling stats, t-distribution confidence intervals, Welch tests and Holm–Bonferroni.

### Why it is built this way

- **Ticks never touch React state.** A tick in state would mean a re-render per tick. Instead:
  - Ticks go `MarketClient → TickBuffer → ChartFeeder → series.update()`, flushed once per `requestAnimationFrame`.
  - Fifty messages in one frame produce one repaint, and ticks that land on the same one-second bar collapse to the last value.
  - The chart instance and series live in refs and are created once.
- **Low-frequency UI reads throttled external stores.**
  - `MarketStore` and `AccountStore` are built on a tiny `createExternalStore` and read through `useSyncExternalStore`.
  - Tick-driven fields publish at most every 250 ms. Discrete events (round change, order result, status) publish immediately.
  - The store class holds the only writable handle and exposes a read-only interface.
  - The decision is recorded in an ADR: push data is not request/response, so TanStack Query or Zustand would only add indirection.
- **Leaf subscriptions and structural sharing.**
  - Each component subscribes to the smallest slice it renders. The price label, side buttons, quote summary and submit button re-render independently, and the ticket container does not re-render on ticks.
  - Unchanged account history and positions keep their identity, so round history commits 0 times per second while you trade.
- **Correct under reconnects.** Every server message has a monotonic `seq`. The client buffers out-of-order messages, resyncs from a snapshot on a gap or a 1 s stall, drops duplicates, and re-sends in-flight orders. Quote replies sit outside the sequenced stream and go only to the connection that asked for them, so a slow quote can never open a gap or starve the ticket.
- **Server-side aggregation.** In `compact` mode (the default) each 100 ms batch carries:
  - the last trade of every second, so the chart stays exact;
  - the newest 12 trades for the feed;
  - every user trade;
  - a count and volume summary of the rest.

  Bandwidth stays at ~14 KB/s per client at any trade rate, compared with ~1 MB/s at 10,000 trades/s when every trade is shipped.
- **Typed end to end.** TypeScript is strict with `erasableSyntaxOnly`. There is no `any`, no `as` casts and no `@ts-ignore`, and unions are used instead of `null`/`undefined`. Every message is checked by runtime type guards before use, and a `Result<T>` type is used where the UI branches on error codes.
- **Measured, not assumed.** Performance claims come from a reproducible benchmark: seeded load, fixed warm-up, 5 repeated runs, mean ± 95% CI, and real clicks so INP has data. Changes are compared with a multiple-testing-corrected test (see [Performance](#performance)).

### Best practices followed

- Components are small and do one thing; logic lives in hooks; no component both fetches data and renders UI.
- The chart is created once in `useEffect`, `chart.remove()` runs on cleanup, and updates go through `series.update()`.
- rAF batching with per-bar collapsing, a backlog fallback to `setData`, and stale points skipped.
- Each feature is wrapped in an error boundary (`FeatureBoundary`), and React `<Profiler>` timings feed the HUD in dev and profiling builds.
- Bench code runs only in dev and profiling builds (`BENCH_AVAILABLE`), and the normal production build ignores `?bench=`.
- Accessibility:
  - order status is a live region (`role="status"`);
  - buttons have labels;
  - a visible `:focus-visible` ring;
  - the "at least N shares" and "worst avg" numbers round in the safe direction (shares down, price up).
- 321 unit and integration tests (Vitest) cover the engine, protocol guards, client ordering/resync/reconnect, stores, the chart feeder, end-to-end flows through an in-process worker, metrics math and statistics.
- Small conventional commits, one PR per layer (backend mock → realtime client → UI → perf → bench v3), each reviewed separately.

## Design system

The visual language is Morfi-inspired: a dark graphite surface, hairline borders, a cyan chart line and an amber baseline. It is defined entirely as tokens in Tailwind v4 `@theme` (`src/styles/globals.css`), so components contain no hex values.

- **Colour tokens.**
  - Neutrals: `canvas`, `surface`, `surface-raised`, `border`, `fg`, `fg-secondary`, `muted`, `subtle`.
  - Outcomes: `yes` / `no` with `-soft` and `-strong` variants.
  - Brand: `accent`, `brand-text`, `brand-surface`, `brand-border`, `warn`, `cyan`, and the CTA gradient `primary-from` / `primary-to`.
- **Type.** Geist and Geist Mono (tabular numbers for prices). The scale is `caption`, `body`, `body-lg`, `heading`, `heading-lg`, `display`, with line height, weight and tracking built in.
- **Shape and elevation.**
  - Radii: `card` 20 px, `control` 12 px, `pill`.
  - Shadows: `shadow-card`, `shadow-primary` (CTA glow) and `shadow-sticky`.
- **Utilities.**
  - Hairlines: `card`, `border-hairline`, `border-b-hairline`, `border-t-hairline`, `divide-hairline` (0.5 px).
  - Labels and CTA: `eyebrow` (uppercase section labels) and `btn-primary` (gradient CTA with inner highlight).
  - Texture: `dot-grid`.
- **Primitives** (`src/components/common/`): `Button`, `Badge`, `Panel`, `StatList`, `Skeleton`, `ErrorBoundary`, `FeatureBoundary`.
- **Chart theme.** Lightweight Charts draws to canvas, so its colours sit in one constants file (`src/config/chart-theme.ts`) instead of CSS.
- **Rule.** Static styling uses Tailwind utilities. Inline `style` is used only for runtime-computed values.

## Getting started

```bash
pnpm install
pnpm dev                       # http://localhost:5173
pnpm test                      # Vitest, 321 tests
pnpm lint                      # oxlint
pnpm build                     # typecheck + production build
pnpm build:profile && pnpm preview   # profiling build (React Profiler on) at :4173
```

Open **Dev ▸** in the footer to change the trade rate, batch interval, latency or drop rate, force a disconnect, or open the Perf HUD.

## Project structure

```
src/
├── server/              # mock backend in a Web Worker: LMSR engine, rounds, resolvers, traders, outbox, compaction
├── lib/
│   ├── realtime/        # protocol, socket, MarketClient, TickBuffer, ChartFeeder, MarketStore, AccountStore, clock sync
│   ├── perf/            # perf metrics, bench & soak runners, stats (CI, Welch, Holm)
│   └── utils/           # external store, formatting, order/quote descriptions
├── hooks/               # use-price-chart, use-trade-ticket, use-quote, use-place-order, use-perf-hud, use-bench, …
├── components/
│   ├── common/          # design-system primitives
│   ├── layout/          # app shell, header, connection badge
│   └── features/        # chart, trade-panel, trades-feed, round, market, perf-hud, dev-tools
├── config/              # market constants, chart theme, bench gating, build hash
└── styles/globals.css   # Tailwind entry + @theme tokens
scripts/                 # bench-cdp.js (Playwright + CDP harness), bench-compare.ts
docs/benchmarks.md       # how to run, read and compare the benchmarks
```

## Performance

Tracked set: `?bench=realistic` (30 phases) and `?bench=soak` (30 min). The numbers below come from a profiling build in Chromium 154 on a 120 Hz display at CPU ×1. Each is the mean ± 95% CI over 5 runs, with real clicks in the ticket.

| | Result |
|---|---|
| Frame p95, 30 → 5,000 trades/s | **9.7 ± 0.5 ms**, flat across load |
| Frames over the 60 Hz budget (missed vsync) | **0%** |
| Long Animation Frames | **0 / min** |
| INP p75 (real clicks) | **24 ms** (good is < 200 ms) |
| Main thread busy | **~9–10%**, flat across load |
| React commits | ~24 / s total; the chart commits **0** times |
| Reconnect recovery to live | **137 ms** median, 170 ms max |
| 10% loss + 200 ms latency | stays live; data age p95 ≈ 600 ms |
| Fill rate at the 3¢ default | **≥ 87%** up to 300 trades/s with 150 ms latency (≥ 98% at 30–100/s, no latency) |
| Soak, 30 min | heap flat at 21–26 MB, 0 gaps/resyncs/reconnects |
| Bandwidth at 10,000 trades/s | ~14 KB/s compact vs ~1 MB/s full |

How to run, read and compare the benchmarks (seeds, method, the `bench-cdp.js` harness and `bench-compare.ts`): [docs/benchmarks.md](docs/benchmarks.md).

Mid-tier phone numbers are still to come. CDP CPU throttling has no effect in automated Chromium, so they need a run in real Chrome DevTools with the calibrated mid-tier preset, or on a real Android device.

---

**Benchmark report:** https://claude.ai/artifact/WBmfJqmAJhZXocSzQn3Cu7
