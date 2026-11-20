// Seeded random + 2D gradient noise, shared by the terrain and the GPS points
// so points sit exactly on the surface they land on.

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(2028)
const perm = Array.from({ length: 256 }, (_, i) => i)
for (let i = 255; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1))
  ;[perm[i], perm[j]] = [perm[j], perm[i]]
}
const p = new Uint8Array(512)
for (let i = 0; i < 512; i++) p[i] = perm[i & 255]

const G = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
]

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t

function noise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const X = xi & 255
  const Y = yi & 255
  const g = (h, dx, dy) => {
    const v = G[h & 7]
    return v[0] * dx + v[1] * dy
  }
  const n00 = g(p[X + p[Y]], xf, yf)
  const n10 = g(p[X + 1 + p[Y]], xf - 1, yf)
  const n01 = g(p[X + p[Y + 1]], xf, yf - 1)
  const n11 = g(p[X + 1 + p[Y + 1]], xf - 1, yf - 1)
  const u = fade(xf)
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(yf))
}

// Terrain height at world (x, z)
export function heightAt(x, z) {
  return (
    noise(x * 0.22 + 3.1, z * 0.22 + 1.7) * 1.25 +
    noise(x * 0.55 + 8.2, z * 0.55 + 4.4) * 0.38 +
    noise(x * 1.3 + 1.9, z * 1.3 + 9.6) * 0.1
  )
}
