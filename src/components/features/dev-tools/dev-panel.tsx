import { useState } from 'react'
import { Button } from '@/components/common/button'
import { PerfHud } from '@/components/features/perf-hud/perf-hud'
import { Container } from '@/components/layout/container'
import {
  BATCH_INTERVAL_OPTIONS,
  DEV_DROP_PCT_RANGE, DEV_LATENCY_RANGE, DEV_RATE_RANGE,
  STRESS_TRADES_PER_SEC,
} from '@/config/market'
import { useDevControls } from '@/hooks/use-dev-controls'

type Range = { min: number; max: number; step: number }

export function DevPanel() {
  const controls = useDevControls()
  const [open, setOpen] = useState(false)
  const [hudVisible, setHudVisible] = useState(false)

  return (
    <>
      {hudVisible && <PerfHud />}
      <footer className="mb-12.5 border-t-hairline border-border bg-canvas">
        <Container className="flex flex-wrap items-center gap-x-6 gap-y-3 py-2">
          <Button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-fg">
            Dev {open ? '▾' : '▸'}
          </Button>
          <Button aria-pressed={hudVisible} onClick={() => setHudVisible((v) => !v)} className="font-normal">
            Perf HUD
          </Button>
          {open && (
            <>
              <Slider
                label="Trades/s"
                range={DEV_RATE_RANGE}
                value={controls.rate}
                display={`${controls.rate}`}
                onChange={controls.setRate}
              />
              <Button onClick={controls.stress} className="font-normal">
                Stress {STRESS_TRADES_PER_SEC}/s
              </Button>
              <Slider
                label="Latency"
                range={DEV_LATENCY_RANGE}
                value={controls.latencyMs}
                display={`${controls.latencyMs} ms`}
                onChange={controls.setLatency}
              />
              <Slider
                label="Drop"
                range={DEV_DROP_PCT_RANGE}
                value={controls.dropRatePct}
                display={`${controls.dropRatePct}%`}
                onChange={controls.setDropRatePct}
              />
              <div role="group" aria-labelledby="batch-label" className="flex items-center gap-2">
                <span id="batch-label" className="text-body text-muted">
                  Batch
                </span>
                {BATCH_INTERVAL_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    className="font-normal"
                    aria-pressed={option === controls.batchIntervalMs}
                    onClick={() => controls.setBatchIntervalMs(option)}
                  >
                    {option} ms
                  </Button>
                ))}
              </div>
              <Button
                variant="danger"
                onClick={controls.dropConnection}
                className="font-normal"
                data-testid="drop-connection"
              >
                Drop connection
              </Button>
            </>
          )}
        </Container>
      </footer>
    </>
  )
}

type SliderProps = {
  label: string
  range: Range
  value: number
  display: string
  onChange: (value: number) => void
}

function Slider({ label, range, value, display, onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-body">
      <span className="text-muted">{label}</span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        // Stress mode sets the rate above the slider's range; pin the thumb to the end.
        value={Math.min(value, range.max)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-accent"
      />
      <span className="w-14 tabular-nums">{display}</span>
    </label>
  )
}
