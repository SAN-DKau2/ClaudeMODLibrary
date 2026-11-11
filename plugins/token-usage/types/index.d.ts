export type Totals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'token-usage': {
      totals: Shaped<Totals>
      limits: Shaped<Limit[]>
      /** When the limits were last reported, ms since the epoch; 0 unknown. */
      limitsAt: number
      /** Bumped by the 2-minute timer so drawings showing the age redraw. */
      tick: number
    }
  }
}
