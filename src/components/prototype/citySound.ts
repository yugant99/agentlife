// Opt-in synthesized city sound: WebAudio only, no files. Default off; lazy init
// on the first user gesture after enable. Quiet bed + short cues on real
// transitions only (needs-input, ship, arrival). Rate-limited, muted when hidden.

export interface SoundAgentSnapshot {
  id: string
  workState: string
  freshness: string
  lastSignalAt: number
  toolKind?: string
}

export interface SoundEvents {
  needs: string[]
  ships: string[]
  arrivals: string[]
}

/** Diff snapshots by id + lastSignalAt. Pure. */
export function diffSoundEvents(prev: readonly SoundAgentSnapshot[], next: readonly SoundAgentSnapshot[]): SoundEvents {
  const prevById = new Map<string, SoundAgentSnapshot>()
  for (const agent of prev) prevById.set(agent.id, agent)
  const needs: string[] = []
  const ships: string[] = []
  const arrivals: string[] = []
  for (const agent of next) {
    const before = prevById.get(agent.id)
    if (!before) arrivals.push(agent.id)
    if (before && before.lastSignalAt === agent.lastSignalAt) continue
    if (agent.freshness === 'fresh' && agent.workState === 'needs-input') needs.push(agent.id)
    if (agent.freshness === 'fresh' && agent.toolKind === 'ship') ships.push(agent.id)
  }
  return { needs, ships, arrivals }
}

export type SoundCueKind = 'needs' | 'ship' | 'arrive'

const MIN_INTERVAL_MS: Record<SoundCueKind, number> = { needs: 8000, ship: 4000, arrive: 4000 }

/** Rate-limit gate. Pure. */
export function shouldPlayCue(kind: SoundCueKind, now: number, lastPlayedAt: number | undefined): boolean {
  if (!Number.isFinite(now)) return false
  if (lastPlayedAt === undefined || !Number.isFinite(lastPlayedAt)) return true
  return now - lastPlayedAt >= MIN_INTERVAL_MS[kind]
}

export function minIntervalFor(kind: SoundCueKind): number {
  return MIN_INTERVAL_MS[kind]
}

type CtxWindow = Window & { webkitAudioContext?: typeof AudioContext }

/** Browser engine. Construct once, keep in a ref — never in React state. */
export class CitySound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bedStarted = false
  private enabled = false
  private lastPlayed: Record<SoundCueKind, number | undefined> = { needs: undefined, ship: undefined, arrive: undefined }
  private onHidden: (() => void) | null = null

  isEnabled(): boolean {
    return this.enabled
  }

  /** Enable from a user gesture (click/keydown); lazy-creates the graph. */
  setEnabled(on: boolean): void {
    this.enabled = on
    if (typeof window === 'undefined') return
    if (on) {
      this.ensure()
      void this.ctx?.resume().catch(() => undefined)
    } else {
      void this.ctx?.suspend().catch(() => undefined)
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled)
    return this.enabled
  }

  /** Play one cue if enabled, rate-limited, and the tab is visible. */
  cue(kind: SoundCueKind): void {
    if (!this.enabled || typeof window === 'undefined' || document.hidden) return
    const now = Date.now()
    if (!shouldPlayCue(kind, now, this.lastPlayed[kind])) return
    if (!this.ensure()) return
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined)
    this.lastPlayed[kind] = now
    if (kind === 'needs') this.chime()
    else if (kind === 'ship') this.tick()
    else this.pluck()
  }

  dispose(): void {
    if (this.onHidden && typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onHidden)
      this.onHidden = null
    }
    try {
      this.ctx?.close().catch(() => undefined)
    } catch { /* never throws from HUD teardown */ }
    this.ctx = null
    this.master = null
    this.bedStarted = false
  }

  private ensure(): boolean {
    if (this.ctx) {
      if (!this.bedStarted) this.startBed()
      return true
    }
    try {
      const w = window as unknown as CtxWindow
      const AC = window.AudioContext ?? w.webkitAudioContext
      if (!AC) return false
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.063 // -24 dB: quiet bed under everything.
      this.master.connect(this.ctx.destination)
      this.startBed()
      this.onHidden = () => {
        if (document.hidden) void this.ctx?.suspend().catch(() => undefined)
        else if (this.enabled) void this.ctx?.resume().catch(() => undefined)
      }
      document.addEventListener('visibilitychange', this.onHidden)
      return true
    } catch {
      this.ctx = null
      return false
    }
  }

  private startBed(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.bedStarted) return
    this.bedStarted = true
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * 2))
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      noise.loop = true
      const low = ctx.createBiquadFilter()
      low.type = 'lowpass'
      low.frequency.value = 400
      const bedGain = ctx.createGain()
      bedGain.gain.value = 0.05
      noise.connect(low)
      low.connect(bedGain)
      bedGain.connect(master)
      noise.start()
      const padGain = ctx.createGain()
      padGain.gain.value = 0.02
      const padFilter = ctx.createBiquadFilter()
      padFilter.type = 'lowpass'
      padFilter.frequency.value = 900
      padGain.connect(padFilter)
      padFilter.connect(master)
      for (const freq of [110, 165]) {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq
        osc.connect(padGain)
        osc.start()
      }
    } catch { /* bed is decorative; cues still work */ }
  }

  private tone(freq: number, at: number, dur: number, peak: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    try {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = freq
      const gain = ctx.createGain()
      const t = ctx.currentTime
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      gain.connect(master)
      osc.connect(gain)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + dur + 0.05)
    } catch { /* cues never throw into the HUD */ }
  }

  private chime(): void {
    this.tone(660, 0, 0.5, 0.5)
    this.tone(880, 0.14, 0.6, 0.4)
  }

  private tick(): void {
    this.tone(1244, 0, 0.12, 0.35, 'triangle')
  }

  private pluck(): void {
    this.tone(440, 0, 0.6, 0.4)
  }
}
