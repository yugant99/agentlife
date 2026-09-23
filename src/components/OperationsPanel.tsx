import {
  ArrowClockwise, Buildings, CaretRight, CheckCircle, CircleNotch, CloudSlash,
  Compass, Flag, Flask, HardHat, Scroll, ShieldCheck, WarningCircle,
} from '@phosphor-icons/react'
import { districtMeta } from '../data/demo'
import type { AdapterDiagnostic, AgentRecord, SourceMode, TelemetryMode, WorkerStatus } from '../types'

const statusCopy: Record<WorkerStatus, string> = {
  active: 'Active', waiting: 'Waiting', 'needs-input': 'Needs input', review: 'In review', failed: 'Failed', complete: 'Complete', unknown: 'Status unavailable',
}

const statusIcon: Record<WorkerStatus, typeof CheckCircle> = {
  active: HardHat, waiting: Compass, 'needs-input': Flag, review: ShieldCheck, failed: WarningCircle, complete: CheckCircle, unknown: CloudSlash,
}

// Friendly provider names for the roster and diagnostics. The provider id in the
// data contract stays exact; only the display text is expanded.
const providerLabel: Record<AgentRecord['provider'], string> = {
  codex: 'Codex', opencode: 'OpenCode', 'claude-code': 'Claude Code', manual: 'Manual',
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// A record is "past" when it is real history rather than current activity. Historical
// records get a neutral marker and explicit past wording, but keep their reported facts.
const isPast = (record: AgentRecord) => Boolean(record.historical) || Boolean(record.stale)

function pastStatusCopy(record: AgentRecord) {
  if (record.stale) return 'Unknown · stale snapshot'
  const reported = record.reportedStatus ?? record.status
  if (reported === 'complete') return 'Completed · past'
  if (reported === 'failed') return 'Failed · past'
  if (record.status === 'unknown') return 'Unknown · past session'
  if (record.status === 'waiting') return 'Past session · not active'
  return `${statusCopy[record.status]} · past`
}

function RecordRow({ record, selected, staged, onSelect }: { record: AgentRecord; selected: boolean; staged: boolean; onSelect: (id: string) => void }) {
  const past = isPast(record)
  // A past record keeps its historical status/activity facts, but the row shows a
  // neutral marker and labels the activity as last known rather than current.
  const Icon = past ? statusIcon.unknown : statusIcon[record.status]
  const markClass = past ? 'status-unknown' : `status-${record.status}`
  return (
    <button
      className={`record-row ${selected ? 'is-selected' : ''} ${record.stale ? 'is-stale' : ''} ${record.historical ? 'is-historical' : ''}`}
      onClick={() => onSelect(record.id)}
      aria-pressed={selected}
    >
      <span className={`status-mark ${markClass} ${record.historical ? 'status-historical' : ''}`}><Icon size={17} weight="bold" /></span>
      <span className="record-copy">
        <span className="record-heading"><strong>{record.title}</strong><small>{relativeTime(record.updatedAt)}{record.stale ? ' · stale' : record.historical ? ' · past' : ''}</small></span>
        <span className="record-role">
          <span className="record-provider">{providerLabel[record.provider]} · {record.model}</span>
          {/* Shown hall for a staged worker is age-based scenery, so it is labelled as a
              staging location rather than a role. Provider/model above stays exact. */}
          <span className="record-hall">{districtMeta[record.district].name}{staged ? ' · staging' : ''}</span>
        </span>
        <span className="record-activity">{past ? `Last known · ${record.activity}` : record.activity}</span>
      </span>
      <CaretRight size={15} />
    </button>
  )
}

function StateMessage({ mode, message, onRefresh }: { mode: TelemetryMode; message: string; onRefresh: () => void }) {
  const loading = mode === 'loading'
  const Icon = loading ? CircleNotch : mode === 'error' ? WarningCircle : CloudSlash
  return (
    <div className={`state-message ${mode}`}>
      <Icon size={24} className={loading ? 'spin' : ''} />
      <div><strong>{loading ? 'Reading local adapters' : mode === 'error' ? 'Connection error' : 'Telemetry disconnected'}</strong><p>{message}</p></div>
      {!loading && <div className="state-actions"><button onClick={() => onRefresh()}><ArrowClockwise size={15} /> Retry</button></div>}
    </div>
  )
}

export function OperationsPanel({ mode, sourceMode, records, stagedIds, message, selectedId, onSelect, onLive, onDemo, onRefresh, diagnostics, fetchedAt }: {
  mode: TelemetryMode
  sourceMode: SourceMode
  records: AgentRecord[]
  stagedIds: ReadonlySet<string>
  message: string
  selectedId?: string
  onSelect: (id: string) => void
  onLive: () => void
  onDemo: () => void
  onRefresh: () => void
  diagnostics: AdapterDiagnostic[]
  fetchedAt?: string
}) {
  const selected = records.find((record) => record.id === selectedId)
  // Only current, non-historical records may count as active or need attention.
  const activeCount = records.filter((record) => record.status === 'active' && !record.stale && !record.historical).length
  const stale = records.some((record) => record.stale)
  const historicalCount = records.filter((record) => record.historical && !record.stale).length
  const unknownCount = records.filter((record) => !record.stale && !record.historical && record.status === 'unknown').length
  const hasRecords = records.length > 0
  const showStateMessage = !hasRecords && (mode === 'loading' || mode === 'disconnected' || mode === 'error')

  const rosterLabel = sourceMode === 'simulation'
    ? 'Simulation preview'
    : stale
      ? 'Stale snapshot · not live'
      : mode === 'live'
        ? historicalCount > 0 ? `Live + ${historicalCount} past` : 'Read-only live snapshot'
        : mode === 'partial'
          ? historicalCount > 0 ? `Partial live + ${historicalCount} past` : 'Partial live snapshot'
          : historicalCount > 0 ? `Read-only · ${historicalCount} past` : 'Read-only snapshot'

  return (
    <aside className="operations-panel" aria-label="Agent operations">
      <div className="source-control" role="group" aria-label="Data source">
        <span className="source-label">Source</span>
        <div className="source-switch">
          <button type="button" className={sourceMode === 'live' ? 'is-active' : ''} aria-pressed={sourceMode === 'live'} onClick={onLive}>Live</button>
          <button type="button" className={sourceMode === 'simulation' ? 'is-active' : ''} aria-pressed={sourceMode === 'simulation'} onClick={onDemo}>Simulation</button>
        </div>
      </div>

      <div className="rail-summary">
        <div><span>Workers</span><strong>{records.length || '—'}</strong></div>
        <div><span>Active{unknownCount > 0 ? ` · ${unknownCount} unknown` : ''}</span><strong>{stale || !records.length ? '—' : activeCount}</strong></div>
        <div><span>Past</span><strong>{!records.length ? '—' : historicalCount}</strong></div>
      </div>

      {showStateMessage ? (
        <StateMessage mode={mode} message={message} onRefresh={onRefresh} />
      ) : (
        <>
          {stale && (
            <div className="stale-notice" role="status">
              <WarningCircle size={16} weight="bold" />
              <span><strong>STALE SNAPSHOT</strong> {message}</span>
              <button type="button" onClick={() => onRefresh()}><ArrowClockwise size={14} /> Retry</button>
            </div>
          )}
          {mode === 'simulation' && <div className="simulation-notice"><Flask size={16} weight="bold" /><span><strong>SIMULATION</strong> Synthetic activity only. No agents or quotas are live.</span></div>}
          <div className="section-heading"><span>Village roster</span><small>{rosterLabel}</small></div>
          {hasRecords ? (
            <div className="roster">
              {records.map((record) => <RecordRow key={record.id} record={record} selected={selectedId === record.id} staged={stagedIds.has(record.id)} onSelect={onSelect} />)}
            </div>
          ) : (
            <p className="roster-empty">No workers reported by the connected adapters.</p>
          )}
        </>
      )}

      {mode !== 'simulation' && (
        <section className="diagnostics" aria-label="Connection diagnostics">
          <div className="section-heading">
            <span>Connection diagnostics</span>
            <small>{fetchedAt ? `${stale ? 'Last successful snapshot' : 'Refreshed'} ${relativeTime(fetchedAt)}` : 'No successful snapshot'}</small>
          </div>
          {diagnostics.map((item) => (
            <div className="diagnostic-row" key={item.provider}>
              <span className={`diagnostic-state ${stale ? 'stale' : item.state}`} aria-hidden="true" />
              <div>
                <div className="diagnostic-title"><strong>{providerLabel[item.provider]}</strong><span>{stale ? `last known: ${item.state}` : item.state}</span></div>
                <code>{item.endpoint}</code>
                <p>{item.recordsReceived} records · {item.adapter}{item.lastSuccessfulRefresh ? ` · ${stale ? 'last successful read' : 'last read'} ${relativeTime(item.lastSuccessfulRefresh)}` : ''}</p>
                {(item.failureReason || item.limitation) && <small>{item.failureReason || item.limitation}</small>}
              </div>
            </div>
          ))}
        </section>
      )}

      {selected && (
        <section className="inspector" aria-live="polite">
          <div className="inspector-title"><Buildings size={18} /><span>{districtMeta[selected.district].name}</span><button onClick={() => onSelect('')} aria-label="Close detail">×</button></div>
          {/* A staged hall is scenery, so it shows its map location rather than the
              hall's authored role kicker, which would imply a factual job assignment. */}
          <p className="district-kicker">{stagedIds.has(selected.id) ? `Shown in ${districtMeta[selected.district].name} · staging placement` : districtMeta[selected.district].kicker}</p>
          <h2>{selected.title}</h2>
          <p>{selected.role}</p>
          <dl>
            <div><dt>Status</dt><dd>{isPast(selected) ? pastStatusCopy(selected) : statusCopy[selected.status]}</dd></div>
            <div><dt>Parent</dt><dd>{selected.parentId ? (records.find((record) => record.id === selected.parentId)?.title ?? 'Outside this snapshot') : 'Not reported'}</dd></div>
            <div><dt>Updated</dt><dd>{relativeTime(selected.updatedAt)}</dd></div>
            <div><dt>Usage</dt><dd>{typeof selected.usage?.inputTokens === 'number' ? `${selected.usage.inputTokens.toLocaleString()} input` : 'Unavailable'}</dd></div>
          </dl>
          <div className="safe-activity"><Scroll size={16} /><span>{isPast(selected) ? `Last known · ${selected.activity}` : selected.activity}</span></div>
        </section>
      )}
    </aside>
  )
}
