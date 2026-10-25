export type UsageWindow = {
  kind: string
  percentUsed: number
  resetsAt: string | null
}

export type Reading = {
  windows: UsageWindow[]
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  measuredAt: number
}

export type LiveTotals = { session: number; day: number; week: number; month: number; all: number }

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// Das Kontextfenster wie /context, gekürzt auf das, was Leiste und Fenster zeigen.
export type ContextInfo = {
  model: string
  total: number
  max: number
  percent: number
  categories: { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  autoCompactAt: number | null
  memoryFiles: { path: string; tokens: number }[]
  mcp: { loaded: number; all: number; tokens: number }
  skills: { included: number; all: number; tokens: number } | null
  agents: { count: number; tokens: number }
  // Die letzte Antwort: wie viel der Eingabe aus dem Cache kam.
  cache: { read: number; written: number; fresh: number } | null
  measuredAt: number
}

declare module 'claude-code' {
  interface PluginState {
    burn: {
      reading: Shaped<Reading | null>
      tokens: Shaped<TokenTotals>
      startedAt: number
      now: number
      view: number
      isHidden: boolean
      range: number
      tab: number
      live: Shaped<LiveTotals>
      liveCost: Shaped<LiveTotals>
      liveOut: Shaped<LiveTotals>
      liveSpan: number
      streamed: number
      lag: number
      drip: number
      flow: number
      role: number
      arrival: number
      heat: number
      flicker: number
      isLight: boolean
      context: Shaped<ContextInfo | null>
    }
  }
}
