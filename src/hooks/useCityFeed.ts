import { useEffect, useMemo, useRef, useState } from 'react'
import { deriveFreshness } from '../components/prototype/agentModel'
import type { CitySnapshot } from '../components/prototype/agentModel'

export type CityFeedStatus = 'connecting' | 'live' | 'unavailable'

export interface CityFeed {
  snapshot: CitySnapshot | null
  status: CityFeedStatus
  error?: string
}

const UNAVAILABLE_MESSAGE = 'City feed is unavailable.'

function isCitySnapshot(value: unknown): value is CitySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<CitySnapshot>
  return snapshot.source === 'live' && Array.isArray(snapshot.agents) && typeof snapshot.generatedAt === 'number'
}

/** Recompute freshness by wall-clock time only; work state is never guessed. */
function withClientFreshness(snapshot: CitySnapshot, now: number): CitySnapshot {
  let changed = false
  const agents = snapshot.agents.map((agent) => {
    const freshness = deriveFreshness(agent.lastSignalAt, now)
    if (freshness === agent.freshness) return agent
    changed = true
    return { ...agent, freshness }
  })
  return changed ? { ...snapshot, agents } : snapshot
}

export function useCityFeed(): CityFeed {
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null)
  const [status, setStatus] = useState<CityFeedStatus>('connecting')
  const [error, setError] = useState<string | undefined>()
  const snapshotRef = useRef<CitySnapshot | null>(null)
  const statusRef = useRef<CityFeedStatus>('connecting')

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    let source: EventSource | null = null
    let pollTimer: number | undefined
    let freshnessTimer: number | undefined

    const commit = (next: CitySnapshot) => {
      if (disposed || controller.signal.aborted) return
      snapshotRef.current = next
      setSnapshot(next)
      statusRef.current = 'live'
      setStatus('live')
      setError(undefined)
    }

    const markUnavailable = () => {
      if (disposed || controller.signal.aborted) return
      // Keep the last snapshot; mark its agents stale by time, never by guesswork.
      if (snapshotRef.current) {
        const aged = withClientFreshness(snapshotRef.current, Date.now())
        snapshotRef.current = aged
        setSnapshot(aged)
      }
      statusRef.current = 'unavailable'
      setStatus('unavailable')
      setError(UNAVAILABLE_MESSAGE)
    }

    const fetchSnapshot = async (loud: boolean) => {
      try {
        const response = await fetch('/api/city', {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`City feed returned ${response.status}`)
        const data = (await response.json()) as unknown
        if (!isCitySnapshot(data)) throw new Error('City feed returned an unexpected shape.')
        commit(data)
      } catch (fetchError) {
        if (controller.signal.aborted || disposed) return
        if (snapshotRef.current) {
          markUnavailable()
        } else if (loud) {
          statusRef.current = 'unavailable'
          setStatus('unavailable')
          setError(fetchError instanceof Error ? UNAVAILABLE_MESSAGE : UNAVAILABLE_MESSAGE)
        }
      }
    }

    void fetchSnapshot(true)

    try {
      source = new EventSource('/api/city/stream')
      const onSnapshot = (event: Event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data as string) as unknown
          if (isCitySnapshot(data)) commit(data)
        } catch {
          // Malformed frames never clear a good snapshot.
        }
      }
      source.addEventListener('snapshot', onSnapshot)
      source.addEventListener('message', onSnapshot)
      source.onerror = () => {
        if (snapshotRef.current) markUnavailable()
      }
    } catch {
      // EventSource unavailable: interval polling below still recovers.
    }

    pollTimer = window.setInterval(() => {
      // If the stream is live it keeps us fresh; poll only when unavailable.
      if (statusRef.current !== 'live') void fetchSnapshot(false)
    }, 15_000)

    freshnessTimer = window.setInterval(() => {
      if (snapshotRef.current) {
        const aged = withClientFreshness(snapshotRef.current, Date.now())
        if (aged !== snapshotRef.current) {
          snapshotRef.current = aged
          setSnapshot(aged)
        }
      }
    }, 15_000)

    return () => {
      disposed = true
      controller.abort()
      source?.close()
      window.clearInterval(pollTimer)
      window.clearInterval(freshnessTimer)
    }
  }, [])

  const agedSnapshot = useMemo(() => {
    if (!snapshot) return null
    return withClientFreshness(snapshot, Date.now())
  }, [snapshot, status])

  return { snapshot: agedSnapshot, status, error }
}
