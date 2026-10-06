// Benchmark harness: RUNS repeats of a `?bench=` scenario with CDP CPU sampling, real ticket clicks
// (so INP has data) and per-phase mean ± 95% CI of the key metrics.
//
// Usage: a Playwright `async (page) => {...}` function, not a Node script (it cannot import). Serve the profiling
// build first (`pnpm build:profile && pnpm preview`, port 4173), then run it through any Playwright `page` runner,
// e.g. the Playwright MCP `browser_run_code_unsafe` tool with `filename: "scripts/bench-cdp.js"`. Use a visible
// (headed or foreground) tab: rAF is throttled in hidden tabs. Save the returned JSON string to a file and compare
// two such files with `node scripts/bench-compare.ts A.json B.json`.
//
// Per run (fresh navigation each): samples CDP `Performance.getMetrics` every 500 ms keyed by
// `<html data-bench-phase>`, clicks the trade ticket inside measured windows, waits for
// `[data-testid=bench-result]`, then aggregates each measured window (samples and clicks inside warm-up / settle /
// done are dropped).
//
// Clicks (real input through page.click, so Event Timing sees them; a failed click is counted and ignored):
//   every TOGGLE_EVERY_MS  one side toggle + one amount preset (cycling)
//   soak (`bench=soak` in BENCH_URL): no clicks at all.
//   every BUY_EVERY_MS     Buy, only when the ticket has an ok quote (button enabled) and never in slippage phases
//                          (names starting with 'slip '): an order there would perturb the probe's fills.
//
// CPU throttling: set CPU_THROTTLE below (1 = none, 4 / 6 = slowdown factor); it is applied through CDP
// `Emulation.setCPUThrottlingRate` right after the session is created, before navigation.
//
// CAVEAT: `Emulation.setCPUThrottlingRate` had no measurable effect in Playwright's automated Chromium (a
// calibration busy-loop ran ~50 ms with and without rate 4, also when re-applied after navigation), so throttled
// numbers from this script are unverified. Measure phone-class numbers in real Chrome DevTools -> Performance ->
// CPU (calibrated mid-tier preset) or on a real Android device. Self-check: after each navigation the script runs a
// 2e7-iteration busy-loop in the page and stores its duration as `calibrationMs`; run once with CPU_THROTTLE = 1 and
// once with 4 — if calibrationMs is not roughly 4x larger, the throttle is not in effect.
//
// Returns ONE JSON string:
//   { meta (incl. failedRuns), runs: [{ error } for a failed run | { calibrationMs, clicks, seedNotApplied, phases: { <phase>: {...} }, raw? }],
//     summary: { <phase>: { <metric>: { mean, ci95, n } } } }
// runs[].phases[phase] holds the key metrics only (number or 'n/a'):
//   frameP95, pctFramesOverBudget, loafPerMin, inpP75 (+ interactions), dataAgeP95, commitsPerSec,
//   mainThreadBusyPct, scriptMsPerSec (from CDP), fillRate (slippage phases), recoveryP50 / recoveryMax (fault
//   phases), seedApplied, and `cdp` — the full CDP aggregate for the window:
//     wallSec, mainThreadBusyPct, scriptMsPerSec, layoutMsPerSec, styleMsPerSec, heapMaxMb
// A soak run (`?bench=soak`) yields one phase with frameP95 = frameP95MaxMs, loafPerMin = loafPerMinMax and
// heapGrowthMb. summary[phase][metric] is the mean with the 95% t-interval half-width (mean ± ci95) over the runs
// with a numeric value ('n/a' skipped; ci95 'n/a' when n < 2). The full bench JSON is left out (too big); set
// KEEP_RAW = true to include it as runs[].raw.

async (page) => {
  // Scenario: ?bench=realistic (~11 min) | soak (~30 min) — the tracked set — or the historical
  // quick (~3 min) | matrix (~9 min) | deep (~16 min) | scale (~3.5 min).
  const BENCH_URL = 'http://localhost:4173/?bench=realistic'
  const RUNS = 5
  const CPU_THROTTLE = 1 // 1 = no throttling; 4 or 6 = CPU slowed by that factor (unverified, see CAVEAT)
  const KEEP_RAW = false
  const SAMPLE_EVERY_MS = 500
  const TOGGLE_EVERY_MS = 700
  const BUY_EVERY_MS = 3_000
  const CLICK_TIMEOUT_MS = 1_000
  const CLICKER_POLL_MS = 250
  const QUOTE_SETTLE_MS = 450 // > QUOTE_REFRESH_MS (250) + a quote round trip
  const IS_SOAK = BENCH_URL.includes('bench=soak') // soak: no clicks at all, order state would distort heap growth
  const RESULT_TIMEOUT_MS = 45 * 60 * 1000

  const SIDES = ['[data-testid=ticket-side-no]', '[data-testid=ticket-side-yes]']
  const PRESETS = ['[data-testid=ticket-amount-50]', '[data-testid=ticket-amount-100]', '[data-testid=ticket-amount-10]']
  const SUBMIT = '[data-testid=ticket-submit]'

  // --- Statistics: minimal inline copy of meanCI from src/lib/perf/stats.ts (the source of truth) ---
  const T975 = [
    12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157, 2.228139, 2.200985,
    2.178813, 2.160369, 2.144787, 2.13145, 2.119905, 2.109816, 2.100922, 2.093024, 2.085963, 2.079614, 2.073873,
    2.068658, 2.063899, 2.059539, 2.055529, 2.051831, 2.048407, 2.04523, 2.042272,
  ]
  const tQuantile975 = (df) => {
    if (df <= T975.length) return T975[Math.max(1, df) - 1]
    const z = 1.959964
    return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
  }
  const round = (v) => Math.round(v * 1000) / 1000
  const meanCI = (values) => {
    const n = values.length
    const mean = values.reduce((s, v) => s + v, 0) / n
    if (n < 2) return { mean: round(mean), ci95: 'n/a', n }
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
    return { mean: round(mean), ci95: round((tQuantile975(n - 1) * sd) / Math.sqrt(n)), n }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const isMeasured = (phase) => phase !== '' && phase !== 'done' && phase !== 'settle' && !phase.startsWith('warmup:')
  const readPhase = () => page.evaluate(() => document.documentElement.dataset.benchPhase ?? '')

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  await page.setViewportSize({ width: 1440, height: 900 })

  /** Per-phase CDP aggregate over measured windows. */
  const aggregateCdp = (samples) => {
    const byPhase = {}
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]
      const b = samples[i]
      if (b.phase !== a.phase || !isMeasured(b.phase)) continue
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
    return cdp
  }

  /** Key metrics of one bench phase result (BenchPhaseResult in src/lib/perf/bench.ts). */
  const phaseMetrics = (r, cdp) => {
    const m = {
      group: r.group,
      seedApplied: r.seedApplied,
      frameP95: r.frameP95Ms,
      pctFramesOverBudget: r.pctFramesOverBudget,
      loafPerMin: r.loafPerMin,
      inpP75: r.inpP75Ms,
      interactions: r.interactions,
      dataAgeP95: r.dataAgeP95Ms,
      commitsPerSec: r.commitsPerSecTotal,
      mainThreadBusyPct: cdp ? cdp.mainThreadBusyPct : 'n/a',
      scriptMsPerSec: cdp ? cdp.scriptMsPerSec : 'n/a',
    }
    if (r.group === 'slippage') m.fillRate = r.probe !== 'off' && r.probe ? r.probe.fillRate : 'n/a'
    if (r.group === 'faults') {
      m.recoveryP50 = r.recoveryP50Ms
      m.recoveryMax = r.recoveryMaxMs
    }
    m.cdp = cdp ?? 'n/a'
    return m
  }

  /** Key metrics of a soak result (SoakResult in src/lib/perf/soak.ts). */
  const soakMetrics = (r, cdp) => ({
    seedApplied: r.seedApplied,
    frameP95: r.frameP95MaxMs,
    loafPerMin: r.loafPerMinMax,
    heapGrowthMb: r.heapGrowthMb,
    mainThreadBusyPct: cdp ? cdp.mainThreadBusyPct : 'n/a',
    scriptMsPerSec: cdp ? cdp.scriptMsPerSec : 'n/a',
    cdp: cdp ?? 'n/a',
  })

  const runOnce = async () => {
    await session.send('Performance.enable', { timeDomain: 'timeTicks' })
    await page.goto(BENCH_URL)
    const calibrationMs = await page.evaluate(() => {
      const t0 = performance.now()
      let x = 0
      for (let i = 0; i < 2e7; i++) x += i % 7
      return x < 0 ? -1 : +(performance.now() - t0).toFixed(1)
    })
    const samples = []
    const clicks = { ok: 0, failed: 0, buys: 0 }
    let finished = false

    const sampler = (async () => {
      while (!finished) {
        try {
          const { metrics } = await session.send('Performance.getMetrics')
          const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
          const phase = await readPhase()
          samples.push({ t: m.Timestamp, phase, task: m.TaskDuration, script: m.ScriptDuration, layout: m.LayoutDuration, style: m.RecalcStyleDuration, heap: m.JSHeapUsedSize })
        } catch {
          // A sample can fail mid-navigation; skip it.
        }
        await sleep(SAMPLE_EVERY_MS)
      }
    })()

    const click = async (selector) => {
      try {
        await page.click(selector, { timeout: CLICK_TIMEOUT_MS })
        clicks.ok++
        return true
      } catch {
        clicks.failed++
        return false
      }
    }

    const clicker = (async () => {
      let step = 0
      let lastToggle = 0
      let lastBuy = Date.now()
      while (!finished) {
        await sleep(CLICKER_POLL_MS)
        let phase = ''
        try {
          phase = await readPhase()
        } catch {
          continue
        }
        if (IS_SOAK || !isMeasured(phase)) continue
        // Buy first, and only once the last toggle is QUOTE_SETTLE_MS old: a toggle changes side/amount, which
        // invalidates the ticket's quote until the next refresh, so a Buy right after it always finds the button
        // disabled.
        const buyDue = Date.now() - lastBuy >= BUY_EVERY_MS && Date.now() - lastToggle >= QUOTE_SETTLE_MS
        if (!phase.startsWith('slip ') && buyDue) {
          lastBuy = Date.now()
          // Re-read right before buying: the phase may have changed since the read above.
          let current = ''
          try {
            current = await readPhase()
          } catch {
            continue
          }
          if (current !== phase || !isMeasured(current) || current.startsWith('slip ')) continue
          const enabled = await page.isEnabled(SUBMIT, { timeout: CLICK_TIMEOUT_MS }).catch(() => false)
          if (enabled && (await click(SUBMIT))) clicks.buys++
          continue
        }
        if (Date.now() - lastToggle >= TOGGLE_EVERY_MS) {
          lastToggle = Date.now()
          await click(SIDES[step % SIDES.length])
          await click(PRESETS[step % PRESETS.length])
          step++
        }
      }
    })()

    let bench
    try {
      await page.waitForSelector('[data-testid=bench-result]', { timeout: RESULT_TIMEOUT_MS })
      bench = JSON.parse(await page.evaluate(() => document.querySelector('[data-testid=bench-result]').textContent))
    } finally {
      finished = true
      await Promise.all([sampler, clicker])
    }

    const cdp = aggregateCdp(samples)
    const results = Array.isArray(bench) ? bench : [{ ...bench, phase: bench.name }]
    const phases = {}
    for (const r of results) phases[r.phase] = Array.isArray(bench) ? phaseMetrics(r, cdp[r.phase]) : soakMetrics(r, cdp[r.phase])
    const run = {
      calibrationMs,
      clicks,
      // 'live' phases (historical modes) never apply a seed by design; only seeded phases can fail to.
      seedNotApplied: results.filter((r) => r.seed !== 'live' && !r.seedApplied).map((r) => r.phase),
      phases,
    }
    if (KEEP_RAW) run.raw = bench
    return { run, environment: results.length > 0 ? results[0].environment : 'n/a' }
  }

  const startedAt = new Date().toISOString()
  const runs = []
  let environment = 'n/a'
  for (let i = 0; i < RUNS; i++) {
    try {
      const { run, environment: env } = await runOnce()
      runs.push(run)
      if (environment === 'n/a') environment = env
    } catch (e) {
      runs.push({ error: String(e) })
    }
  }
  const okRuns = runs.filter((r) => !r.error)

  // Summary: mean ± 95% CI per phase and numeric key metric, across runs.
  const summary = {}
  for (const run of okRuns) {
    for (const [phase, metrics] of Object.entries(run.phases)) {
      const byMetric = (summary[phase] ??= {})
      for (const [metric, value] of Object.entries(metrics)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        ;(byMetric[metric] ??= []).push(value)
      }
    }
  }
  for (const byMetric of Object.values(summary)) {
    for (const [metric, values] of Object.entries(byMetric)) byMetric[metric] = meanCI(values)
  }

  const meta = {
    benchUrl: BENCH_URL,
    runs: RUNS,
    cpuThrottle: CPU_THROTTLE,
    failedRuns: runs.length - okRuns.length,
    startedAt,
    userAgent: await page.evaluate(() => navigator.userAgent),
    buildHash: environment === 'n/a' ? 'n/a' : environment.buildHash,
    displayHz: environment === 'n/a' ? 'n/a' : environment.displayHz,
    seedNotApplied: [...new Set(okRuns.flatMap((r) => r.seedNotApplied ?? []))],
  }
  return JSON.stringify({ meta, runs, summary })
}
