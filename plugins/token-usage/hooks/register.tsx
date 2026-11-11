import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit, StateDollar } from 'claude-code'

import type { Limit, Totals } from '../types'

const PANE = 'token-usage'
const TITLE = 'Token usage'
const ZERO: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const REFRESH_MS = 2 * 60 * 1000
const LIMITS_KEY = 'lastLimits'
// Totals are saved per session, keyed by when it began, so a restart or a
// resumed session picks up where it left off. Only the newest few are kept.
const TOTALS_PREFIX = 'totals:'
const KEEP_SESSIONS = 20

// Session state: writing any of these redraws what reads it.
const totals = atom({ plugin: 'token-usage', key: 'totals' } as const, ZERO, {
  shape: 'totals-1',
})
const limits = atom({ plugin: 'token-usage', key: 'limits' } as const, [], {
  shape: 'limits-1',
})
const limitsAt = atom({ plugin: 'token-usage', key: 'limitsAt' } as const, 0)
const tick = atom({ plugin: 'token-usage', key: 'tick' } as const, 0)

// The slice of `$` the status refresh uses, from a hook or the timer.
type StatusDollar = StateDollar & {
  clock: { now: () => Promise<number> }
  ui: { status: (text: string | undefined) => void }
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Weekly limit',
  spend_limit: 'Spend limit',
}
const SHORT_NAMES: Record<string, string> = {
  five_hour: 'Session',
  seven_day: 'Week',
  spend_limit: 'Spend',
}

const isTotals = (v: unknown): v is Totals =>
  typeof v === 'object' &&
  v !== null &&
  ['input', 'output', 'cacheRead', 'cacheWrite'].every(
    k => typeof (v as Record<string, unknown>)[k] === 'number',
  )

const isLimits = (v: unknown): v is Limit[] =>
  Array.isArray(v) &&
  v.every(
    l =>
      typeof l === 'object' &&
      l !== null &&
      typeof l.kind === 'string' &&
      typeof l.percentUsed === 'number',
  )

// What the store holds under LIMITS_KEY: `{ list, at }`, or a bare list from 0.2/0.3.
const readSavedLimits = (v: unknown): { list: Limit[]; at: number } => {
  if (isLimits(v)) return { list: v, at: 0 }
  if (typeof v === 'object' && v !== null) {
    const o = v as { list?: unknown; at?: unknown }
    if (isLimits(o.list)) return { list: o.list, at: typeof o.at === 'number' ? o.at : 0 }
  }
  return { list: [], at: 0 }
}

const copyLimits = (list: readonly SessionRateLimit[]): Limit[] =>
  list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))

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

// How long ago the limits were reported: "now", "4m ago", "1h 12m ago".
const age = (at: number, now: number): string => {
  if (!at) return ''
  const mins = Math.floor(Math.max(0, now - at) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

const fmt = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n)

// The status entry under the prompt: limits and their age, then tokens.
const showStatus = async ($: StatusDollar): Promise<void> => {
  const t = await read($, totals)
  const windows: Limit[] = await read($, limits)
  const when = age(await read($, limitsAt), await $.clock.now())
  const limitText = windows
    .map(l => `${SHORT_NAMES[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`)
    .join(' · ')
  $.ui.status(
    [
      limitText && (when ? `${limitText} (${when})` : limitText),
      `${fmt(t.input + t.cacheRead + t.cacheWrite)} in · ${fmt(t.output)} out`,
    ]
      .filter(Boolean)
      .join(' · '),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({
      name: 'tokens',
      description: 'Show this session’s token usage in a pane',
    })

    const usage = await $.session.usage()
    const now = await $.clock.now()

    // Totals: what this session saved before a restart, unless the live
    // state (kept across a mod reload) already holds more.
    const saved = await $.store.get(TOTALS_PREFIX + usage.startedAt)
    if (isTotals(saved)) {
      await update($, totals, t =>
        t.input + t.output >= saved.input + saved.output ? t : saved,
      )
    }

    // Limits: live if a response reported them, else the last ones seen.
    if (usage.rateLimits.length) {
      const list = copyLimits(usage.rateLimits)
      await update($, limits, () => list)
      await update($, limitsAt, at => at || now)
    } else {
      const last = readSavedLimits(await $.store.get(LIMITS_KEY))
      await update($, limits, l => (l.length ? l : last.list))
      await update($, limitsAt, at => at || last.at)
    }

    void $.ui.open({ id: PANE, title: TITLE })
    await showStatus($)

    // Every 2 minutes: redraw the age in the status entry and the pane.
    $.clock.every(REFRESH_MS, () => {
      void update($, tick, n => n + 1).then(() => showStatus($))
    })

    return ran
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Token usage pane opened.' }
  })

  // Fires after each turn: new limits arrive with each response.
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length) {
      const list = copyLimits(e.rateLimits)
      const now = await $.clock.now()
      await update($, limits, () => list)
      await update($, limitsAt, () => now)
      await $.store.set(LIMITS_KEY, { list, at: now })
    }
    await showStatus($)
    return next(e)
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
      await showStatus($)

      const { startedAt } = await $.session.usage()
      await $.store.set(TOTALS_PREFIX + startedAt, t)
      const keys = (await $.store.keys()).filter(k => k.startsWith(TOTALS_PREFIX))
      for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_SESSIONS))) {
        await $.store.delete(old)
      }
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
    await read($, tick) // redraw on the timer, so the age stays current
    const t = await read($, totals)
    const windows: Limit[] = await read($, limits)
    const when = age(await read($, limitsAt), await $.clock.now())
    const usage = await $.session.usage()
    const ctx = usage.context

    return (
      <Box flexDirection="column" gap={1}>
        {windows.length === 0 && (
          <Text dimColor>Plan limits appear after the next reply.</Text>
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
        {windows.length > 0 && when && (
          <Text dimColor>
            Limits as of the last reply ({when}). Settings → Usage has the live figure.
          </Text>
        )}
        <Box flexDirection="column">
          <Text bold>
            {fmt(t.input + t.cacheRead + t.cacheWrite)} in · {fmt(t.output)} out
          </Text>
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
