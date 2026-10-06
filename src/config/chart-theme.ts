// Lightweight Charts draws to canvas and cannot read CSS variables — keep in sync with @theme.
export const CHART_COLORS = {
  // Transparent so the wrapper's dot-grid shows through; the card behind is surface (#1b1b1b).
  background: 'transparent',
  text: '#707070', // subtle (axis labels)
  grid: '#2b2b2b', // border
  line: '#00dad9', // cyan
  baseline: '#ec9400', // amber dotted "50%" line
  yes: '#56d042',
  no: '#ff7e66',
} as const

export const CHART_FONT = "'Geist Variable', ui-sans-serif, system-ui, sans-serif"
