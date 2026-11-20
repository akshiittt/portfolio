import { useEffect, useRef } from 'react'

/*
  Two switches.
  MOTION: the drawing animations (map replay, plotted headings, figures).
    Always on; `?still` turns it off for testing. main.jsx mirrors it as the
    `motion` class on <html>, and every hidden "before" state in the CSS is
    scoped to html.motion, so before JS runs everything is drawn final.
  CALM: drops the moves that shift the whole view (pointer parallax, the
    camera pulling back on scroll, the title and legend parting). Off by
    default: the owner wants the full experience for every visitor, including
    those whose OS reports reduced motion (Windows "Animation effects" off is
    common on laptops). `?calm` turns it on. Mirrored as html.calm.
*/
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

export const MOTION = typeof window !== 'undefined' && !params.has('still')

export const CALM = typeof window !== 'undefined' && params.has('calm')

export const clamp01 = (x) => Math.min(Math.max(x, 0), 1)

/*
  Elements marked data-reveal get data-in once they first scroll into view.
  CSS decides what that means (a heading being plotted, a rule being drawn).
*/
export function useRevealAll() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]')
    const show = (el) => el.setAttribute('data-in', '')
    if (!MOTION || !('IntersectionObserver' in window)) {
      els.forEach(show)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show(e.target)
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

/*
  Calls cb(el) at most once per animation frame while the page scrolls or
  resizes. For scroll-scrubbed effects; cb should only write transforms,
  opacity or CSS custom properties.
*/
export function useScrollFrame(ref, cb, enabled = MOTION) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    let raf = 0
    const run = () => {
      raf = 0
      cbRef.current(el)
    }
    const request = () => {
      if (!raf) raf = requestAnimationFrame(run)
    }
    run()
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', request)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', request)
    }
  }, [ref, enabled])
}

/* Progress (0-1) of an element's top edge travelling from `from` to `to`, as fractions of the viewport height. */
export function travel(el, from = 0.9, to = 0.3) {
  const vh = window.innerHeight
  const top = el.getBoundingClientRect().top
  return clamp01((from * vh - top) / ((from - to) * vh))
}

/* A heading that is plotted left to right by a pen, once, when it enters view. */
export function Plot({ children, delay }) {
  return (
    <span className="plot" style={delay ? { '--plot-delay': `${delay}s` } : undefined}>
      <span className="plot-ink">{children}</span>
      <span className="plot-pen" aria-hidden="true" />
    </span>
  )
}
