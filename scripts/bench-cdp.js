// CDP sampler for the benchmark's CPU numbers (main-thread busy %, script/layout/style ms per second, heap).
//
// Usage: a Playwright `async (page) => {...}` function, not a Node script. Serve the profiling build first
// (`pnpm build:profile && pnpm preview`, port 4173), then run it through any Playwright `page` runner, e.g.
// the Playwright MCP `browser_run_code_unsafe` tool with `filename: "scripts/bench-cdp.js"`. Use a visible
// (headed or foreground) tab: rAF is throttled in hidden tabs.
//
// What it does: opens BENCH_URL, samples CDP `Performance.getMetrics` every 500 ms keyed by
// `<html data-bench-phase>`, waits for `[data-testid=bench-result]`, then aggregates each measured window
// (samples inside warm-up / settle / done phases are dropped).
//
// CPU throttling: set CPU_THROTTLE below (1 = none, 4 / 6 = slowdown factor); it is applied through CDP
// `Emulation.setCPUThrottlingRate` right after the session is created, before navigation.
//
// Returns a JSON string: { ua, cpuThrottle, samples, benchChars, cdp } — only the per-phase CDP aggregate, not the
// bench JSON (keeps the output small). Read the bench JSON afterwards from `[data-testid=bench-result]`
// (e.g. `browser_evaluate`). cdp[phase] has
//   wallSec            seconds of samples inside the measured window
//   mainThreadBusyPct  CDP TaskDuration / wall time * 100
//   scriptMsPerSec     ScriptDuration ms per wall second
//   layoutMsPerSec     LayoutDuration ms per wall second
//   styleMsPerSec      RecalcStyleDuration ms per wall second
//   heapMaxMb          max JSHeapUsedSize in the window
// Phase names match `phase` in the bench results shown in the panel / `[bench]` console JSON.

async (page) => {
  // Change the query to pick the scenario: ?bench=quick (~3 min) | matrix (~9 min) | deep (~16 min) | scale (~3.5 min).
  const CPU_THROTTLE = 1 // 1 = no throttling; 4 or 6 = CPU slowed by that factor
  const BENCH_URL = 'http://localhost:4173/?bench=matrix'
  const url = BENCH_URL
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  await session.send('Performance.enable', { timeDomain: 'timeTicks' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  const samples = []
  let finished = false
  const sampler = (async () => {
    while (!finished) {
      try {
        const { metrics } = await session.send('Performance.getMetrics')
        const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
        const phase = await page.evaluate(() => document.documentElement.dataset.benchPhase ?? '')
        samples.push({ t: m.Timestamp, phase, task: m.TaskDuration, script: m.ScriptDuration, layout: m.LayoutDuration, style: m.RecalcStyleDuration, heap: m.JSHeapUsedSize })
      } catch {
        // A sample can fail mid-navigation; skip it.
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  })()
  await page.waitForSelector('[data-testid=bench-result]', { timeout: 45 * 60 * 1000 })
  finished = true
  await sampler
  const bench = await page.evaluate(() => document.querySelector('[data-testid=bench-result]').textContent)
  const byPhase = {}
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (!b.phase || b.phase !== a.phase || b.phase === 'done' || b.phase === 'settle' || b.phase.startsWith('warmup:')) continue
    const dt = b.t - a.t
    if (dt <= 0) continue
    const p = (byPhase[b.phase] ??= { wall: 0, task: 0, script: 0, layout: 0, style: 0, heapMax: 0 })
    p.wall += dt
    p.task += b.task - a.task
    p.script += b.script - a.script
    p.layout += b.layout - a.layout
    p.style += b.style - a.style
    p.heapMax = Math.max(p.heapMax, b.heap)
  }
  const cdp = {}
  for (const [phase, p] of Object.entries(byPhase)) {
    cdp[phase] = {
      wallSec: +p.wall.toFixed(1),
      mainThreadBusyPct: +((p.task / p.wall) * 100).toFixed(2),
      scriptMsPerSec: +((p.script / p.wall) * 1000).toFixed(2),
      layoutMsPerSec: +((p.layout / p.wall) * 1000).toFixed(2),
      styleMsPerSec: +((p.style / p.wall) * 1000).toFixed(2),
      heapMaxMb: +(p.heapMax / 1048576).toFixed(1),
    }
  }
  const ua = await page.evaluate(() => navigator.userAgent)
  return JSON.stringify({ ua, cpuThrottle: CPU_THROTTLE, samples: samples.length, benchChars: bench.length, cdp })
}
