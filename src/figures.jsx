import { useEffect, useMemo, useRef } from 'react'
import { mulberry32 } from './noise.js'
import { MOTION, clamp01, travel, useScrollFrame } from './motion.jsx'

/*
  Small multiples of the Airtel pipeline, drawn like four map insets.
  Same seeded points in every panel so the reader can follow them.

  With motion on, the figure is scrubbed by scroll: as it travels up the
  viewport each panel plays its step in turn (--k1 ... --k4, 0-1). The CSS
  turns those into ping drops, cell fills, pull lines drawing in and the
  match tag being set. Scrolling back reverses it.
*/
const SIZE = 132
const CELL = 22
const STORE = { x: 70, y: 62 }

function usePings() {
  return useMemo(() => {
    const rnd = mulberry32(11)
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd())
    return Array.from({ length: 34 }, () => {
      const wide = rnd() < 0.18
      const x = STORE.x + gauss() * (wide ? 30 : 15)
      const y = STORE.y + gauss() * (wide ? 30 : 15)
      const px = Math.min(Math.max(x, 8), SIZE - 8)
      const py = Math.min(Math.max(y, 8), SIZE - 8)
      return {
        x: px,
        y: py,
        d: rnd(), // stagger
        len: Math.hypot(STORE.x - px, STORE.y - py),
      }
    })
  }, [])
}

function Grid() {
  const lines = []
  for (let v = CELL; v < SIZE; v += CELL) {
    lines.push(<line key={`v${v}`} x1={v} y1={0} x2={v} y2={SIZE} />)
    lines.push(<line key={`h${v}`} x1={0} y1={v} x2={SIZE} y2={v} />)
  }
  return <g className="fig-grid">{lines}</g>
}

function Contours() {
  return (
    <g className="fig-contour">
      <ellipse cx={58} cy={70} rx={52} ry={38} />
      <ellipse cx={62} cy={66} rx={34} ry={24} />
      <ellipse cx={66} cy={62} rx={16} ry={11} />
    </g>
  )
}

function Panel({ step, title, under, children, caption }) {
  return (
    <li className="fig-panel">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={title}>
        <Contours />
        {under}
        {children}
        <rect className="fig-frame" x={0.75} y={0.75} width={SIZE - 1.5} height={SIZE - 1.5} />
      </svg>
      <p className="fig-title">
        <span className="fig-step">{step}</span>
        {title}
      </p>
      <p className="fig-caption">{caption}</p>
    </li>
  )
}

// each panel plays over its own slice of the scroll, overlapping slightly
const SLICES = [
  [0.0, 0.34],
  [0.24, 0.56],
  [0.46, 0.8],
  [0.7, 1.0],
]

export function PipelineFigure() {
  const ref = useRef(null)
  const pings = usePings()
  const cells = useMemo(() => {
    const m = new Map()
    for (const p of pings) {
      const cx = Math.floor(p.x / CELL)
      const cy = Math.floor(p.y / CELL)
      const k = `${cx},${cy}`
      m.set(k, { cx, cy, n: (m.get(k)?.n || 0) + 1 })
    }
    // densest cells fill first
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [pings])
  const max = cells[0].n

  useScrollFrame(ref, (el) => {
    const p = travel(el, 0.92, 0.32)
    SLICES.forEach(([a, b], i) => {
      el.style.setProperty(`--k${i + 1}`, clamp01((p - a) / (b - a)).toFixed(3))
    })
  })

  return (
    <figure className="pipeline-figure" ref={ref}>
      <ol className="fig-panels">
        <Panel step="1" title="Raw GPS" caption="Transactions arrive with noisy coordinates.">
          {pings.map((p, i) => (
            <circle key={i} className="fig-ping" cx={p.x} cy={p.y} r={2.4} style={{ '--d': p.d }} />
          ))}
        </Panel>
        <Panel
          step="2"
          title="Grid"
          caption="PySpark fingerprints each ping onto a Haversine-distance grid."
          under={cells.map((c, i) => (
            <rect
              key={`${c.cx},${c.cy}`}
              className="fig-cell"
              x={c.cx * CELL}
              y={c.cy * CELL}
              width={CELL}
              height={CELL}
              style={{ '--o': (0.15 + 0.75 * (c.n / max)).toFixed(3), '--d': (i / cells.length).toFixed(3) }}
            />
          ))}
        >
          <Grid />
        </Panel>
        <Panel step="3" title="Centroid" caption="Each store resolves to a time-weighted centroid.">
          <Grid />
          {pings.map((p, i) => (
            <circle key={`s${i}`} className="fig-ping-faint" cx={p.x} cy={p.y} r={1.6} />
          ))}
          {pings.map((p, i) => (
            <line
              key={i}
              className="fig-pull"
              x1={p.x}
              y1={p.y}
              x2={STORE.x}
              y2={STORE.y}
              style={{ '--len': `${p.len.toFixed(1)}px`, '--d': p.d }}
            />
          ))}
          <circle className="fig-store fig-lock" cx={STORE.x} cy={STORE.y} r={7} />
        </Panel>
        <Panel step="4" title="Verify" caption="Reverse geocoding with Nominatim checks it against the real address.">
          <circle className="fig-store fig-verify" cx={STORE.x} cy={STORE.y} r={7} />
          <line className="fig-leader" x1={STORE.x + 5} y1={STORE.y - 5} x2={STORE.x + 26} y2={STORE.y - 30} />
          <g className="fig-tag-group">
            <rect className="fig-tag" x={STORE.x + 4} y={STORE.y - 48} width={54} height={18} />
            <text className="fig-tag-text" x={STORE.x + 31} y={STORE.y - 35.5} textAnchor="middle">
              match
            </text>
          </g>
        </Panel>
      </ol>
    </figure>
  )
}

/*
  Latency comparison drawn as two map scale bars. One segment = 0.1 s.
  With motion on, each bar fills in real time when the figure comes into
  view: first the 1.1 s request, then the 0.2 s one. The readout is a
  stopwatch for the bar it sits on.
*/
const MAX_S = 1.2
const BARS = [
  { seconds: 1.1, label: 'API in a different region from the database' },
  { seconds: 0.2, label: 'API moved next to the database', accent: true },
]
const GAP = 0.45 // pause between the two runs, seconds

function ScaleBar({ seconds, label, accent, fillRef, readRef }) {
  const pct = (seconds / MAX_S) * 100
  return (
    <div className="scale-row">
      <p className="scale-label">{label}</p>
      <div className="scale-track">
        <div className="scale-fill" style={{ width: `${pct}%` }} ref={fillRef}>
          <div
            className={`scale-bar${accent ? ' is-accent' : ''}`}
            style={{ '--seg': `${(0.1 / seconds) * 100}%` }}
          />
          <div className="scale-head">
            <span className="scale-value">
              <span aria-hidden="true" ref={readRef}>{seconds.toFixed(1)} s</span>
              <span className="sr-only">{seconds.toFixed(1)} seconds</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function LatencyFigure() {
  const ref = useRef(null)
  const fills = [useRef(null), useRef(null)]
  const reads = [useRef(null), useRef(null)]

  useEffect(() => {
    const fig = ref.current
    if (!MOTION || !fig || !('IntersectionObserver' in window)) return
    const set = (i, f) => {
      fills[i].current.style.setProperty('--f', f.toFixed(4))
      reads[i].current.textContent = `${(BARS[i].seconds * f).toFixed(1)} s`
    }
    BARS.forEach((_, i) => set(i, 0))
    fig.dataset.armed = ''

    let raf = 0
    const run = () => {
      const t0 = performance.now()
      const tick = (now) => {
        const e = (now - t0) / 1000
        const f0 = clamp01(e / BARS[0].seconds)
        const f1 = clamp01((e - BARS[0].seconds - GAP) / BARS[1].seconds)
        set(0, f0)
        set(1, f1)
        fills[0].current.toggleAttribute('data-live', f0 > 0 && f0 < 1)
        fills[1].current.toggleAttribute('data-live', f1 > 0 && f1 < 1)
        fills[1].current.toggleAttribute('data-started', f1 > 0)
        if (f1 < 1) raf = requestAnimationFrame(tick)
      }
      fills[0].current.setAttribute('data-started', '')
      raf = requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          io.disconnect()
          run()
        }
      },
      { threshold: 0.6 },
    )
    io.observe(fig)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <figure className="latency-figure" ref={ref}>
      {BARS.map((b, i) => (
        <ScaleBar key={b.label} {...b} fillRef={fills[i]} readRef={reads[i]} />
      ))}
      <div className="scale-axis" aria-hidden="true">
        {[0, 0.4, 0.8, 1.2].map((t) => (
          <span key={t} style={{ left: `${(t / MAX_S) * 100}%` }}>
            {t === 0 ? '0' : `${t.toFixed(1)} s`}
          </span>
        ))}
      </div>
      <figcaption>
        Typical API response time, measured before and after the move. Each segment is 0.1 s
        {MOTION ? '; the bars fill at real speed.' : '.'}
      </figcaption>
    </figure>
  )
}
