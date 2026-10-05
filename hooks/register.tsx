import { atom, read, update } from 'claude-code'
import type {
  BoxProps,
  ElementConstructor,
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionRateLimit,
  TextProps,
} from 'claude-code'

import type { QuotaLimit, QuotaSnap } from '../types'
import {
  COLORS,
  contextLevel,
  duration,
  filledCells,
  makeClock,
  modelName,
  pace,
  pct,
  lastSegment,
  shortDir,
  tokensK,
  usageLevel,
  windowOf,
  type Clock,
  type Level,
} from './format'

const snap = atom({ plugin: 'quota-line', key: 'snap' } as const, null)
const isExpanded = atom({ plugin: 'quota-line', key: 'isExpanded' } as const, false)
const clockNow = atom({ plugin: 'quota-line', key: 'now' } as const, 0)

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'wk' }
const LONG_LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'weekly' }
const NARROW_BELOW = 90
const WARNED_KEY = 'warned'

type Options = { timeZone?: string; weekdays?: 'en' | 'de' }

async function refresh($: EngineInterface, clock: Clock, measured?: { context: SessionContextUsage; rateLimits: SessionRateLimit[] }) {
  const usage = measured ?? (await $.session.usage())
  const [root, model, profile, home] = await Promise.all([
    $.session.root(),
    $.session.model(),
    $.env.get('USERPROFILE'),
    $.env.get('HOME'),
  ])
  const ctx = usage.context
  const limits: QuotaLimit[] = usage.rateLimits
    .filter(l => l.kind in LABELS)
    .map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : undefined }))
  const next: QuotaSnap = {
    dir: lastSegment(root, profile ?? home),
    path: shortDir(root, profile ?? home),
    model: modelName(model),
    context: ctx.percent === undefined ? undefined : { percent: ctx.percent, tokens: ctx.tokens, window: ctx.window },
    limits,
  }
  const now = await $.clock.now()
  await update($, snap, () => next)
  await update($, clockNow, () => now)
  // The band covers terminal and desktop; a pinned status line there would only repeat it as a notice.
  const surfaces = await $.session.surfaces()
  const hasBand = surfaces.some(surface => surface === 'terminal' || surface === 'desktop')
  $.ui.status(hasBand ? undefined : statusText(clock, next, now))
  await warnPast90($, clock, limits)
}

function statusText(clock: Clock, s: QuotaSnap, now: number): string {
  const parts = [s.dir, s.model]
  if (s.context) parts.push(`ctx ${Math.round(s.context.percent)}%`)
  for (const l of s.limits) {
    let text = `${LABELS[l.kind]} ${Math.round(l.percent)}%`
    if (l.resetsAt) {
      const p = pace(l.percent, l.resetsAt, windowOf(l.kind), now)
      if (p.runOutAt) text += ` ⇥ ${clock.when(p.runOutAt, now)}`
      text += ` ↻ ${clock.when(l.resetsAt, now)}`
    }
    parts.push(text)
  }
  return parts.join(' │ ')
}

// One toast per window per reset, remembered across sessions.
async function warnPast90($: EngineInterface, clock: Clock, limits: QuotaLimit[]) {
  const stored = await $.store.get(WARNED_KEY)
  const warned = Array.isArray(stored) ? (stored as string[]) : []
  const fresh = limits.filter(l => l.percent >= 90 && !warned.includes(`${l.kind}@${l.resetsAt ?? ''}`))
  if (fresh.length === 0) return
  const now = await $.clock.now()
  for (const l of fresh) {
    const reset = l.resetsAt ? `, resets ${clock.when(l.resetsAt, now)}` : ''
    $.ui.toast(`${LONG_LABELS[l.kind]} limit at ${Math.round(l.percent)}%${reset}`)
  }
  const all = [...warned, ...fresh.map(l => `${l.kind}@${l.resetsAt ?? ''}`)].slice(-10)
  await $.store.set(WARNED_KEY, all)
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as Options
  const clock: Clock = makeClock(opts.timeZone?.trim() || undefined, opts.weekdays === 'de' ? 'de' : 'en')

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'quota', description: 'Show or hide usage details above the prompt.' })
    await refresh($, clock)
    $.clock.every(30_000, () => refresh($, clock))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await refresh($, clock, e)
    return result
  })

  on('command.run', { command: 'quota' }, async $ => {
    const open = await update($, isExpanded, v => !v)
    return { text: open ? 'Usage details shown above the prompt.' : 'Usage details hidden.' }
  })

  // The compact row, drawn on its own line just above the engine's hint line under the prompt.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engineLine = await next(e)
    const s = await read($, snap)
    if (!s) return engineLine
    const now = (await read($, clockNow)) || (await $.clock.now())
    const columns = e.viewport?.columns ?? 120
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawRow({ Box, Text }, clock, s, now, columns)}
        {engineLine}
      </Box>
    )
  })

  // The details, above the prompt, only while /quota has them open.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, snap)
    if (!s || !(await read($, isExpanded))) return next(e)
    const now = (await read($, clockNow)) || (await $.clock.now())
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawDetails({ Box, Text }, clock, s, now, e.props.bodyColumns)}
        {/* Clicks reach a Button only in the fullscreen layout; elsewhere /quota is the way to hide. */}
        <Box flexDirection="row">
          {e.viewport?.isFullscreen ? (
            <Button key="hide" plain dimColor label="hide details" onPress={() => update($, isExpanded, () => false)} />
          ) : (
            <Text dimColor>/quota to hide</Text>
          )}
        </Box>
      </Box>
    )
  })
}

type Kit = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

function bar({ Box, Text }: Kit, key: string, p: number, level: Level, cells: number, tickAt?: number) {
  const full = filledCells(p, cells)
  const showTick = tickAt !== undefined && tickAt >= full && tickAt < cells
  const before = showTick ? tickAt - full : cells - full
  const after = showTick ? cells - tickAt - 1 : 0
  return (
    <Box key={key} flexDirection="row">
      <Text color={COLORS[level]}>{'▰'.repeat(full)}</Text>
      <Text dimColor>{'▱'.repeat(before)}</Text>
      {showTick ? <Text color="#9aa5a0">┆</Text> : null}
      {showTick ? <Text dimColor>{'▱'.repeat(after)}</Text> : null}
    </Box>
  )
}

function percentText({ Text }: Kit, key: string, p: number, level: Level) {
  return <Text key={key} color={COLORS[level]} bold={level === 'crit'}>{pct(p)}</Text>
}

// "verke │ Opus 5.5 │ ctx ▰▰▱▱▱▱▱▱  23% │ 5h ▰▰▱▱▱  31% ↻ 14:20 / wk ▰▰▰▱▱  50% ⇥ Wed 21:48 ↻ Sat 01:00"
// Under NARROW_BELOW columns the bars drop out.
function drawRow(kit: Kit, clock: Clock, s: QuotaSnap, now: number, columns: number) {
  const { Box, Text } = kit
  const withBars = columns >= NARROW_BELOW
  const sep = (key: string, glyph = ' │ ') => <Text key={key} dimColor>{glyph}</Text>
  const ctx = s.context
  const ctxLevel = ctx ? contextLevel(ctx.percent) : 'ok'
  const limits = s.limits.flatMap((l, i) => {
    const level = usageLevel(l.percent)
    const p = l.resetsAt ? pace(l.percent, l.resetsAt, windowOf(l.kind), now) : undefined
    return [
      i > 0 ? sep(`ls${i}`, ' / ') : null,
      <Box key={l.kind} flexDirection="row">
        <Text dimColor>{LABELS[l.kind]} </Text>
        {withBars ? bar(kit, 'bar', l.percent, level, 5) : null}
        {percentText(kit, 'pct', l.percent, level)}
        {p?.runOutAt ? (
          <Text color={COLORS[level]} bold={level === 'crit'}> ⇥ {clock.when(p.runOutAt, now)}</Text>
        ) : null}
        {l.resetsAt ? <Text dimColor> ↻ {clock.when(l.resetsAt, now)}</Text> : null}
      </Box>,
    ]
  })
  return (
    <Box key="quota-row" flexDirection="row" flexWrap="wrap">
      <Text bold>{s.dir}</Text>
      {sep('s1')}
      <Text>{s.model}</Text>
      {ctx ? sep('s2') : null}
      {ctx ? <Text dimColor>ctx </Text> : null}
      {ctx && withBars ? bar(kit, 'ctxb', ctx.percent, ctxLevel, 8) : null}
      {ctx ? percentText(kit, 'ctxp', ctx.percent, ctxLevel) : null}
      {s.limits.length > 0 ? sep('s3') : null}
      {limits}
    </Box>
  )
}

function drawDetails(kit: Kit, clock: Clock, s: QuotaSnap, now: number, columns: number) {
  const { Box, Text } = kit
  const cells = columns < NARROW_BELOW ? 10 : 20
  const label = (text: string) => <Text dimColor>{text.padEnd(9)}</Text>
  const ctx = s.context
  const ctxLevel = ctx ? contextLevel(ctx.percent) : 'ok'
  return (
    <Box key="quota-details" flexDirection="column">
      <Box flexDirection="row">
        {label('project')}
        <Text wrap="truncate-start">{s.path}</Text>
      </Box>
      {ctx ? (
        <Box flexDirection="row">
          {label('context')}
          {bar(kit, 'b', ctx.percent, ctxLevel, cells)}
          {percentText(kit, 'p', ctx.percent, ctxLevel)}
          {ctx.tokens !== undefined ? (
            <Text dimColor>  {tokensK(ctx.tokens)}/{tokensK(ctx.window)} tokens</Text>
          ) : null}
        </Box>
      ) : null}
      {s.limits.flatMap(l => {
        const level = usageLevel(l.percent)
        const p = l.resetsAt ? pace(l.percent, l.resetsAt, windowOf(l.kind), now) : undefined
        const tickAt = p ? Math.min(cells - 1, Math.floor(p.elapsed * cells)) : undefined
        const rows = [
          <Box key={`d-${l.kind}`} flexDirection="row">
            {label(LONG_LABELS[l.kind] ?? l.kind)}
            {bar(kit, 'b', l.percent, level, cells, tickAt)}
            {percentText(kit, 'p', l.percent, level)}
            {l.resetsAt ? (
              <Text dimColor>
                {'  '}resets {clock.when(l.resetsAt, now)} {clock.zone(l.resetsAt)} (in {duration(l.resetsAt - now)})
              </Text>
            ) : null}
          </Box>,
        ]
        if (p?.runOutAt) {
          rows.push(
            <Box key={`f-${l.kind}`} flexDirection="row">
              {label('')}
              <Text color={COLORS[level]} bold={level === 'crit'}>
                ⇥ {clock.when(p.runOutAt, now)} {clock.zone(p.runOutAt)}: on pace for ~{p.projected}%, you run out before the reset
              </Text>
            </Box>,
          )
        } else if (p?.projected !== undefined) {
          rows.push(
            <Box key={`f-${l.kind}`} flexDirection="row">
              {label('')}
              <Text dimColor>on pace for about {p.projected}% by reset</Text>
            </Box>,
          )
        }
        return rows
      })}
    </Box>
  )
}
