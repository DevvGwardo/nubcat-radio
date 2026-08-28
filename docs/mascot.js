/**
 * nubcat radio — the REAL animated nubcat mascot.
 *
 * Mounts maiavm-desktop's verbatim Grok Bot mark engine (`vzt`, vendored at
 * ./vendor/grok-orb-core.js) without a build step: React + ReactDOM come from
 * esm.sh via the import map in index.html, and each `[data-mascot]` host in
 * the page gets its own root. If this module (or the CDN) fails to load, the
 * static <img> fallback inside each host simply stays visible.
 *
 * The engine's root <svg> reads var(--fg) (orb body) and var(--bg) (eye
 * whites) through CSS inheritance, so each host is wrapped in a span that
 * carries the Maia brand vars — same trick as maiavm's GrokOrb wrapper.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { vzt } from './vendor/grok-orb-core.js'

const FG = '#b7d9ff' // nubcat blue orb body (maiavm GROK_BODY)
const BG = '#1a3d6b' // navy eye whites (maiavm GROK_EYE)

const prefersReduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

const hosts = []
let sharedState = 'idle'
let sharedGaze = null

function renderHost(h) {
  const Engine = vzt
  h.root.render(
    React.createElement(Engine, {
      ref: h.ref,
      state: h.state ?? sharedState,
      shape: 'cat',
      size: h.size,
      paused: h.paused || prefersReduced(),
      gazeTarget: sharedGaze,
    }),
  )
}

function renderAll() {
  for (const h of hosts) renderHost(h)
}

/**
 * Mount the mark into a host element that contains a static <img> fallback.
 * data-mascot="132" → rendered svg size in px. On success the host gets
 * `data-engine="on"` (CSS hides the fallback img).
 */
function mount(host) {
  const size = parseInt(host.dataset.mascot, 10) || 32

  // Wrapper span carries --fg/--bg — the engine svg never takes a style prop.
  const wrap = document.createElement('span')
  wrap.style.cssText =
    'position:relative;display:inline-block;line-height:0;--fg:' + FG + ';--bg:' + BG + ';'
  host.appendChild(wrap)

  const h = {
    host,
    size,
    state: null, // null → follow sharedState
    paused: false,
    ref: React.createRef(),
    root: createRoot(wrap),
  }
  hosts.push(h)
  renderHost(h)
  host.dataset.engine = 'on'
  return h
}

document.querySelectorAll('[data-mascot]').forEach(mount)

/** Public API — drives every mounted mark at once. */
window.nubMascot = {
  /** state: idle | listening | sleeping | loading | happy | searching | … (39 states) */
  setState(s) {
    sharedState = s
    renderAll()
  },
  /** Screen-space point for gaze drift, or null to release. */
  setGaze(p) {
    sharedGaze = p
    renderAll()
  },
  bounce() {
    for (const h of hosts) { try { h.ref.current?.bounce?.() } catch {} }
  },
  burst() {
    for (const h of hosts) { try { h.ref.current?.burst?.() } catch {} }
  },
  spin(n) {
    for (const h of hosts) { try { h.ref.current?.spin?.(n) } catch {} }
  },
  /** Temporarily override the shared state, then restore (e.g. happy on track change). */
  flash(state, ms) {
    const prev = sharedState
    sharedState = state
    renderAll()
    setTimeout(() => { sharedState = prev; renderAll() }, ms || 1600)
  },
}
