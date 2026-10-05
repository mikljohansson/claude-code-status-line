export type QuotaLimit = { kind: string; percent: number; resetsAt?: number }

export type QuotaSnap = {
  dir: string
  path: string
  model: string
  context?: { percent: number; tokens?: number; window: number }
  limits: QuotaLimit[]
  /** The Fable weekly limit, read from the usage endpoint; absent when unknown. */
  fable?: QuotaLimit
}

declare module 'claude-code' {
  interface PluginState {
    'status-line': { snap: QuotaSnap | null; isExpanded: boolean; now: number; fable: QuotaLimit | null; user: string | null }
  }
}
