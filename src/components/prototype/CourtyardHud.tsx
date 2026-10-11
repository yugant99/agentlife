import {
  Anchor, Archive, ArrowCounterClockwise, ArrowLeft, ArrowRight, Buildings, CaretDown, CheckCircle, CloudSlash,
  Flag, FlagBanner, Gauge, Hammer, HardHat, Hourglass, List, MapTrifold, Pause, Play, WarningCircle, X,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { preferredDistrict } from './agentModel'
import type { CityAgent } from './agentModel'
import type { CityFeedStatus } from '../../hooks/useCityFeed'
import * as city from './city'
import type { DistrictId } from './city'
import type { RenderStats } from './CourtyardScene'
import { cityCounts, cityStatusLabel } from './scenarioBridge'
import { PROVIDER_LABEL } from './scenario'

// Thin dark command shell over a full-bleed canvas. It owns no scene state: counts,
// district navigator, roster and inspector all read the same CityAgent snapshot.
// Scene (3D) labels render below every HUD layer; the HUD carries z-index for that.

const DISTRICT_ICON: Record<DistrictId, typeof Hammer> = {
  citadel: Buildings,
  foundry: Hammer,
  archive: MapTrifold,
  observatory: Gauge,
  port: Anchor,
  gateway: FlagBanner,
}

function statusIcon(agent: CityAgent) {
  if (agent.workState === 'unknown') return CloudSlash
  if (agent.freshness === 'historical') return Archive
  if (agent.freshness === 'stale') return WarningCircle
  switch (agent.workState) {
    case 'active': return HardHat
    case 'needs-input': return Flag
    case 'complete': return CheckCircle
    case 'waiting': return Hourglass
    default: return CloudSlash
  }
}

function statusKey(agent: CityAgent) {
  if (agent.workState === 'unknown') return 'unknown'
  if (agent.freshness === 'historical') return 'past'
  if (agent.freshness === 'stale') return 'stale'
  return agent.workState
}

function assignmentLabel(agent: CityAgent): string {
  const district = city.districtById(preferredDistrict(agent))
  const tool = agent.toolKind ?? 'no tool yet'
  return `${agent.phase} · ${tool} → ${district.name}`
}

function formatSignalAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown age'
  if (ageMs < 5_000) return 'just now'
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`
  return `${Math.floor(ageMs / 3_600_000)}h ago`
}

function Inspector({ agent, source, event, eventLabel, onBack, onCity }: {
  agent: CityAgent
  source: 'live' | 'simulation'
  event: string
  eventLabel: string
  onBack: () => void
  onCity: () => void
}) {
  const Icon = statusIcon(agent)
  const district = city.districtById(preferredDistrict(agent))
  const DistrictIcon = DISTRICT_ICON[district.id]
  const roleLabel = agent.role?.trim() ? agent.role.trim() : undefined
  return (
    <section className="proto-inspector" aria-live="polite">
      <div className="proto-inspector-head">
        <DistrictIcon size={15} weight="duotone" />
        <span>{district.name}</span>
        <button type="button" onClick={onCity} aria-label="Close inspector and return to the city"><X size={13} weight="bold" /></button>
      </div>
      <h2>{agent.name}</h2>
      <p className="proto-inspector-role">
        {roleLabel ? `${roleLabel} · ` : ''}{agent.depth > 0 ? `Sub-agent (depth ${agent.depth})` : 'Worker'} · {agent.workspace}
      </p>
      <dl className="proto-inspector-grid">
        <div><dt>Status</dt><dd className={`proto-status-text proto-status-text--${statusKey(agent)}`}><Icon size={13} weight="bold" />{cityStatusLabel(agent)}</dd></div>
        <div><dt>Assignment</dt><dd>{assignmentLabel(agent)}</dd></div>
        <div><dt>Source</dt><dd className="proto-source">{source === 'live' ? 'Live' : 'Simulation · today'}</dd></div>
        <div><dt>{source === 'live' ? 'Provider' : 'Example provider'}</dt><dd>{PROVIDER_LABEL[agent.provider]}</dd></div>
        <div><dt>Workspace</dt><dd>{agent.workspace}</dd></div>
        <div><dt>Phase</dt><dd>{agent.phase}</dd></div>
        <div><dt>Tool</dt><dd>{agent.toolKind ?? 'no tool yet'}</dd></div>
        <div><dt>Freshness</dt><dd>{agent.freshness} · {formatSignalAge(Date.now() - agent.lastSignalAt)}</dd></div>
      </dl>
      <p className="proto-inspector-event"><span>{eventLabel}</span>{event}</p>
      <div className="proto-inspector-actions">
        <button type="button" className="proto-inspector-back" onClick={onBack}><ArrowLeft size={13} weight="bold" /> District</button>
        <button type="button" className="proto-inspector-back" onClick={onCity}><Buildings size={13} weight="bold" /> City</button>
      </div>
    </section>
  )
}

function RosterRow({ agent, selected, onSelect, buttonRef, onKeyDown }: {
  agent: CityAgent
  selected: boolean
  onSelect: (id: string) => void
  buttonRef: (node: HTMLButtonElement | null) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}) {
  const Icon = statusIcon(agent)
  const district = city.districtById(preferredDistrict(agent))
  const DistrictIcon = DISTRICT_ICON[district.id]
  const details = `${PROVIDER_LABEL[agent.provider]} · ${agent.workspace} · ${agent.phase} · ${agent.toolKind ?? 'no tool yet'} · ${agent.freshness}`
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`proto-roster-row ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      title={details}
      onClick={() => onSelect(agent.id)}
      onKeyDown={onKeyDown}
    >
      <span className={`proto-status proto-status--${statusKey(agent)}`} aria-hidden="true"><Icon size={15} weight="bold" /></span>
      <span className="proto-roster-copy">
        <span className="proto-roster-name">{agent.name}</span>
        <span className="proto-roster-meta"><DistrictIcon size={11} weight="duotone" />{district.name} · {cityStatusLabel(agent)}</span>
      </span>
    </button>
  )
}

function Roster({ agents, selectedId, onSelect }: { agents: CityAgent[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const active = agents.filter((agent) => agent.freshness !== 'historical')
  const past = agents.filter((agent) => agent.freshness === 'historical')
  const rows = [...active, ...past]

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>, index: number) {
    const count = rows.length
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
      <button type="button" className="proto-roster-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <List size={15} weight="bold" />
        <span>Roster</span>
        <small>{agents.length}</small>
        <CaretDown size={13} weight="bold" className="proto-roster-caret" />
      </button>
      {open && (
        <div className="proto-roster-list" role="group" aria-label="Agent roster">
          {active.map((agent) => {
            const index = rows.indexOf(agent)
            return (
              <RosterRow
                key={agent.id}
                agent={agent}
                selected={selectedId === agent.id}
                onSelect={(id) => { setOpen(false); onSelect(id) }}
                buttonRef={(node) => { buttons.current[index] = node }}
                onKeyDown={(event) => onKeyDown(event, index)}
              />
            )
          })}
          {past.length > 0 && (
            <>
              <p className="proto-roster-past" role="presentation">Past · walked out</p>
              {past.map((agent) => {
                const index = rows.indexOf(agent)
                return (
                  <RosterRow
                    key={agent.id}
                    agent={agent}
                    selected={selectedId === agent.id}
                    onSelect={(id) => { setOpen(false); onSelect(id) }}
                    buttonRef={(node) => { buttons.current[index] = node }}
                    onKeyDown={(event) => onKeyDown(event, index)}
                  />
                )
              })}
            </>
          )}
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

function DistrictBar({ district, workers, selectedId, onCity, onSelect }: {
  district: city.District
  workers: CityAgent[]
  selectedId?: string
  onCity: () => void
  onSelect: (id: string) => void
}) {
  return (
    <div className="proto-districtbar">
      <div className="proto-districtbar-head">
        <button type="button" onClick={onCity}><Buildings size={12} weight="bold" /> City</button>
        <span className="proto-districtbar-sep">/</span>
        <strong>{district.name}</strong>
      </div>
      {workers.length === 0 ? (
        <p className="proto-districtbar-empty">No workers assigned</p>
      ) : (
        <div className="proto-districtbar-workers">
          {workers.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={selectedId === agent.id ? 'is-selected' : ''}
              onClick={() => onSelect(agent.id)}
            >
              {agent.name} · {cityStatusLabel(agent)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface CourtyardHudProps {
  agents: CityAgent[]
  lastEvent: string
  playing: boolean
  finished: boolean
  view: city.View
  selectedId?: string
  source: 'live' | 'simulation'
  isLive: boolean
  feedStatus: CityFeedStatus
  liveAvailable: boolean
  livePaused: boolean
  showStats: boolean
  statsSink: { current: RenderStats }
  onCity: () => void
  onDistrict: (id: DistrictId) => void
  onSelect: (id: string) => void
  onTogglePlay: () => void
  onReplay: () => void
  onStep: () => void
  onNeedsYou: () => void
  onSource: (source: 'live' | 'simulation') => void
}

export function CourtyardHud({ agents, lastEvent, playing, finished, view, selectedId, source, isLive, feedStatus, liveAvailable, livePaused, showStats, statsSink, onCity, onDistrict, onSelect, onTogglePlay, onReplay, onStep, onNeedsYou, onSource }: CourtyardHudProps) {
  const counts = cityCounts(agents)
  const selected = agents.find((agent) => agent.id === selectedId)
  const [districtsOpen, setDistrictsOpen] = useState(false)

  const districtCounts = new Map<DistrictId, number>()
  for (const agent of agents) {
    if (agent.freshness === 'historical') continue
    const id = preferredDistrict(agent)
    districtCounts.set(id, (districtCounts.get(id) ?? 0) + 1)
  }
  const currentDistrict = view.scale === 'district' ? view.districtId : undefined
  const selectedAgent = agents.find((agent) => agent.id === (view.scale === 'agent' ? view.agentId : undefined))
  const activeDistrictId = currentDistrict ?? (selectedAgent ? preferredDistrict(selectedAgent) : undefined)
  const activeDistrict = activeDistrictId ? city.districtById(activeDistrictId) : undefined
  const districtWorkers = activeDistrictId
    ? agents.filter((agent) => agent.freshness !== 'historical' && preferredDistrict(agent) === activeDistrictId)
    : []

  return (
    <div className="proto-hud">
      <div className="proto-corner proto-corner--tl">
        <header className="proto-topbar">
          <span className="proto-kicker">Mythic</span>
          <h1>Mythic City</h1>
          <div className="proto-source-switch" role="group" aria-label="Agent source">
            <button
              type="button"
              className={`proto-source-live ${source === 'live' ? 'is-active' : ''}`}
              aria-pressed={source === 'live'}
              disabled={!liveAvailable}
              title={liveAvailable ? 'Show live agents from this machine' : feedStatus === 'connecting' ? 'Connecting to the live feed…' : 'Live feed unavailable'}
              onClick={() => onSource('live')}
            >
              Live
            </button>
            <button
              type="button"
              className={`proto-source-sim ${source === 'simulation' ? 'is-active' : ''}`}
              aria-pressed={source === 'simulation'}
              onClick={() => onSource('simulation')}
            >
              Simulation · today
            </button>
          </div>
        </header>
        {isLive ? (
          <p className="proto-disclosure">Live agents on this machine — workers walk as their tools change.</p>
        ) : (
          <p className="proto-disclosure">Synthetic scenario — no agents are running.</p>
        )}
        {livePaused && (
          <p className="proto-live-paused" role="status">Live feed paused — showing the last snapshot.</p>
        )}

        <div className="proto-counts">
          <div><span>Working</span><strong>{counts.working}</strong></div>
          <div><span>Needs you</span><strong>{counts.needsYou}</strong></div>
          <div><span>Complete</span><strong>{counts.complete}</strong></div>
          <button type="button" className="proto-needs" onClick={onNeedsYou} disabled={counts.needsYou === 0}>
            <Flag size={13} weight="bold" /> Needs you <ArrowRight size={12} weight="bold" />
          </button>
        </div>

        <div className="proto-controls" role="group" aria-label={isLive ? 'View controls' : 'View and scenario controls'}>
          <button type="button" className={view.scale === 'city' ? 'is-active' : ''} onClick={onCity} aria-pressed={view.scale === 'city'}>
            <Buildings size={13} weight="bold" /> City
          </button>
          <button type="button" className={districtsOpen ? 'is-active' : ''} onClick={() => setDistrictsOpen((value) => !value)} aria-expanded={districtsOpen}>
            <MapTrifold size={13} weight="bold" /> Districts
          </button>
          <button type="button" className={playing ? 'is-active' : ''} onClick={onTogglePlay} aria-pressed={playing}>
            {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}{playing ? 'Pause' : 'Play'}
          </button>
          {!isLive && (<button type="button" onClick={onStep} disabled={finished}>Step <ArrowRight size={12} weight="bold" /></button>)}
          {!isLive && (<button type="button" onClick={onReplay}><ArrowCounterClockwise size={13} weight="bold" /> Replay</button>)}
        </div>

        {districtsOpen && (
          <div className="proto-districts" role="group" aria-label="District navigator">
            {city.DISTRICTS.map((district) => {
              const count = districtCounts.get(district.id) ?? 0
              return (
                <button
                  key={district.id}
                  type="button"
                  className={`proto-district-row ${currentDistrict === district.id ? 'is-active' : ''}`}
                  onClick={() => { setDistrictsOpen(false); onDistrict(district.id) }}
                >
                  <span className="proto-district-name">{district.name}</span>
                  <span className={`proto-district-count ${count === 0 ? 'is-none' : ''}`}>
                    {count === 0 ? 'No workers assigned' : `${count} ${count === 1 ? 'worker' : 'workers'}`}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {activeDistrict && (
          <DistrictBar
            district={activeDistrict}
            workers={districtWorkers}
            selectedId={selectedId}
            onCity={onCity}
            onSelect={onSelect}
          />
        )}

        <p className="proto-event"><span>{isLive ? 'Live' : 'Scenario'}</span>{lastEvent}</p>
        <p className="proto-hint">City shows all districts. Pick a district or a figure; Escape steps back one level.</p>
      </div>

      {selected && (
        <div className="proto-corner proto-corner--tr">
          <Inspector
            agent={selected}
            source={source}
            event={lastEvent}
            eventLabel={isLive ? 'Live update' : 'Last scenario event'}
            onBack={() => onDistrict(preferredDistrict(selected))}
            onCity={onCity}
          />
        </div>
      )}

      <div className="proto-corner proto-corner--bl">
        <Roster agents={agents} selectedId={selectedId} onSelect={onSelect} />
      </div>

      {showStats && (
        <div className="proto-corner proto-corner--br">
          <StatsPanel sink={statsSink} />
        </div>
      )}
    </div>
  )
}
