import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Totals } from '../types'

const PANE = 'token-usage'
const TITLE = 'Token usage'
const ZERO: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

// Kept in session state so a reload of the mod keeps the running totals;
// writing it redraws the pane.
const totals = atom({ plugin: 'token-usage', key: 'totals' } as const, ZERO, {
  shape: 'totals-1',
})

// The account's rate-limit windows, pushed by `session.measure`.
const limits = atom({ plugin: 'token-usage', key: 'limits' } as const, [], {
  shape: 'limits-1',
})

const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Weekly limit',
  spend_limit: 'Spend limit',
}

const bar = (pct: number, width = 20): string => {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const resets = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const sameDay = d.toDateString() === new Date().toDateString()
  return `Resets ${sameDay ? '' : days[d.getDay()] + ' '}${hh}:${mm}`
}

const fmt = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n)

const line = (t: Totals): string =>
  `Tokens: ${fmt(t.input + t.cacheRead + t.cacheWrite)} in · ${fmt(t.output)} out`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({
      name: 'tokens',
      description: 'Show this session’s token usage in a pane',
    })
    const now = await $.session.usage()
    await update($, limits, () => now.rateLimits.map(l => ({ ...l })))
    void $.ui.open({ id: PANE, title: TITLE })
    $.ui.status(line(await read($, totals)))
    return ran
  })

  // Rate limits and context moved: store them, which redraws the pane.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits.map(l => ({ ...l })))
    }
    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Token usage pane opened.' }
  })

  // Every turn's summed usage, main loop and subagents alike.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    const u = e.usage
    if (u) {
      const t = await update($, totals, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
      }))
      $.ui.status(line(t))
    }
    return ran
  })

  // /clear starts the session over: reset the totals.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, totals, () => ZERO)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, totals)
    const windows: Limit[] = await read($, limits)
    const usage = await $.session.usage()
    const ctx = usage.context

    return (
      <Box flexDirection="column" gap={1}>
        {windows.length === 0 && (
          <Text dimColor>No plan limits reported yet.</Text>
        )}
        {windows.map(l => (
          <Box key={l.kind} flexDirection="column">
            <Text bold>{LIMIT_NAMES[l.kind] ?? l.kind}</Text>
            <Text>
              {bar(l.percentUsed)} {l.percentUsed}% used
            </Text>
            {l.resetsAt && <Text dimColor>{resets(l.resetsAt)}</Text>}
          </Box>
        ))}
        <Box flexDirection="column">
        <Text bold>{fmt(t.input + t.cacheRead + t.cacheWrite)} in · {fmt(t.output)} out</Text>
        <Text dimColor>Uncached input: {fmt(t.input)}</Text>
        <Text dimColor>Cache read: {fmt(t.cacheRead)}</Text>
        <Text dimColor>Cache write: {fmt(t.cacheWrite)}</Text>
        <Text dimColor>Output: {fmt(t.output)}</Text>
        {ctx.tokens !== undefined && (
          <Text dimColor>
            Context: {fmt(ctx.tokens)} / {fmt(ctx.window)} ({ctx.percent ?? 0}%)
          </Text>
        )}
        {usage.cost && <Text dimColor>Cost: ${usage.cost.usd.toFixed(2)}</Text>}
        </Box>
      </Box>
    )
  })
}
