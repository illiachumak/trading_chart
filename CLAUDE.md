# CLAUDE.md — Trading Chart (Polymarket clone)
> Read by Claude Code at the start of every session.
note: for the comments and anything else use english. for the response to the user in claude code cli use any language you want.
---

## 1. Project Overview

**Trading Chart** — a Polymarket clone. Prediction markets where users trade YES/NO outcome shares; the price of a share (0–100¢) is the market's implied probability. The core of the UI is a realtime price chart driven by a WebSocket tick stream.

- **Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, TradingView Lightweight Charts v5
- **State:** TanStack Query — server state (when added), Zustand — global UI state only (when added)
- **Package manager:** `pnpm`

**Workspace layout:**

```
trading_chart/
├── repo/      # this git repo — application code only
└── common/    # docs, specs, plans, research, agent work — NOT in the repo
```

Plans, specs, research notes and any other agent output go to `../common/`, never into `repo/`.

---

## 2. Project Structure

```
repo/
├── src/
│   ├── app.tsx             # Root component
│   ├── main.tsx            # Entry point
│   ├── components/
│   │   ├── ui/             # shadcn/ui — do not edit directly
│   │   ├── common/         # Reusable building blocks
│   │   ├── layout/         # Header, Sidebar, Footer
│   │   └── features/       # Business components: chart/, markets/, order-book/
│   ├── lib/
│   │   ├── realtime/       # WebSocket clients, tick buffers
│   │   └── utils/
│   ├── services/           # marketsService etc.
│   ├── hooks/              # Custom hooks
│   ├── store/              # Zustand stores (one file per concern)
│   ├── types/              # models.ts, api.ts, index.ts
│   ├── config/             # env.ts, constants
│   └── styles/globals.css  # Tailwind entry + @theme tokens
└── vite.config.ts
```

**Path alias:** `@/*` → `./src/*`

---

## 3. Realtime Data & Charts (critical)

- **WebSocket ticks never go through React state.** No `useState`/`useReducer`/Zustand/TanStack Query for per-tick data. A tick in state = a re-render per tick. So avoid it.
- **Chart instance and series live in `useRef`.** Create in `useEffect`, call `chart.remove()` on cleanup. Never recreate the chart on re-render.
- **Apply ticks with `series.update()` directly**, outside the React render cycle.
- **Batch via `requestAnimationFrame`.** Push incoming ticks into a buffer; flush once per frame. 50 messages per frame must mean 1 repaint, not 50. Within one flush, collapse ticks that hit the same bar time — only the last value per bar matters.
- React state is allowed only for low-frequency derived UI (e.g. connection status, a throttled "last price" label updated at most a few times per second).

---

## 4. State Management

- Server state — TanStack Query only, do not duplicate in Zustand
- **Exception — realtime push state.** Data that arrives over the WebSocket stream (market round/price/trades, account, order and quote results) lives in the external stores under `src/lib/realtime/` (`MarketStore`, `AccountStore`, built on `createExternalStore` + `useSyncExternalStore`), not in TanStack Query or Zustand. Rules: the store class owns the only writable handle and exposes a read-only `ExternalStore`; tick-driven fields are throttled (`UI_THROTTLE_MS`), discrete events publish immediately; the chart never reads from these stores (see §3). Rationale: `../common/specs/2026-10-06-adr-realtime-external-stores.md`
- Local UI state — `useState` / `useReducer` inside the component
- Zustand — global UI state only (auth, ui preferences, shell layout). Keep stores focused; no cross-store dependencies
- Zustand stores live in `src/store/*-store.ts` (one store per concern)
- Export typed selectors alongside the store — prefer them over inline `s => s.x` when the derivation is non-trivial or reused
- Complex local state → `useReducer` or a single union-typed `useState`, avoid stacking multiple `useState` booleans
- If `isLoading/isSuccess/isError` can all be `true` simultaneously — rewrite as union type

---

## 5. TypeScript

- Forbidden: `any`, `as any`, `@ts-ignore`
- Avoid `null`/`undefined` — use union types
- Type guards instead of `as` cast
- Explicit types on public functions and API responses
- **Result type** for flows that must branch on specific error codes in the UI:

```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
```

---

## 6. Error Handling

Services throw by default. TanStack Query is the error-handling adapter — queries/mutations surface errors via `onError` + `error` state, and components render from that. Reach for `Result<T>` only when the UI has to discriminate between specific expected error codes.

| Type | Example | How to handle |
|------|---------|---------------|
| **Expected, single failure mode** | Generic API failure, network blip | Service throws, hook's `onError` → toast |
| **Expected, branching UI** | Order rejected (insufficient balance vs market closed) | Service returns `Result<T>`, component switches on `error` |
| **Unexpected** | 500, JS crash | `<ErrorBoundary>` |
| **WebSocket drop** | Connection lost | Reconnect with backoff inside the realtime client; expose status to UI |

---

## 7. Styling

- **Tailwind** only — no scss
- Design tokens live in `@theme` in `src/styles/globals.css` (`bg-surface`, `text-yes`, `text-no`, …). Add tokens there instead of hardcoding hex values in components.
- Static values → Tailwind utilities. **Inline `style={{ … }}` is only allowed for runtime-computed values that Tailwind cannot express.**
- Chart colors are passed to Lightweight Charts as options (it draws to canvas) — keep them in one constants file.

---

## 8. Naming Conventions

| What | Convention | Example |
|------|------------|---------|
| Components | `PascalCase` | `PriceChart` |
| Files | `kebab-case` | `price-chart.tsx` |
| Hooks | `use` + `camelCase` | `usePriceStream` |
| Services | `camelCase` + `Service` | `marketsService` |
| Types | `PascalCase` | `MarketTick` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_BUFFER_SIZE` |

---

## 9. Component Philosophy

- Components should be small with a single, clearly defined responsibility
- Complex logic belongs in a hook — the component only renders
- Use hooks whenever there is non-trivial logic: data fetching, forms, state, side effects, realtime subscriptions
- Do not mix fetching and UI in the same component

---

## 10. Constraints

- `components/ui/` — fetch new components only via shadcn CLI
- New Zustand stores — only after discussion (document the slice and rationale in a plan doc in `../common/`)
- `pnpm` only — not npm or yarn
- Commits: small and incremental, conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Work on `dev` (or feature branches off `dev`).
