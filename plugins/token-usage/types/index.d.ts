export type Totals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'token-usage': { totals: Shaped<Totals>; limits: Shaped<Limit[]> }
  }
}
