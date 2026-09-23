import { useCallback, useEffect, useRef, useState } from 'react'
import { demoRecords, stageRecords } from '../data/demo'
import type { AdapterDiagnostic, AgentRecord, SourceMode, TelemetryMode, TelemetryResponse, WorkerStatus } from '../types'

const EMPTY_PROVIDERS = {
  codex: { connected: false, message: 'Not connected' },
  opencode: { connected: false, message: 'Not connected' },
  'claude-code': { connected: false, message: 'Not connected' },
}

// Records older than this window are real past sessions, not current activity. The
// server retention is deliberately wider so a project's recent history stays visible,
// while this boundary keeps a six-hour freshness distinction on the client.
const FRESHNESS_MINUTES = 6 * 60

/**
 * Derives the effective, client-side record. A record whose last update is outside the
 * freshness window is marked `historical`, and a runtime status of `active` is demoted
 * to `waiting` so an old session can never read as verified current work. The reported
 * status is preserved so past completions and failures still read as outcomes.
 */
function withFreshness(records: AgentRecord[], now = Date.now()): AgentRecord[] {
  return records.map((record) => {
    const updated = new Date(record.updatedAt).getTime()
    if (!Number.isFinite(updated) || now - updated <= FRESHNESS_MINUTES * 60_000) return record
    const reported = record.status
    const status: WorkerStatus = reported === 'active' ? 'waiting' : reported
    return { ...record, historical: true, reportedStatus: reported, status }
  })
}

export function useTelemetry() {
  const [sourceMode, setSourceMode] = useState<SourceMode>('live')
  const [mode, setMode] = useState<TelemetryMode>('loading')
  const [records, setRecords] = useState<AgentRecord[]>([])
  const [providers, setProviders] = useState(EMPTY_PROVIDERS)
  const [diagnostics, setDiagnostics] = useState<AdapterDiagnostic[]>([])
  // Ids whose displayed hall came from age-based visual staging rather than routing.
  const [stagedIds, setStagedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [message, setMessage] = useState('Checking localhost adapters…')
  const [fetchedAt, setFetchedAt] = useState<string>()

  const sourceModeRef = useRef<SourceMode>('live')
  // Records are mirrored synchronously on every commit so a failure right after a
  // source change can never mistake demo records for a retained live snapshot.
  const recordsRef = useRef<AgentRecord[]>([])
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const queuedRef = useRef<{ silent: boolean } | null>(null)

  useEffect(() => { sourceModeRef.current = sourceMode }, [sourceMode])

  // Commit already-presented records without re-staging. Used when a failed refresh
  // marks the retained snapshot stale: re-staging there could move a worker's hall on
  // an error, and staged records must stay exactly where they were shown.
  const commitAsIs = useCallback((next: AgentRecord[]) => {
    recordsRef.current = next
    setRecords(next)
  }, [])

  // Stage a fresh snapshot for the village map, then store the staged records and the
  // ids that were reassigned. Live and simulation lists are staged independently, so a
  // live snapshot is never blended with the demo roster.
  const commitRecords = useCallback((next: AgentRecord[]) => {
    const { records: stagedRecords, stagedIds: nextStagedIds } = stageRecords(next)
    recordsRef.current = stagedRecords
    setRecords(stagedRecords)
    setStagedIds(nextStagedIds)
  }, [])

  // Invalidate any in-flight work for simulation, unmount, or an explicit source reset.
  const resetRequestState = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    queuedRef.current = null
  }, [])

  const runRefresh = useCallback((silent: boolean) => {
    if (sourceModeRef.current !== 'live') return

    // One in-flight request at a time; remember at most one trailing refresh. A loud
    // (non-silent) request wins so its loading state is not swallowed by a queued poll.
    if (inFlightRef.current) {
      const prior = queuedRef.current
      queuedRef.current = { silent: prior ? prior.silent && silent : silent }
      return
    }

    inFlightRef.current = true
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller

    const finish = () => {
      if (abortRef.current === controller) abortRef.current = null
      if (generation !== generationRef.current) return
      inFlightRef.current = false
      const queued = queuedRef.current
      queuedRef.current = null
      if (queued) runRefresh(queued.silent)
    }

    void (async () => {
      if (!silent) {
        setMode('loading')
        setMessage('Checking localhost adapters…')
      }
      try {
        const response = await fetch('/api/telemetry', {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Telemetry proxy returned ${response.status}`)
        const data = (await response.json()) as TelemetryResponse

        if (controller.signal.aborted || generation !== generationRef.current || sourceModeRef.current !== 'live') return

        setMode(data.mode)
        // Live mode only: never synthesize records, and never blend demo data in.
        commitRecords(withFreshness(data.records))
        setProviders(data.providers)
        setDiagnostics(data.diagnostics ?? [])
        setMessage(data.message ?? (data.mode === 'live' ? 'Read-only snapshot received.' : 'No live providers are connected.'))
        setFetchedAt(data.fetchedAt)
      } catch (error) {
        if (controller.signal.aborted || generation !== generationRef.current || sourceModeRef.current !== 'live') return

        setMode('error')
        const detail = error instanceof Error ? error.message : 'Telemetry proxy is unavailable.'

        if (recordsRef.current.length > 0) {
          // Keep the last good snapshot, its timestamp, its diagnostics and its staged
          // halls, but mark every record stale so neither the roster nor the scene
          // presents it as current. Staging is not re-run on a failed refresh.
          commitAsIs(recordsRef.current.map((record) => ({ ...record, stale: true })))
          setMessage(`Refresh failed — showing the last snapshot as stale. ${detail}`)
        } else {
          commitRecords([])
          setProviders(EMPTY_PROVIDERS)
          setDiagnostics([])
          setFetchedAt(undefined)
          setMessage(detail)
        }
      } finally {
        finish()
      }
    })()
  }, [commitAsIs, commitRecords])

  const refresh = useCallback((silent = false) => { runRefresh(silent) }, [runRefresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (sourceMode !== 'live') return
    let debounce: number | undefined
    const events = new EventSource('/api/events')
    const update = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void refresh(true), 350)
    }
    events.addEventListener('refresh', update)
    const interval = window.setInterval(() => void refresh(true), 15_000)
    return () => {
      events.close()
      window.clearInterval(interval)
      window.clearTimeout(debounce)
    }
  }, [sourceMode, refresh])

  // Abort outstanding work and ignore its result when the hook unmounts.
  useEffect(() => () => resetRequestState(), [resetRequestState])

  const enableSimulation = useCallback(() => {
    if (sourceModeRef.current === 'simulation') return
    sourceModeRef.current = 'simulation'
    resetRequestState()
    setSourceMode('simulation')
    setMode('simulation')
    // The demo roster's authored halls are fixed, so simulation commits them verbatim
    // instead of running the live age-based staging, and clears any staged ids.
    commitAsIs(demoRecords)
    setStagedIds(new Set())
    setProviders(EMPTY_PROVIDERS)
    setDiagnostics([])
    setMessage('Synthetic records for interface exploration only. No model work is running.')
    setFetchedAt(new Date().toISOString())
  }, [commitAsIs, resetRequestState])

  const returnToLive = useCallback(() => {
    if (sourceModeRef.current === 'live') return
    sourceModeRef.current = 'live'
    resetRequestState()
    setSourceMode('live')
    setMode('loading')
    // Drop demo records before refetching so simulation data can never be retained as
    // a stale live fallback.
    commitRecords([])
    setProviders(EMPTY_PROVIDERS)
    setDiagnostics([])
    setFetchedAt(undefined)
    setMessage('Checking localhost adapters…')
    runRefresh(false)
  }, [commitRecords, resetRequestState, runRefresh])

  return { mode, sourceMode, records, stagedIds, providers, diagnostics, message, fetchedAt, refresh, enableSimulation, returnToLive }
}
