import { Component, StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CourtyardHud } from './components/prototype/CourtyardHud'
import { CourtyardScene } from './components/prototype/CourtyardScene'
import type { RenderStats } from './components/prototype/CourtyardScene'
import * as city from './components/prototype/city'
import {
  DWELL_MS, advanceScenario, createScenario, isFinished, resetScenario, selectNextAttention,
} from './components/prototype/scenario'
import './components/prototype/prototype.css'

// Standalone synthetic prototype: the Mythic City. No telemetry hook and no fetch; the
// scenario is the only source of truth and is clearly labelled a simulation. The original
// app (index.html / src/main.tsx) is untouched.

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
  } catch {
    return false
  }
}

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
  const [view, setView] = useState<city.View>({ scale: 'city' })
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

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 6000)
    return () => window.clearTimeout(id)
  }, [])

  // One dwell timer per committed step (not a per-frame React state update).
  useEffect(() => {
    if (!playing || isFinished(state)) return
    const id = window.setTimeout(() => setState((current) => advanceScenario(current)), DWELL_MS)
    return () => window.clearTimeout(id)
  }, [playing, state])

  const goCity = useCallback(() => {
    setSelectedId(undefined)
    setView({ scale: 'city' })
    setFocusRevision((value) => value + 1)
  }, [])

  const goDistrict = useCallback((districtId: city.DistrictId) => {
    setSelectedId(undefined)
    setView({ scale: 'district', districtId })
    setFocusRevision((value) => value + 1)
  }, [])

  const selectAgent = useCallback((agentId: string) => {
    setSelectedId(agentId)
    setView({ scale: 'agent', agentId })
    setFocusRevision((value) => value + 1)
  }, [])

  // Escape backs out one useful level: agent -> its district -> city. Never leaves a
  // stuck inspector.
  const escape = useCallback(() => {
    if (view.scale === 'agent') {
      const agent = state.agents.find((entry) => entry.id === view.agentId)
      if (agent) {
        goDistrict(city.districtForStation(agent.station))
        return
      }
      goCity()
    } else if (view.scale === 'district') {
      goCity()
    } else {
      setSelectedId(undefined)
    }
  }, [view, state.agents, goDistrict, goCity])

  const replay = useCallback(() => {
    setState(resetScenario())
    setPlaying(true)
    setSelectedId(undefined)
    setView({ scale: 'city' })
    setFocusRevision((value) => value + 1)
  }, [])

  const step = useCallback(() => setState((current) => advanceScenario(current)), [])

  const needsYou = useCallback(() => {
    const next = selectNextAttention(state, selectedId)
    if (next) selectAgent(next)
  }, [state, selectedId, selectAgent])

  const handleReady = useCallback(() => setReady(true), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escape])

  return (
    <main className="proto-app">
      {webgl ? (
        <SceneBoundary
          onError={handleReady}
          fallback={(
            <div className="proto-world-fallback proto-world-fallback--bounds">
              <p>3D city could not render.</p>
              <p>The roster and inspector remain available as plain HTML.</p>
            </div>
          )}
        >
          <CourtyardScene
            state={state}
            selectedId={selectedId}
            view={view}
            focusRevision={focusRevision}
            paused={!playing}
            reducedMotion={reducedMotion}
            showStats={debug}
            statsSink={statsSink}
            onSelect={selectAgent}
            onDistrict={goDistrict}
            onReady={handleReady}
          />
        </SceneBoundary>
      ) : (
        <div className="proto-world-fallback proto-world-fallback--bounds">
          <p>3D city unavailable.</p>
          <p>WebGL is not available in this browser. The roster and inspector still describe every agent.</p>
        </div>
      )}
      <CourtyardHud
        state={state}
        playing={playing}
        view={view}
        selectedId={selectedId}
        showStats={debug}
        statsSink={statsSink}
        onCity={goCity}
        onDistrict={goDistrict}
        onSelect={selectAgent}
        onTogglePlay={() => setPlaying((value) => !value)}
        onReplay={replay}
        onStep={step}
        onNeedsYou={needsYou}
      />
      {webgl && !ready && <div className="proto-loading" role="status">Preparing the city…</div>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><PrototypeApp /></StrictMode>,
)
