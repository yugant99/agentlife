import { Component, StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CourtyardHud } from './components/prototype/CourtyardHud'
import { CourtyardScene } from './components/prototype/CourtyardScene'
import type { RenderStats } from './components/prototype/CourtyardScene'
import { preferredDistrict } from './components/prototype/agentModel'
import * as city from './components/prototype/city'
import { cityCounts } from './components/prototype/datamap'
import { PROVIDER_PALETTE } from './components/prototype/heraldry'
import { majorityProvider, newShipEvents } from './components/prototype/vehicles'
import type { CameraShot, QualityTier } from './components/prototype/sceneControl'
import { createQualityState, parseQualityOverride, updateQuality } from './components/prototype/quality'
import type { QualityState } from './components/prototype/quality'
import {
  ATTRACT_IDLE_MS, INTRO_DURATION_MS, TOUR_SHOT_MS,
  advanceTourState, buildTourQueue, currentTourStop, idleDue,
  introFromShot, introToShot, markIntroSeen, parseAttractFlag,
  readIntroSeen, safeSessionStorage, shouldSkipIntro, shotForStop,
  startTourState, stopTourState,
} from './components/prototype/tour'
import type { TourState } from './components/prototype/tour'
import {
  SHOWCASE_RESUME_MS, STORY_BEATS, STORY_START_STEP, parseShowcaseFlag, showcaseQuality, showcaseShot, storyShot,
} from './components/prototype/showcase'
import {
  DWELL_MS, advanceScenario, createScenario, isFinished, resetScenario,
} from './components/prototype/scenario'
import { nextAttentionCity, toCitySnapshot } from './components/prototype/scenarioBridge'
import { useCityFeed } from './hooks/useCityFeed'
import './components/prototype/prototype.css'

// Mythic City prototype: the simulation scenario and the live city feed are two
// producers of CityAgent snapshots. The scene, HUD and roster only ever read the
// active producer's agents and never mix them. The original app (index.html /
// src/main.tsx) is untouched.

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

function readSearch(): string {
  try {
    return window.location.search
  } catch {
    return ''
  }
}

function PrototypeApp() {
  const [state, setState] = useState(() => createScenario())
  const [playing, setPlaying] = useState(true)
  const [selectedId, setSelectedId] = useState<string>()
  const [view, setView] = useState<city.View>({ scale: 'city' })
  const [focusRevision, setFocusRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [source, setSource] = useState<'live' | 'simulation'>('simulation')
  const [hasChosenSource, setHasChosenSource] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const webgl = useMemo(() => supportsWebGL(), [])
  const debug = useMemo(() => readDebugFlag(), [])
  // ?showcase=1: recording mode. HUD hidden (H toggles it), simulated day only,
  // steady quality tier, slow skyline camera reel. See showcase.ts.
  const showcase = useMemo(() => parseShowcaseFlag(readSearch()), [])
  const [hudVisible, setHudVisible] = useState(false)
  const statsSink = useRef<RenderStats>({ calls: 0, triangles: 0, frameMs: 0, width: 0, height: 0, pixelRatio: 1 })

  const feed = useCityFeed()
  const liveSnapshot = feed.snapshot
  const liveReady = feed.status === 'live' && liveSnapshot !== null
  const hasLiveSnapshot = liveSnapshot !== null
  // Live is the default once the feed reports live with a snapshot. Losing the
  // feed keeps the last snapshot (it ages by wall-clock time in the hook) and
  // never silently switches back to simulation. Showcase never auto-switches:
  // a recording must not put live workspace names on screen.
  useEffect(() => {
    if (!showcase && !hasChosenSource && liveReady) setSource('live')
  }, [showcase, hasChosenSource, liveReady])
  const isLive = source === 'live' && hasLiveSnapshot
  const livePaused = isLive && feed.status !== 'live'

  // The active producer's snapshot. Simulation is memoized on scenario steps so
  // selection and camera moves never rebuild worker identity; live snapshots
  // arrive from the feed hook. Never mix the two.
  const simSnapshot = useMemo(() => toCitySnapshot(state, Date.now()), [state])
  const agents = isLive && liveSnapshot ? liveSnapshot.agents : simSnapshot.agents
  const lastEvent = isLive && liveSnapshot
    ? `Live feed · ${liveSnapshot.agents.length} ${liveSnapshot.agents.length === 1 ? 'agent' : 'agents'} · snapshot ${new Date(liveSnapshot.generatedAt).toLocaleTimeString()}`
    : state.lastEvent
  const celebrationBy = useMemo(() => {
    if (isLive) return {}
    const map: Record<string, number> = {}
    const byNative = new Map(state.agents.map((agent) => [agent.id, agent]))
    for (const celebration of state.celebrations) {
      const agent = byNative.get(celebration.agentId)
      if (agent) map[`${agent.provider}:${agent.id}`] = celebration.id
    }
    return map
  }, [state, isLive])
  // Single truth definition: lit tram cars read cityCounts.working; the tint
  // follows the majority provider among fresh workers.
  const counts = useMemo(() => cityCounts(agents), [agents])
  const tramTint = PROVIDER_PALETTE[majorityProvider(agents)] ?? '#ff9b47'
  // Live ships: one departure per fresh ship-tool transition keyed by
  // id + lastSignalAt; re-delivered snapshots never double-fire.
  const seenShipKeys = useRef<Set<string>>(new Set())
  const [liveShipTotal, setLiveShipTotal] = useState(0)
  useEffect(() => {
    if (!isLive) return
    const fresh = newShipEvents(seenShipKeys.current, agents)
    if (fresh.length === 0) return
    for (const key of fresh) seenShipKeys.current.add(key)
    setLiveShipTotal((total) => total + fresh.length)
  }, [agents, isLive])
  const shipCount = isLive ? liveShipTotal : state.ships.length

  // --- Wave 3 Lane 3C: quality ladder, arrival glide, attract tour ------------
  const search = useMemo(() => readSearch(), [])
  const pinnedQuality = useMemo(() => showcaseQuality(parseQualityOverride(search), showcase), [search, showcase])
  const attractForced = useMemo(() => parseAttractFlag(search), [search])
  const [seenIntro] = useState(() => readIntroSeen(safeSessionStorage()))
  const skipIntro = useMemo(
    () => shouldSkipIntro({ search, reducedMotion, seen: seenIntro }) || attractForced || showcase,
    [search, reducedMotion, seenIntro, attractForced, showcase],
  )

  // Tier ladder: smoothed fps from the scene folds into the pure machine; only
  // tier changes re-render. ?quality= pins the tier.
  const qualityMachine = useRef<QualityState | null>(null)
  if (qualityMachine.current === null) qualityMachine.current = createQualityState(pinnedQuality)
  const [quality, setQuality] = useState<QualityTier>(() => qualityMachine.current?.tier ?? 'high')
  const lastFpsAt = useRef<number | null>(null)
  const handleFrameRate = useCallback((fps: number) => {
    const machine = qualityMachine.current
    if (!machine) return
    const now = performance.now()
    const last = lastFpsAt.current
    lastFpsAt.current = now
    const dt = last === null ? 1000 : Math.min(Math.max(now - last, 0), 5000)
    const next = updateQuality(machine, fps, dt)
    qualityMachine.current = next
    if (next.tier !== machine.tier) setQuality(next.tier)
  }, [])

  // The camera shot: arrival glide or attract tour while set, normal views once null.
  const [shot, setShot] = useState<CameraShot | null>(() => (skipIntro ? null : introFromShot()))
  const [tour, setTour] = useState<TourState>(() => stopTourState())
  const lastActivity = useRef<number>(Date.now())
  const tourSeq = useRef(0)
  const introCompleted = useRef(false)

  const stopTouring = useCallback(() => {
    setTour((current) => (current.active ? stopTourState() : current))
    setShot((current) => (current && current.id.startsWith('tour-') ? null : current))
  }, [])

  // Showcase reel: null while released to the user, else the current step.
  const [reelStep, setReelStep] = useState<number | null>(null)
  const reelSeq = useRef(0)
  // Showcase story: index into STORY_BEATS while it plays once on load, else null.
  const [storyBeat, setStoryBeat] = useState<number | null>(null)
  const storySeq = useRef(0)
  const releaseReel = useCallback(() => {
    setStoryBeat((current) => (current === null ? current : null))
    setReelStep((current) => (current === null ? current : null))
    setShot((current) => (current && current.id.startsWith('showcase-') ? null : current))
  }, [])

  // Any user input yields the tour (and the showcase reel) and releases the camera.
  const bumpActivity = useCallback(() => {
    lastActivity.current = Date.now()
    stopTouring()
    releaseReel()
  }, [stopTouring, releaseReel])

  const tourQueue = useMemo(() => buildTourQueue(agents), [agents])

  // Arrival glide: the initial shot holds ~1.25x out; on first ready the
  // camera eases home over 2.8 s, then the shot releases. StrictMode-safe:
  // the re-run reschedules after cleanup clears the first timer.
  useEffect(() => {
    if (!ready || !webgl) return
    if (skipIntro || introCompleted.current) {
      setShot((current) => (current && current.id.startsWith('intro') ? null : current))
      return
    }
    setShot(introToShot())
    const id = window.setTimeout(() => {
      introCompleted.current = true
      markIntroSeen(safeSessionStorage())
      setShot((current) => (current && current.id === 'intro' ? null : current))
    }, INTRO_DURATION_MS + 200)
    return () => window.clearTimeout(id)
  }, [ready, webgl, skipIntro])

  // Attract tour: one stop per shot, advancing about every 6 s.
  useEffect(() => {
    if (!tour.active) return
    tourSeq.current += 1
    setShot(shotForStop(currentTourStop(tourQueue, tour), tourSeq.current))
    const id = window.setTimeout(() => {
      setTour((current) => advanceTourState(current))
    }, TOUR_SHOT_MS)
    return () => window.clearTimeout(id)
  }, [tour, tourQueue])

  // Idle watch: 60 s without input (or ?attract=1) starts the tour once ready.
  // Reduced motion and pause keep a readable still scene, so no tour there.
  // Showcase runs its own reel instead of the district tour.
  useEffect(() => {
    if (!ready || !webgl || showcase) return
    if (reducedMotion || !playing) {
      stopTouring()
      return
    }
    if (tour.active) return
    const id = window.setInterval(() => {
      if (attractForced || idleDue(lastActivity.current, Date.now(), ATTRACT_IDLE_MS)) {
        setTour(startTourState())
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [ready, webgl, showcase, reducedMotion, playing, tour.active, attractForced, stopTouring])

  // Showcase: once ready, the story plays once (STORY_BEATS), restarting the
  // simulated day at STORY_START_STEP so its scripted events land on cue; then
  // the reel drifts between skyline poses. Reduced motion skips the story and
  // holds the first pose (the rig snaps). User input releases the camera and
  // ends the story; the reel takes the camera back after a short idle.
  const reelStarted = useRef(false)
  useEffect(() => {
    if (!showcase || !ready || !webgl || reelStarted.current) return
    reelStarted.current = true
    if (reducedMotion) {
      setReelStep(0)
      return
    }
    let day = resetScenario()
    for (let step = 0; step < STORY_START_STEP; step += 1) day = advanceScenario(day)
    setState(day)
    setPlaying(true)
    setStoryBeat(0)
  }, [showcase, ready, webgl, reducedMotion])

  useEffect(() => {
    if (storyBeat === null) return
    const beat = STORY_BEATS[storyBeat]
    storySeq.current += 1
    setShot(storyShot(storyBeat, storySeq.current))
    setHudVisible(beat.hud)
    if (beat.follow === 'none') {
      // Shots own the camera, so these only clear the inspector and tags.
      setSelectedId(undefined)
      setView((current) => (current.scale === 'city' ? current : { scale: 'city' }))
    }
    const id = window.setTimeout(() => {
      if (storyBeat + 1 < STORY_BEATS.length) {
        setStoryBeat(storyBeat + 1)
        return
      }
      setStoryBeat(null)
      setHudVisible(false)
      setReelStep(0)
    }, beat.holdMs)
    return () => window.clearTimeout(id)
  }, [storyBeat])

  useEffect(() => {
    if (!showcase || !ready || !webgl || reelStep !== null || storyBeat !== null || !reelStarted.current) return
    const id = window.setInterval(() => {
      if (idleDue(lastActivity.current, Date.now(), SHOWCASE_RESUME_MS)) setReelStep(0)
    }, 500)
    return () => window.clearInterval(id)
  }, [showcase, ready, webgl, reelStep, storyBeat])

  useEffect(() => {
    if (reelStep === null) return
    reelSeq.current += 1
    const next = showcaseShot(reelStep, reelSeq.current)
    setShot(next)
    if (reducedMotion) return
    const id = window.setTimeout(() => {
      setReelStep((current) => (current === null ? current : current + 1))
    }, next.durationMs)
    return () => window.clearTimeout(id)
  }, [reelStep, reducedMotion])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // The loading veil lifts only on the scene's onReady (or the error
  // boundary); WebGL failure keeps the plain-HTML fallback below.

  // One dwell timer per committed step (not a per-frame React state update).
  // The simulation timeline does not advance while live agents are shown.
  useEffect(() => {
    if (isLive || !playing || isFinished(state)) return
    const id = window.setTimeout(() => setState((current) => advanceScenario(current)), DWELL_MS)
    return () => window.clearTimeout(id)
  }, [playing, state, isLive])

  // Showcase loops the simulated day so a long recording never goes quiet.
  useEffect(() => {
    if (!showcase || isLive || !playing || !isFinished(state)) return
    const id = window.setTimeout(() => setState(resetScenario()), DWELL_MS * 3)
    return () => window.clearTimeout(id)
  }, [showcase, isLive, playing, state])

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

  // Needs-you beat: as soon as an agent needs you, hand the camera to the scene's
  // agent view: release the story shot, then select the agent one tick later
  // (after the rig has taken control back) so the camera glides to their Citadel
  // slot and the inspector says who is waiting and why.
  useEffect(() => {
    if (storyBeat === null || selectedId || STORY_BEATS[storyBeat].follow !== 'needs-you') return
    const next = nextAttentionCity(agents, undefined)
    if (!next) return
    setShot((current) => (current && current.id.startsWith('showcase-') ? null : current))
    const id = window.setTimeout(() => selectAgent(next), 60)
    return () => window.clearTimeout(id)
  }, [storyBeat, agents, selectedId, selectAgent])

  // Escape backs out one useful level: agent -> its district -> city. Never leaves a
  // stuck inspector.
  const escape = useCallback(() => {
    if (view.scale === 'agent') {
      const agent = agents.find((entry) => entry.id === view.agentId)
      if (agent) {
        goDistrict(preferredDistrict(agent))
        return
      }
      goCity()
    } else if (view.scale === 'district') {
      goCity()
    } else {
      setSelectedId(undefined)
    }
  }, [view, agents, goDistrict, goCity])

  const replay = useCallback(() => {
    setState(resetScenario())
    setPlaying(true)
    setSelectedId(undefined)
    setView({ scale: 'city' })
    setFocusRevision((value) => value + 1)
  }, [])

  const step = useCallback(() => setState((current) => advanceScenario(current)), [])

  const handleSource = useCallback((next: 'live' | 'simulation') => {
    setHasChosenSource(true)
    setSource(next)
    setSelectedId(undefined)
    setView({ scale: 'city' })
    setFocusRevision((value) => value + 1)
  }, [])

  const needsYou = useCallback(() => {
    const next = nextAttentionCity(agents, selectedId)
    if (next) selectAgent(next)
  }, [agents, selectedId, selectAgent])

  const handleReady = useCallback(() => setReady(true), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // H toggles the HUD in showcase without taking the camera from the reel.
      if (showcase && (event.key === 'h' || event.key === 'H')) {
        setHudVisible((value) => !value)
        return
      }
      bumpActivity()
      if (event.key === 'Escape') escape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escape, bumpActivity, showcase])

  return (
    <main className="proto-app" onPointerDown={bumpActivity} data-story-beat={storyBeat === null ? undefined : STORY_BEATS[storyBeat].name}>
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
            agents={agents}
            celebrationBy={celebrationBy}
            shipCount={shipCount}
            workingCount={counts.working}
            tramTint={tramTint}
            selectedId={selectedId}
            view={view}
            focusRevision={focusRevision}
            paused={!playing}
            reducedMotion={reducedMotion}
            showStats={debug}
            statsSink={statsSink}
            quality={quality}
            shot={shot}
            showcase={showcase}
            labels={!showcase || hudVisible}
            onFrameRate={handleFrameRate}
            onUserInteract={bumpActivity}
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
      {(!showcase || hudVisible) && <CourtyardHud
        agents={agents}
        lastEvent={lastEvent}
        playing={playing}
        finished={isLive ? true : isFinished(state)}
        view={view}
        selectedId={selectedId}
        source={isLive ? 'live' : 'simulation'}
        isLive={isLive}
        feedStatus={feed.status}
        liveAvailable={liveReady}
        livePaused={livePaused}
        showStats={debug}
        statsSink={statsSink}
        onCity={goCity}
        onDistrict={goDistrict}
        onSelect={selectAgent}
        onTogglePlay={() => setPlaying((value) => !value)}
        onReplay={replay}
        onStep={step}
        onNeedsYou={needsYou}
        onSource={handleSource}
      />}
      {webgl && !ready && <div className="proto-loading" role="status">Preparing the city…</div>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><PrototypeApp /></StrictMode>,
)
