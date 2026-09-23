export type Provider = 'codex' | 'opencode' | 'manual'
export type WorkerStatus = 'active' | 'waiting' | 'needs-input' | 'review' | 'failed' | 'complete' | 'unknown'
export type TelemetryMode = 'disconnected' | 'loading' | 'live' | 'partial' | 'error' | 'simulation'
/** Client-side source selector, independent of the adapter's reported TelemetryMode. */
export type SourceMode = 'live' | 'simulation'

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  allowanceRemaining?: number
  allowanceLabel?: string
}

export interface AgentRecord {
  id: string
  parentId?: string
  provider: Provider
  model: string
  title: string
  status: WorkerStatus
  activity: string
  updatedAt: string
  usage?: Usage
  branch?: string
  role?: string
  district: DistrictId
  /**
   * Client-only marker set when this record was retained from an earlier successful
   * snapshot after a refresh failed. The adapter/server contract never sets it.
   * Stale records are shown as last-known, not current, and their scene motion is neutral.
   */
  stale?: boolean
  /**
   * Set when the record is real but outside the current six-hour freshness window: a
   * previously observed session retained for its project history. Historical records
   * are never counted as active, are labelled past in the roster and inspector, and
   * only loop ambiently in the scene. Distinct from `stale`, which means a refresh failed.
   */
  historical?: boolean
  /**
   * The runtime status the provider reported, preserved independently of the effective
   * `status`. For historical records the effective status is demoted (e.g. an old
   * `active` becomes `waiting`), and this keeps the original fact inspectable.
   */
  reportedStatus?: WorkerStatus
}

export type DistrictId =
  | 'great-hall'
  | 'watchtower'
  | 'forge'
  | 'proving-grounds'
  | 'scribe-hall'
  | 'oracle'
  | 'dock'

export interface TelemetryResponse {
  mode: Exclude<TelemetryMode, 'loading' | 'simulation'>
  records: AgentRecord[]
  providers: Record<'codex' | 'opencode', { connected: boolean; message: string }>
  diagnostics: AdapterDiagnostic[]
  fetchedAt: string
  message?: string
}

export interface AdapterDiagnostic {
  provider: 'codex' | 'opencode'
  state: 'connected' | 'limited' | 'disconnected' | 'error'
  adapter: string
  endpoint: string
  recordsReceived: number
  lastSuccessfulRefresh?: string
  failureReason?: string
  limitation?: string
}
