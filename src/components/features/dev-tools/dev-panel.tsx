import { useState } from 'react'
import { PerfHud } from '@/components/features/perf-hud/perf-hud'
import { useDevControls } from '@/hooks/use-dev-controls'

const PILL = 'inline-flex h-8 items-center gap-2 rounded-pill border-hairline border-border bg-surface px-3 text-body'

export function DevPanel() {
  const controls = useDevControls()
  const [open, setOpen] = useState(false)
  const [hudVisible, setHudVisible] = useState(false)

  return (
    <>
      {hudVisible && <PerfHud />}
      <footer className="border-t-hairline border-border bg-canvas">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-2 md:px-8">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${PILL} font-medium`}>
            Dev {open ? '▾' : '▸'}
          </button>
          <button
            type="button"
            aria-pressed={hudVisible}
            onClick={() => setHudVisible((v) => !v)}
            className={`${PILL} ${hudVisible ? 'text-fg' : 'text-fg-secondary'}`}
          >
            Perf HUD
          </button>
          {open && (
            <>
              <Slider
                label="Trades/s"
                value={controls.rate}
                min={5}
                max={100}
                step={5}
                display={`${controls.rate}`}
                onChange={controls.setRate}
              />
              <button type="button" onClick={controls.stress} className={`${PILL} text-fg-secondary hover:text-fg`}>
                Stress 500/s
              </button>
              <Slider
                label="Latency"
                value={controls.latencyMs}
                min={0}
                max={1_000}
                step={50}
                display={`${controls.latencyMs} ms`}
                onChange={controls.setLatency}
              />
              <Slider
                label="Drop"
                value={controls.dropRatePct}
                min={0}
                max={50}
                step={5}
                display={`${controls.dropRatePct}%`}
                onChange={controls.setDropRatePct}
              />
              <button
                type="button"
                onClick={controls.dropConnection}
                className="inline-flex h-8 items-center gap-2 rounded-pill border-hairline border-no/40 bg-no-strong px-3 text-body text-no"
                data-testid="drop-connection"
              >
                Drop connection
              </button>
            </>
          )}
        </div>
      </footer>
    </>
  )
}

type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-body">
      <span className="text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(value, max)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-accent"
      />
      <span className="w-14 tabular-nums">{display}</span>
    </label>
  )
}
