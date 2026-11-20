import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { PipelineFigure, LatencyFigure } from './figures.jsx'
import { MOTION, CALM, Plot, clamp01, useRevealAll, useScrollFrame } from './motion.jsx'
import {
  EMAIL, PHONE, PHONE_HREF, LINKEDIN, GITHUB, RESUME, HOSTEL,
  SKILLS, COURSEWORK, CERTIFICATIONS,
} from './content.js'

const SurveyMap = lazy(() => import('./SurveyMap.jsx'))

function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

function useOnScreen(ref, rootMargin = '0px') {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin })
    if (ref.current) io.observe(ref.current)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return on
}

const NAV = [
  ['work', 'Work'],
  ['project', 'Project'],
  ['skills', 'Skills'],
  ['contact', 'Contact'],
]

function ResumeLink() {
  return (
    <a href={RESUME}>
      Résumé<span className="pdf-hint"> (PDF)</span>
    </a>
  )
}

/* ---------- Hero ---------- */

function Hero({ heroRef, visible }) {
  const still = !MOTION
  const compact = useMedia('(max-width: 760px)')
  const [runId, setRunId] = useState(0)

  // Start the 3D only after the page has loaded and painted, so the name and
  // text appear immediately and the heavy WebGL setup doesn't block them.
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    let idle = 0
    let timer = 0
    const go = () => {
      const ric = window.requestIdleCallback
      if (ric) idle = ric(() => setMapReady(true), { timeout: 900 })
      else timer = setTimeout(() => setMapReady(true), 200)
    }
    if (document.readyState === 'complete') go()
    else window.addEventListener('load', go, { once: true })
    return () => {
      window.removeEventListener('load', go)
      if (idle) window.cancelIdleCallback(idle)
      clearTimeout(timer)
    }
  }, [])

  // scroll progress out of the hero, 0-1, for the CSS that parts the title and legend
  useScrollFrame(
    heroRef,
    (el) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--hp', clamp01(-r.top / (r.height * 0.85)).toFixed(4))
    },
    MOTION && !CALM,
  )

  return (
    <header className="hero" id="top" ref={heroRef}>
      {mapReady && (
        <Suspense fallback={null}>
          <SurveyMap runId={runId} still={still} calm={CALM} compact={compact} active={visible} />
        </Suspense>
      )}

      <nav className="topbar" aria-label="Primary">
        <p className="coords">New Delhi, 28.61° N 77.21° E</p>
        <ul>
          {NAV.map(([id, label]) => (
            <li key={id}><a href={`#${id}`}>{label}</a></li>
          ))}
          <li><ResumeLink /></li>
        </ul>
      </nav>

      <div className="title-block">
        <h1 data-reveal>
          <Plot delay={0.25}>Akshit</Plot> <Plot delay={0.6}>Kalra</Plot>
        </h1>
        <p className="lede">
          I build data pipelines and the web apps that sit on top of them. At Airtel I wrote a PySpark
          pipeline that turns raw GPS transaction data into store locations. I’m a third-year computer
          science student at VIT Vellore, looking for a software engineering internship.
        </p>
      </div>

      <aside className="legend" aria-label="What the map shows">
        <div className="legend-head">
          <h2>Legend</h2>
          {!still && (
            <button type="button" onClick={() => setRunId((n) => n + 1)}>
              Replay
            </button>
          )}
        </div>
        <ul>
          <li><span className="key key-ping" aria-hidden="true" />GPS transaction</li>
          <li><span className="key key-cell" aria-hidden="true" />Haversine grid cell</li>
          <li><span className="key key-store" aria-hidden="true" />Resolved store, time-weighted centroid</li>
        </ul>
        <p>A simplified replay of the store-location pipeline I built at Airtel.</p>
      </aside>
    </header>
  )
}

/*
  Condensed nav, shown once the hero has scrolled away. Its bottom edge is a
  route line: magenta up to the current scroll position, with a waypoint at
  each section.
*/
function Minibar({ show }) {
  const ref = useRef(null)
  const [current, setCurrent] = useState(null)
  const [stops, setStops] = useState([])

  useEffect(() => {
    const measure = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setStops(
        NAV.map(([id]) => {
          const el = document.getElementById(id)
          return el && max > 0 ? clamp01((el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.4) / max) : 0
        }),
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])

  useScrollFrame(
    ref,
    (el) => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? clamp01(window.scrollY / max) : 0
      el.style.setProperty('--route', p.toFixed(4))
      let at = null
      NAV.forEach(([id], i) => {
        if (p >= stops[i] - 0.001) at = id
      })
      setCurrent((c) => (c === at ? c : at))
    },
    true,
  )

  return (
    <nav className="minibar" data-show={show || undefined} aria-label="Sections" ref={ref}>
      <a className="minibar-name" href="#top">Akshit Kalra</a>
      <ul>
        {NAV.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={current === id ? 'location' : undefined}>{label}</a>
          </li>
        ))}
        <li><ResumeLink /></li>
      </ul>
      <div className="route" aria-hidden="true">
        <span className="route-done" />
        {stops.map((f, i) => (
          <span
            key={NAV[i][0]}
            className="route-stop"
            data-passed={current && NAV.findIndex(([id]) => id === current) >= i ? '' : undefined}
            style={{ left: `${f * 100}%` }}
          />
        ))}
      </div>
    </nav>
  )
}

/* ---------- Sections ---------- */

function Section({ id, title, children }) {
  return (
    <section id={id} className="section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title" data-reveal>
        <Plot>{title}</Plot>
      </h2>
      {children}
    </section>
  )
}

function Entry({ meta, children }) {
  return (
    <article className="entry" data-reveal>
      <div className="entry-meta">{meta}</div>
      <div className="entry-body">{children}</div>
    </article>
  )
}

function Work() {
  return (
    <Section id="work" title="Work">
      <Entry
        meta={
          <>
            <p className="when">May – Jun 2026</p>
            <p>Gurugram</p>
          </>
        }
      >
        <h3>Engineering intern, Xtelify / Airtel Digital</h3>
        <p className="entry-lede">
          The job: work out where each store in Airtel’s Mitra retail network actually is, using only its
          GPS transaction data. I owned the pipeline end to end.
        </p>
        <PipelineFigure />
        <ul className="facts">
          <li>Predicted store coordinates reached <strong>90%+ confidence scores</strong>, and agreed closely with real store addresses.</li>
          <li>Built the verification layer with Nominatim reverse geocoding and interactive Folium map overlays.</li>
          <li>Improved reliability release by release with a test-and-refine loop, a fixed output schema and every change in Git.</li>
          <li>Before the capstone, completed Airtel’s hands-on Spring Boot, Kafka, Hadoop and Docker curriculum.</li>
        </ul>
      </Entry>

      <Entry
        meta={
          <>
            <p className="when">May – Jun 2025</p>
            <p>New Delhi</p>
          </>
        }
      >
        <h3>IT intern, ANAND Group India</h3>
        <ul className="facts">
          <li>Wrote and tested Python scripts that cut manual processing time on recurring tasks by <strong>about 40%</strong>.</li>
          <li>Cleaned and analysed 1,000+ operational records with pandas for two reports to senior stakeholders.</li>
          <li>Debugged 15+ IT issues and documented root causes; first-response resolution time improved by <strong>about 25%</strong>.</li>
        </ul>
      </Entry>
    </Section>
  )
}

function Project() {
  return (
    <Section id="project" title="Project">
      <Entry
        meta={
          <>
            <p className="when">Full-stack web app</p>
            <p>React, Node.js, Express, MongoDB Atlas, Vercel</p>
            <p className="links">
              <a href={HOSTEL.live}>Live site</a>
              <a href={HOSTEL.code}>Source on GitHub</a>
            </p>
          </>
        }
      >
        <h3>VIT Hostel Complaint System</h3>
        <p className="entry-lede">
          Hostel complaints at VIT were reported informally and never tracked. I built a system where
          students file complaints, wardens work through them, and everyone sees the status live.
        </p>

        <h4>Making it fast</h4>
        <p>
          Requests felt slow, so I timed them. The serverless API ran in one region and the database in
          another, so every query crossed between them. Moving the API next to the database made it about
          five times faster.
        </p>
        <LatencyFigure />

        <div className="split">
          <div>
            <h4>Making it safe</h4>
            <ul className="facts">
              <li>Passwords hashed with bcrypt; JWT sessions that can be revoked.</li>
              <li>Rate limiting backed by MongoDB.</li>
              <li>Input validation that blocks NoSQL injection.</li>
              <li>A strict Content Security Policy.</li>
              <li>Student and warden roles enforced on the server.</li>
            </ul>
          </div>
          <div>
            <h4>Making sure it works</h4>
            <ul className="facts">
              <li><strong>240+ automated tests</strong>: unit, API, database and full user journeys.</li>
              <li><strong>~98%</strong> backend line coverage.</li>
              <li>GitHub Actions runs everything on each push, then smoke-checks the live deploy.</li>
            </ul>
          </div>
        </div>

        <dl className="lighthouse" aria-label="Lighthouse mobile scores" data-reveal>
          <div><dt>Performance</dt><dd>99</dd></div>
          <div><dt>Accessibility</dt><dd>100</dd></div>
          <div><dt>Best practices</dt><dd>100</dd></div>
          <div><dt>SEO</dt><dd>100</dd></div>
        </dl>
        <p className="note">Lighthouse scores on mobile.</p>
      </Entry>
    </Section>
  )
}

function Skills() {
  return (
    <Section id="skills" title="Skills and study">
      <Entry meta={<p className="when">What I work with</p>}>
        <dl className="skills">
          {SKILLS.map((s) => (
            <div key={s.group}>
              <dt>{s.group}</dt>
              <dd>{s.items.join(', ')}</dd>
            </div>
          ))}
        </dl>
      </Entry>
      <Entry
        meta={
          <>
            <p className="when">Expected Jul 2028</p>
            <p>Vellore</p>
          </>
        }
      >
        <h3>B.Tech in Computer Science, Vellore Institute of Technology</h3>
        <p>Specialising in the Internet of Things. CGPA 8.31 / 10. Coursework includes {COURSEWORK.slice(0, -1).join(', ')} and {COURSEWORK.at(-1)}.</p>
      </Entry>
      <Entry meta={<p className="when">Certifications</p>}>
        <dl className="skills">
          {CERTIFICATIONS.map((c) => (
            <div key={c.issuer}>
              <dt>{c.issuer}</dt>
              <dd>{c.names.join(', ')}</dd>
            </div>
          ))}
        </dl>
      </Entry>
    </Section>
  )
}

function Outside() {
  return (
    <Section id="outside" title="Outside class">
      <Entry
        meta={
          <>
            <p className="when">2024 – now</p>
            <p>VIT Vellore</p>
          </>
        }
      >
        <h3>Clubs at VIT</h3>
        <ul className="facts">
          <li><strong>Leo Club:</strong> community service and social-impact projects.</li>
          <li><strong>Dream Merchant VIT:</strong> the business, stocks and finance club, with workshops and events on markets and business strategy.</li>
        </ul>
      </Entry>
      <Entry
        meta={
          <>
            <p className="when">2014 – 2024</p>
            <p>New Delhi</p>
          </>
        }
      >
        <h3>Rotary, Interact and school</h3>
        <ul className="facts">
          <li>Went to Florida for seven days on a Rotary International cultural exchange, then helped host the visiting group in Delhi.</li>
          <li>Member of the Rotary-sponsored Interact Club from 2022 to 2024, and of the Rotary Club before that.</li>
          <li>Organised inter- and intra-school Model UN conferences at Amity International School; member of the Student Council.</li>
        </ul>
      </Entry>
    </Section>
  )
}

function Contact() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.location.href = `mailto:${EMAIL}`
    }
  }
  return (
    <section id="contact" className="contact" aria-labelledby="contact-title">
      <h2 id="contact-title" className="section-title" data-reveal>
        <Plot>Get in touch</Plot>
      </h2>
      <p className="contact-lede">
        I’m looking for a software engineering internship. Email is the quickest way to reach me.
      </p>
      <div className="contact-email">
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        <button type="button" onClick={copy} aria-live="polite">
          {copied ? 'Copied' : 'Copy email'}
        </button>
      </div>
      <ul className="contact-links">
        <li><a href={PHONE_HREF}>{PHONE}</a></li>
        <li><a href={LINKEDIN}>LinkedIn</a></li>
        <li><a href={GITHUB}>GitHub</a></li>
        <li><a href={RESUME}>Résumé (PDF)</a></li>
      </ul>
      <p className="colophon">
        Built with React and Three.js. The terrain at the top is generated, not a real place.
      </p>
    </section>
  )
}

export default function App() {
  const heroRef = useRef(null)
  const heroVisible = useOnScreen(heroRef)
  // the condensed nav takes over once the hero is about to leave under it
  const heroUnderBar = useOnScreen(heroRef, '-96px 0px 0px 0px')
  useRevealAll()
  return (
    <>
      <Minibar show={!heroUnderBar} />
      <Hero heroRef={heroRef} visible={heroVisible} />
      <main>
        <Work />
        <Project />
        <Skills />
        <Outside />
      </main>
      <Contact />
    </>
  )
}
