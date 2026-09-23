import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from '@phosphor-icons/react'
import { OperationsPanel } from './components/OperationsPanel'
import { WorldScene } from './components/WorldScene'
import { useTelemetry } from './hooks/useTelemetry'
import './styles.css'

function App() {
  const telemetry = useTelemetry()
  const [selectedId, setSelectedId] = useState<string>()
  const [reducedMotion, setReducedMotion] = useState(false)
  // Auto-select the first record exactly once. After that, closing the details or
  // losing the selected record must not silently jump the selection elsewhere.
  const initialSelectionApplied = useRef(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (initialSelectionApplied.current) return
    if (telemetry.records.length === 0) return
    initialSelectionApplied.current = true
    setSelectedId(telemetry.records[0].id)
  }, [telemetry.records])

  useEffect(() => {
    if (selectedId === undefined) return
    // Clear a selection whose record is gone, without selecting a replacement.
    if (telemetry.records.some((record) => record.id === selectedId)) return
    setSelectedId(undefined)
  }, [telemetry.records, selectedId])

  const stale = telemetry.records.some((record) => record.stale)
  const connectionLabel = telemetry.sourceMode === 'simulation'
    ? 'SIMULATION'
    : stale
      ? 'STALE SNAPSHOT'
      : telemetry.mode === 'live'
        ? 'LOCAL LIVE'
        : telemetry.mode === 'partial'
          ? 'PARTIAL LIVE'
          : telemetry.mode.toUpperCase()

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><ShieldCheck size={22} weight="duotone" /></div>
        <div className="brand-copy"><span>Mythic Agent</span><strong>Command Center</strong></div>
        <div className={`connection-pill ${telemetry.mode}`}>
          <span className="connection-dot" />
          {connectionLabel}
        </div>
      </header>

      <section className="workspace">
        <div className="scene-shell">
          <WorldScene records={telemetry.records} selectedId={selectedId} reducedMotion={reducedMotion} onSelect={setSelectedId} />
          {telemetry.sourceMode === 'simulation' && <div className="simulation-watermark" aria-hidden="true">SIMULATION</div>}
        </div>
        <OperationsPanel
          mode={telemetry.mode}
          sourceMode={telemetry.sourceMode}
          records={telemetry.records}
          stagedIds={telemetry.stagedIds}
          message={telemetry.message}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id || undefined)}
          onLive={telemetry.returnToLive}
          onDemo={telemetry.enableSimulation}
          onRefresh={telemetry.refresh}
          diagnostics={telemetry.diagnostics}
          fetchedAt={telemetry.fetchedAt}
        />
      </section>
    </main>
  )
}

export default App
