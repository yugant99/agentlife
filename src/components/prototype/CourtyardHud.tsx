import {
  ArrowCounterClockwise, ArrowLeft, ArrowRight, ArrowsOut, CaretDown, CheckCircle, CloudSlash,
  Flag, FlagBanner, Gauge, Hammer, HardHat, Hourglass, List, MapTrifold, Pause, Play, WarningCircle, X,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { RenderStats } from './CourtyardScene'
import type { ScenarioAgent, ScenarioState, StationId } from './scenario'
import { PROVIDER_LABEL, STATION_META, isFinished, scenarioCounts, statusLabel } from './scenario'

// The HUD is a thin overlay: a dark, low-chrome command shell over a full-bleed canvas.
// It owns no scene state. Counts, roster and inspector read the same synthetic scenario
// the scene renders, so status meaning never depends on colour or animation.

const STATION_ICON: Record<StationId, typeof Hammer> = {
  forge: Hammer,
  'planning-table': MapTrifold,
  'signal-post': FlagBanner,
}

function statusIcon(agent: ScenarioAgent) {
  if (agent.workState === 'unknown') return CloudSlash
  if (agent.freshness === 'stale') return WarningCircle
  switch (agent.workState) {
    case 'active': return HardHat
    case 'needs-input': return Flag
    case 'complete': return CheckCircle
    case 'waiting': return Hourglass
    default: return CloudSlash
  }
}

function statusKey(agent: ScenarioAgent) {
  if (agent.workState === 'unknown') return 'unknown'
  if (agent.freshness === 'stale') return 'stale'
  return agent.workState
}

function Inspector({ agent, event, onOverview }: {
  agent: ScenarioAgent
  event: string
  onOverview: () => void
}) {
  const Icon = statusIcon(agent)
  const Station = STATION_ICON[agent.station]
  return (
    <section className="proto-inspector" aria-live="polite">
      <div className="proto-inspector-head">
        <Station size={15} weight="duotone" />
        <span>{STATION_META[agent.station].name}</span>
        <button type="button" onClick={onOverview} aria-label="Close inspector and return to overview"><X size={13} weight="bold" /></button>
      </div>
      <h2>{agent.name}</h2>
      <p className="proto-inspector-role">{agent.role} · Synthetic worker</p>
      <dl className="proto-inspector-grid">
        <div><dt>Status</dt><dd className={`proto-status-text proto-status-text--${statusKey(agent)}`}><Icon size={13} weight="bold" />{statusLabel(agent)}</dd></div>
        <div><dt>Task</dt><dd>{agent.task}</dd></div>
        <div><dt>Source</dt><dd className="proto-source">Simulation · no live record</dd></div>
        <div><dt>Example provider</dt><dd>{PROVIDER_LABEL[agent.provider]}</dd></div>
      </dl>
      <p className="proto-inspector-event"><span>Last scenario event</span>{event}</p>
      <button type="button" className="proto-inspector-back" onClick={onOverview}><ArrowLeft size={13} weight="bold" /> Back to overview</button>
    </section>
  )
}

function Roster({ state, selectedId, onSelect }: { state: ScenarioState; selectedId?: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>, index: number) {
    const count = state.agents.length
    let next = -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % count
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    if (next >= 0) {
      event.preventDefault()
      buttons.current[next]?.focus()
    }
  }

  return (
    <div className={`proto-roster ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="proto-roster-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <List size={15} weight="bold" />
        <span>Roster</span>
        <small>{state.agents.length}</small>
        <CaretDown size={13} weight="bold" className="proto-roster-caret" />
      </button>
      {open && (
        <div className="proto-roster-list" role="group" aria-label="Agent roster">
          {state.agents.map((agent, index) => {
            const Icon = statusIcon(agent)
            const Station = STATION_ICON[agent.station]
            return (
              <button
                key={agent.id}
                ref={(node) => { buttons.current[index] = node }}
                type="button"
                className={`proto-roster-row ${selectedId === agent.id ? 'is-selected' : ''}`}
                aria-pressed={selectedId === agent.id}
                onClick={() => onSelect(agent.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span className={`proto-status proto-status--${statusKey(agent)}`} aria-hidden="true"><Icon size={15} weight="bold" /></span>
                <span className="proto-roster-copy">
                  <span className="proto-roster-name">{agent.name}</span>
                  <span className="proto-roster-meta"><Station size={11} weight="duotone" />{STATION_META[agent.station].name} · {statusLabel(agent)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatsPanel({ sink }: { sink: { current: RenderStats } }) {
  const calls = useRef<HTMLElement>(null)
  const triangles = useRef<HTMLElement>(null)
  const frame = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLElement>(null)

  useEffect(() => {
    // DOM writes on a slow interval; deliberately not React state, so nothing here
    // re-renders the HUD per frame.
    const id = window.setInterval(() => {
      const stats = sink.current
      if (calls.current) calls.current.textContent = String(stats.calls || '—')
      if (triangles.current) triangles.current.textContent = stats.triangles ? stats.triangles.toLocaleString() : '—'
      if (frame.current) frame.current.textContent = stats.frameMs ? `${stats.frameMs.toFixed(1)} ms` : '—'
      if (canvas.current) canvas.current.textContent = stats.width ? `${Math.round(stats.width)}×${Math.round(stats.height)} @${stats.pixelRatio.toFixed(2)}` : '—'
    }, 450)
    return () => window.clearInterval(id)
  }, [sink])

  return (
    <details className="proto-stats">
      <summary><Gauge size={14} weight="bold" /> Renderer details</summary>
      <dl>
        <div><dt>Draw calls</dt><dd ref={calls}>—</dd></div>
        <div><dt>Triangles</dt><dd ref={triangles}>—</dd></div>
        <div><dt>Avg frame interval</dt><dd ref={frame}>—</dd></div>
        <div><dt>Canvas</dt><dd ref={canvas}>—</dd></div>
      </dl>
      <p>Mean interval between rendered frames over the last sampling window. Not a target.</p>
    </details>
  )
}

export interface CourtyardHudProps {
  state: ScenarioState
  playing: boolean
  selectedId?: string
  showStats: boolean
  statsSink: { current: RenderStats }
  onSelect: (id: string) => void
  onOverview: () => void
  onTogglePlay: () => void
  onReplay: () => void
  onStep: () => void
  onNeedsYou: () => void
}

export function CourtyardHud({ state, playing, selectedId, showStats, statsSink, onSelect, onOverview, onTogglePlay, onReplay, onStep, onNeedsYou }: CourtyardHudProps) {
  const counts = scenarioCounts(state)
  const selected = state.agents.find((agent) => agent.id === selectedId)
  const finished = isFinished(state)

  return (
    <div className="proto-hud">
      <div className="proto-corner proto-corner--tl">
        <header className="proto-topbar">
          <span className="proto-kicker">Mythic</span>
          <h1>Command Courtyard</h1>
          <span className="proto-sim-pill">Simulation</span>
        </header>
        <p className="proto-disclosure">Synthetic scenario — no agents are running.</p>

        <div className="proto-counts">
          <div><span>Working</span><strong>{counts.working}</strong></div>
          <div><span>Needs you</span><strong>{counts.needsYou}</strong></div>
          <div><span>Complete</span><strong>{counts.complete}</strong></div>
          <button type="button" className="proto-needs" onClick={onNeedsYou} disabled={counts.needsYou === 0}>
            <Flag size={13} weight="bold" /> Needs you <ArrowRight size={12} weight="bold" />
          </button>
        </div>

        <div className="proto-controls" role="group" aria-label="Scenario controls">
          <button type="button" className={playing ? 'is-active' : ''} onClick={onTogglePlay} aria-pressed={playing}>
            {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}{playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={onStep} disabled={finished}>Step <ArrowRight size={12} weight="bold" /></button>
          <button type="button" onClick={onReplay}><ArrowCounterClockwise size={13} weight="bold" /> Replay</button>
          <button type="button" onClick={onOverview}><ArrowsOut size={13} weight="bold" /> Overview</button>
        </div>

        <p className="proto-event"><span>Scenario</span>{state.lastEvent}</p>
        <p className="proto-hint">Click a figure or pick from the roster. Escape returns to the overview.</p>
      </div>

      {selected && (
        <div className="proto-corner proto-corner--tr">
          <Inspector agent={selected} event={state.lastEvent} onOverview={onOverview} />
        </div>
      )}

      <div className="proto-corner proto-corner--bl">
        <Roster state={state} selectedId={selectedId} onSelect={onSelect} />
      </div>

      {showStats && (
        <div className="proto-corner proto-corner--br">
          <StatsPanel sink={statsSink} />
        </div>
      )}
    </div>
  )
}
