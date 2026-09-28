import { Component, StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CourtyardHud } from './components/prototype/CourtyardHud'
import { CourtyardScene } from './components/prototype/CourtyardScene'
import type { RenderStats } from './components/prototype/CourtyardScene'
import {
  DWELL_MS, advanceScenario, createScenario, isFinished, resetScenario, selectNextAttention,
} from './components/prototype/scenario'
import './components/prototype/prototype.css'

// Standalone synthetic prototype. No telemetry hook and no fetch: the scenario is the
// only source of truth, and it is clearly labelled as a simulation in the HUD. The main
// app (index.html / src/main.tsx) is untouched.

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
  } catch {
    return false
  }
}

// Minimal local boundary so a renderer error degrades to HTML controls instead of an
// indefinite loading overlay.
class SceneBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError()
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function readDebugFlag(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1'
  } catch {
    return false
  }
}

function PrototypeApp() {
  const [state, setState] = useState(() => createScenario())
  const [playing, setPlaying] = useState(true)
  const [selectedId, setSelectedId] = useState<string>()
  const [focusMode, setFocusMode] = useState<'overview' | 'agent'>('overview')
  const [focusRevision, setFocusRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const webgl = useMemo(() => supportsWebGL(), [])
  const debug = useMemo(() => readDebugFlag(), [])
  const statsSink = useRef<RenderStats>({ calls: 0, triangles: 0, frameMs: 0, width: 0, height: 0, pixelRatio: 1 })

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // Safety net: never leave the "Preparing" overlay up if the canvas never reports ready.
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 5000)
    return () => window.clearTimeout(id)
  }, [])

  // One dwell timer per committed step (not a per-frame React state update).
  useEffect(() => {
    if (!playing || isFinished(state)) return
    const id = window.setTimeout(() => setState((current) => advanceScenario(current)), DWELL_MS)
    return () => window.clearTimeout(id)
  }, [playing, state])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setFocusMode('agent')
    setFocusRevision((value) => value + 1)
  }, [])

  // Escape, Back, the inspector close, and Overview all do the same thing: clear the
  // selection and return cleanly to the overview with no lingering panel.
  const toOverview = useCallback(() => {
    setSelectedId(undefined)
    setFocusMode('overview')
    setFocusRevision((value) => value + 1)
  }, [])

  const replay = useCallback(() => {
    setState(resetScenario())
    setPlaying(true)
    setSelectedId(undefined)
    setFocusMode('overview')
    setFocusRevision((value) => value + 1)
  }, [])

  const step = useCallback(() => setState((current) => advanceScenario(current)), [])

  const needsYou = useCallback(() => {
    const next = selectNextAttention(state, selectedId)
    if (next) select(next)
  }, [state, selectedId, select])

  const handleReady = useCallback(() => setReady(true), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toOverview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toOverview])

  return (
    <main className="proto-app">
      {webgl ? (
        <SceneBoundary
          onError={handleReady}
          fallback={(
            <div className="proto-world-fallback proto-world-fallback--bounds">
              <p>3D courtyard could not render.</p>
              <p>The roster and inspector remain available as plain HTML.</p>
            </div>
          )}
        >
          <CourtyardScene
            state={state}
            selectedId={selectedId}
            focus={{ mode: focusMode, id: selectedId }}
            focusRevision={focusRevision}
            paused={!playing}
            reducedMotion={reducedMotion}
            showStats={debug}
            statsSink={statsSink}
            onSelect={select}
            onReady={handleReady}
          />
        </SceneBoundary>
      ) : (
        <div className="proto-world-fallback proto-world-fallback--bounds">
          <p>3D courtyard unavailable.</p>
          <p>WebGL is not available in this browser. The roster and inspector still describe every agent.</p>
        </div>
      )}
      <CourtyardHud
        state={state}
        playing={playing}
        selectedId={selectedId}
        showStats={debug}
        statsSink={statsSink}
        onSelect={select}
        onOverview={toOverview}
        onTogglePlay={() => setPlaying((value) => !value)}
        onReplay={replay}
        onStep={step}
        onNeedsYou={needsYou}
      />
      {webgl && !ready && <div className="proto-loading" role="status">Preparing the courtyard…</div>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><PrototypeApp /></StrictMode>,
)
