import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { heightAt, mulberry32 } from './noise.js'

const PAPER = new THREE.Color('#E8ECE7')
const INK = new THREE.Color('#1B2733')
const CHART_BLUE = new THREE.Color('#2F5D8C')
const MAGENTA = new THREE.Color('#A3185F')

const W = 14
const D = 9
const CELL = 0.5 // grid cell size in world units (W and D are whole multiples)
const NX = Math.round(W / CELL)
const NZ = Math.round(D / CELL)
const DURATION = 6.2 // seconds for the replay
const INTRO = 1.3 // seconds for the sheet to ink in on first load
const STEM = 0.55

// Store locations the pipeline "discovers"
const STORES = [
  [-2.4, -2.2], [-0.8, -0.3], [0.8, -2.4], [1.9, -0.6],
  [3.5, -1.8], [3.1, 0.9], [0.9, 1.1], [4.9, -0.3],
]
// markers resolve left to right, like a scan across the sheet
const ORDER = STORES.map((s, i) => [s[0], i])
  .sort((a, b) => a[0] - b[0])
  .reduce((o, [, i], rank) => ((o[i] = rank), o), [])

/*
  Replay schedule, as fractions of DURATION:
  0.03-0.34  pings fall onto the sheet and settle
  0.38-0.78  occupied grid cells shade by density
  0.40-0.56  pings snap to their cell centres
  0.60-0.85  pings converge on the centroid and are absorbed
  0.78-1.00  store markers lock on, stems draw up
*/
const clamp01 = (x) => Math.min(Math.max(x, 0), 1)
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const cellsAt = (t) => smooth(0.38, 0.48, t) * (1 - smooth(0.66, 0.78, t))

function framing(narrow) {
  return narrow
    ? { pos: new THREE.Vector3(1.0, 11.5, 7.5), target: new THREE.Vector3(1.0, 0, 0.2) }
    : { pos: new THREE.Vector3(0.6, 5.4, 7.2), target: new THREE.Vector3(0.8, 0, 0.6) }
}
const isNarrow = (size) => size.width / size.height < 0.9

/* ---------- Seeded data shared by the pings and the density cells ---------- */

function makeSurvey(perStore) {
  const rnd = mulberry32(7)
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd())
  const start = []
  const grid = []
  const end = []
  const delay = []
  const jitter = []
  const counts = new Float32Array(NX * NZ)
  const lift = 0.025
  for (const [cx, cz] of STORES) {
    for (let i = 0; i < perStore; i++) {
      const spread = rnd() < 0.15 ? 1.4 : 0.55
      const x = cx + gauss() * spread
      const z = cz + gauss() * spread
      start.push(x, heightAt(x, z) + lift, z)
      const ix = Math.floor(x / CELL)
      const iz = Math.floor(z / CELL)
      const gx = (ix + 0.5) * CELL
      const gz = (iz + 0.5) * CELL
      grid.push(gx, heightAt(gx, gz) + lift, gz)
      end.push(cx, heightAt(cx, cz) + lift, cz)
      delay.push(rnd())
      jitter.push(rnd())
      const tx = ix + NX / 2
      const tz = iz + NZ / 2
      if (tx >= 0 && tx < NX && tz >= 0 && tz < NZ) counts[tz * NX + tx] += 1
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(start, 3))
  geometry.setAttribute('aGrid', new THREE.Float32BufferAttribute(grid, 3))
  geometry.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 3))
  geometry.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1))
  geometry.setAttribute('aJitter', new THREE.Float32BufferAttribute(jitter, 1))

  // ping density per grid cell, as a nearest-filtered texture the terrain samples
  const max = Math.max(...counts)
  const data = new Uint8Array(NX * NZ * 4)
  counts.forEach((n, i) => {
    data[i * 4] = Math.round(255 * Math.sqrt(n / max))
    data[i * 4 + 3] = 255
  })
  const density = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat)
  density.magFilter = THREE.NearestFilter
  density.minFilter = THREE.NearestFilter
  density.needsUpdate = true

  return { geometry, density }
}

/* ---------- Terrain: contour lines + survey grid, drawn in ink ---------- */

const terrainVert = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vPos = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const terrainFrag = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform vec3 uBlue;
  uniform vec3 uMagenta;
  uniform vec2 uHalf;
  uniform vec2 uOrigin;
  uniform float uCell;
  uniform float uReveal;
  uniform float uCells;
  uniform sampler2D uDensity;
  varying vec3 vPos;
  varying vec3 vNormal;

  // Anti-aliased isoline of a fixed pixel width at every integer value of v.
  // Lines that crowd closer than a few pixels fade out instead of turning to mush.
  float isoline(float v, float px) {
    float fw = max(fwidth(v), 1e-5);
    float d = abs(fract(v - 0.5) - 0.5) / fw;
    float line = 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, d);
    return line * smoothstep(3.0, 8.0, 1.0 / fw);
  }

  void main() {
    // ink spreads outward from the middle of the sheet on first load
    float rd = length((vPos.xz - uOrigin) / uHalf);
    float ink = 1.0 - smoothstep(uReveal * 1.9 - 0.35, uReveal * 1.9, rd);

    float shade = clamp(dot(normalize(vNormal), normalize(vec3(-0.5, 0.9, 0.3))), 0.0, 1.0);
    vec3 col = uPaper * mix(1.0, 0.9 + 0.1 * shade, ink);

    // occupied cells shade by ping density while the pings snap to them
    vec2 uv = (vPos.xz + uHalf) / (2.0 * uHalf);
    col = mix(col, uMagenta, texture2D(uDensity, uv).r * uCells * 0.3);

    // survey grid
    vec2 g = vPos.xz / uCell;
    float grid = max(isoline(g.x, 1.0), isoline(g.y, 1.0));
    col = mix(col, uBlue, grid * 0.2 * ink);

    // contours every 0.12 units, index contour every 5th
    float h = vPos.y / 0.12;
    col = mix(col, uInk, isoline(h, 1.0) * 0.3 * ink);
    col = mix(col, uInk, isoline(h / 5.0, 1.7) * 0.68 * ink);

    // dissolve the sheet's edges into the page
    vec2 r = abs(vPos.xz) / uHalf;
    col = mix(col, uPaper, smoothstep(0.55, 0.98, max(r.x, r.y * 1.05)));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function Terrain({ density, timeline, intro, scroll }) {
  const geometry = useMemo(() => {
    // lighter mesh on phones: same terrain, about a third of the vertices
    const fine = window.innerWidth > 760
    const geo = new THREE.PlaneGeometry(W, D, fine ? 280 : 168, fine ? 180 : 108)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
    }
    geo.computeVertexNormals()
    return geo
  }, [])

  const uniforms = useMemo(
    () => ({
      uPaper: { value: PAPER },
      uInk: { value: INK },
      uBlue: { value: CHART_BLUE },
      uMagenta: { value: MAGENTA },
      uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      uOrigin: { value: new THREE.Vector2(0.8, 0.0) },
      uCell: { value: CELL },
      uReveal: { value: intro.current },
      uCells: { value: 0 },
      uDensity: { value: density },
    }),
    [density, intro],
  )

  useFrame(() => {
    // the ink recedes back to the middle of the sheet as the hero scrolls away
    uniforms.uReveal.value = easeOut(intro.current) * (1 - smooth(0.06, 0.9, scroll.current))
    uniforms.uCells.value = cellsAt(timeline.current)
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial vertexShader={terrainVert} fragmentShader={terrainFrag} uniforms={uniforms} />
    </mesh>
  )
}

/* ---------- GPS pings: fall -> snap to grid -> absorbed at the centroid ---------- */

const pointsVert = /* glsl */ `
  attribute vec3 aGrid;
  attribute vec3 aEnd;
  attribute float aDelay;
  attribute float aJitter;
  uniform float uT;
  uniform float uPx;
  uniform float uDpr;
  uniform float uRef;
  varying float vAlpha;

  float inOut(float x) {
    x = clamp(x, 0.0, 1.0);
    return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
  }

  void main() {
    // fall under gravity, then land with a small ink-blot settle
    float t0 = 0.03 + aDelay * 0.24;
    float fall = clamp((uT - t0) / 0.07, 0.0, 1.0);
    float settle = clamp((uT - t0 - 0.07) / 0.05, 0.0, 1.0);
    vec3 p = position;
    p.y += (1.0 - fall * fall) * 1.6;
    float size = mix(0.55, 1.0, fall) * (1.0 + 0.35 * sin(settle * 3.14159));

    // snap to the Haversine grid cell
    p = mix(p, aGrid, inOut((uT - 0.40 - aJitter * 0.04) / 0.12));

    // converge on the time-weighted centroid and get absorbed by the marker
    float pull = inOut((uT - 0.60 - aJitter * 0.08) / 0.17);
    p = mix(p, aEnd, pull);

    vAlpha = smoothstep(0.0, 0.35, fall) * 0.92 * (1.0 - smoothstep(0.6, 1.0, pull));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uPx * uDpr * size * uRef / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const pointsFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float aa = fwidth(d) * 1.2;
    float a = 1.0 - smoothstep(0.5 - aa, 0.5, d);
    if (a * vAlpha < 0.004) discard;
    gl_FragColor = vec4(uColor, vAlpha * a);
    #include <colorspace_fragment>
  }
`

function Pings({ geometry, timeline, compact }) {
  const { gl, size } = useThree()
  const narrow = isNarrow(size)
  const uniforms = useMemo(
    () => ({
      uT: { value: 0 },
      uPx: { value: 4.5 },
      uDpr: { value: 1 },
      uRef: { value: 1 },
      uColor: { value: MAGENTA },
    }),
    [],
  )

  useEffect(() => {
    // points keep the same on-screen size whichever framing is in use
    const { pos, target } = framing(narrow)
    uniforms.uRef.value = pos.distanceTo(target)
    uniforms.uPx.value = compact ? 4 : 4.5
  }, [narrow, compact, uniforms])

  useFrame(() => {
    uniforms.uT.value = timeline.current
    uniforms.uDpr.value = gl.getPixelRatio()
  })

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={1}>
      <shaderMaterial
        vertexShader={pointsVert}
        fragmentShader={pointsFrag}
        uniforms={uniforms}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </points>
  )
}

/* ---------- Resolved store markers ---------- */

const ringGeo = new THREE.RingGeometry(0.135, 0.17, 64)
const dotGeo = new THREE.CircleGeometry(0.04, 32)
const stemGeo = new THREE.CylinderGeometry(0.0065, 0.0065, STEM, 6).translate(0, STEM / 2, 0)
const headGeo = new THREE.SphereGeometry(0.036, 16, 12)

function Marker({ x, z, order, timeline, scroll, scale }) {
  const ring = useRef()
  const dot = useRef()
  const stem = useRef()
  const head = useRef()
  const y = heightAt(x, z)

  useFrame(() => {
    const t = timeline.current
    const s0 = 0.78 + order * 0.018
    const fade = 1 - smooth(0.35, 0.75, scroll.current)
    // ring locks on: closes in from wide and darkens
    const a = easeOut((t - s0) / 0.07)
    ring.current.scale.setScalar(1.9 - 0.9 * a)
    ring.current.material.opacity = a * fade
    dot.current.material.opacity = a * fade
    stem.current.material.opacity = fade
    head.current.material.opacity = fade
    // stem draws up from the centroid, then the head is set
    const b = easeOut((t - s0 - 0.035) / 0.06)
    stem.current.visible = b > 0
    stem.current.scale.y = Math.max(b, 1e-4)
    const c = easeOut((t - s0 - 0.085) / 0.04)
    head.current.visible = c > 0
    head.current.scale.setScalar(Math.max(c, 1e-4))
  })

  return (
    <group position={[x, y + 0.03, z]} scale={scale}>
      <mesh ref={ring} geometry={ringGeo} rotation-x={-Math.PI / 2} renderOrder={2}>
        <meshBasicMaterial color={MAGENTA} transparent depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={dot} geometry={dotGeo} rotation-x={-Math.PI / 2} renderOrder={2}>
        <meshBasicMaterial color={MAGENTA} transparent depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={stem} geometry={stemGeo} renderOrder={3}>
        <meshBasicMaterial color={INK} transparent depthTest={false} />
      </mesh>
      <mesh ref={head} geometry={headGeo} position={[0, STEM, 0]} renderOrder={3}>
        <meshBasicMaterial color={INK} transparent depthTest={false} />
      </mesh>
    </group>
  )
}

/* ---------- Camera: framing per aspect, pointer parallax, scroll pull-back ---------- */

function Rig({ still, scroll }) {
  // `still` here means "camera stays put": no motion at all, or a calm reader
  const { camera, size, gl, invalidate } = useThree()
  const narrow = isNarrow(size)
  const { pos, target } = useMemo(() => framing(narrow), [narrow])
  const pointer = useRef({ x: 0, y: 0 })
  const parallax = useRef(new THREE.Vector2())

  useEffect(() => {
    camera.position.copy(pos)
    camera.lookAt(target)
    invalidate()
  }, [camera, pos, target, invalidate])

  useEffect(() => {
    if (still) return
    const hero = gl.domElement.closest('.hero')
    const onMove = (e) => {
      if (e.pointerType === 'touch') return
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = 1 - (e.clientY / window.innerHeight) * 2
      invalidate()
    }
    const onScroll = () => {
      if (!hero) return
      const r = hero.getBoundingClientRect()
      const p = Math.min(Math.max(-r.top / (r.height * 0.85), 0), 1)
      if (p !== scroll.current) {
        scroll.current = p
        invalidate()
      }
    }
    onScroll()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
    }
  }, [still, gl, scroll, invalidate])

  useFrame((_, delta) => {
    if (still) return
    // parallax eases toward the pointer; the scroll pull-back is applied directly
    // so it stays locked to the scrollbar
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 2.5)
    const par = parallax.current
    const px = pointer.current.x * 0.5
    const py = pointer.current.y * 0.25
    par.x += (px - par.x) * k
    par.y += (py - par.y) * k
    const lift = smooth(0, 1, scroll.current)
    camera.position.set(
      pos.x + par.x,
      pos.y + par.y + lift * (narrow ? 2.2 : 2.8),
      pos.z + lift * (narrow ? 2.0 : 1.6),
    )
    camera.lookAt(target)
    if (Math.abs(px - par.x) + Math.abs(py - par.y) > 1e-4) invalidate()
  })
  return null
}

/* ---------- Clock: renders on demand, only while something is moving ---------- */

function Clock({ timeline, intro, runId, still, active }) {
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    timeline.current = still ? 1 : 0
    if (still) intro.current = 1
    invalidate()
  }, [runId, still, timeline, intro, invalidate])

  useEffect(() => {
    if (active) invalidate()
  }, [active, invalidate])

  useFrame((_, delta) => {
    if (still) return
    // clamped so a paused or throttled tab resumes where it left off
    const dt = Math.min(delta, 1 / 20)
    intro.current = Math.min(intro.current + dt / INTRO, 1)
    if (intro.current > 0.3) timeline.current = Math.min(timeline.current + dt / DURATION, 1)
    if (timeline.current < 1 || intro.current < 1) invalidate()
  })
  return null
}

export default function SurveyMap({ runId, still, calm = false, compact, active = true }) {
  const timeline = useRef(still ? 1 : 0)
  const intro = useRef(still ? 1 : 0)
  const scroll = useRef(0)
  const survey = useMemo(() => makeSurvey(compact ? 28 : 60), [compact])
  useEffect(() => () => {
    survey.geometry.dispose()
    survey.density.dispose()
  }, [survey])

  return (
    <Canvas
      className="survey-map"
      frameloop={active ? 'demand' : 'never'}
      dpr={[1, 2]}
      camera={{ fov: 34, near: 0.1, far: 60 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => gl.setClearColor(PAPER)}
      aria-hidden="true"
    >
      <Clock timeline={timeline} intro={intro} runId={runId} still={still} active={active} />
      <Rig still={still || calm} scroll={scroll} />
      <Terrain density={survey.density} timeline={timeline} intro={intro} scroll={scroll} />
      <Pings geometry={survey.geometry} timeline={timeline} compact={compact} />
      {STORES.map(([x, z], i) => (
        <Marker key={i} x={x} z={z} order={ORDER[i]} timeline={timeline} scroll={scroll} scale={compact ? 1.3 : 1} />
      ))}
    </Canvas>
  )
}
