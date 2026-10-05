import { describe, expect, mock, test } from 'claude-code/testing'

import { fableLimit, lastSegment, makeClock, modelName, pace, runOutLevel, shortDir, usageLevel } from '../hooks/format'

const H = 3_600_000
const QUOTA = {
  command: 'quota',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 140 },
} as const
// Mon 5 Oct 2026 14:05 UTC = 16:05 CEST
const NOW = Date.UTC(2026, 9, 5, 14, 5)

describe('format', () => {
  test('reset times in Central European time, 24h', async () => {
    const clock = makeClock('Europe/Berlin', 'en')
    expect(clock.when(Date.UTC(2026, 9, 5, 16, 40), NOW)).toBe('18:40')
    expect(clock.when(Date.UTC(2026, 9, 12, 7, 0), NOW)).toBe('Mon 09:00')
    expect(clock.zone(NOW)).toBe('CEST')
    expect(clock.zone(Date.UTC(2026, 10, 2, 8, 0))).toBe('CET')
    expect(makeClock('Europe/Berlin', 'de').when(Date.UTC(2026, 9, 8, 7, 0), NOW)).toBe('Do 09:00')
  })

  test('system zone resolves', async () => {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(typeof zone).toBe('string')
  })

  test('pace projects a run-out time before the reset', async () => {
    const resetsAt = NOW + (300 - 145) * 60_000 // window started 145 min ago
    const p = pace(79, resetsAt, 5 * H, NOW)
    expect(p.projected).toBe(163)
    expect(makeClock('Europe/Berlin', 'en').when(p.runOutAt!, NOW)).toBe('16:43')
    expect(pace(30, resetsAt, 5 * H, NOW).runOutAt).toBeUndefined()
    expect(pace(30, NOW + 290 * 60_000, 5 * H, NOW).projected).toBeUndefined()
  })

  test('paths and model names', async () => {
    expect(shortDir('C:\\Users\\miklj\\projects\\verke', 'C:\\Users\\miklj')).toBe('~\\projects\\verke')
    expect(shortDir('C:\\Users\\miklj\\a\\b\\c\\d', 'C:\\Users\\miklj')).toBe('~\\…\\c\\d')
    expect(shortDir('C:\\Users\\miklj', 'C:\\Users\\miklj')).toBe('~')
    expect(lastSegment('C:\\Users\\miklj\\projects\\verke', 'C:\\Users\\miklj')).toBe('verke')
    expect(lastSegment('C:\\Users\\miklj\\', 'C:\\Users\\miklj')).toBe('~')
    expect(lastSegment('/home/me/code/app/', '/home/me')).toBe('app')
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('Opus 5.5')).toBe('Opus 5.5')
    expect(usageLevel(90)).toBe('crit')
    const h = 3_600_000
    expect(runOutLevel(19 * h - 15 * 60_000, 19 * h, 5 * h)).toBe('warn')
    expect(runOutLevel(16 * h, 19 * h, 5 * h)).toBe('crit')
    expect(runOutLevel(-2 * 24 * h, 0, 7 * 24 * h)).toBe('hot')
  })

  test('Fable weekly row of the usage endpoint', async () => {
    const row = (name: string, resets_at: unknown) => ({
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 37,
      resets_at,
      scope: { model: { display_name: name } },
    })
    expect(fableLimit({ limits: [row('Fable', '2026-10-10T23:00:00Z')] })).toEqual({
      kind: 'fable',
      percent: 37,
      resetsAt: Date.UTC(2026, 9, 10, 23),
    })
    expect(fableLimit({ limits: [row('fable', 1_790_000_000)] })?.resetsAt).toBe(1_790_000_000_000)
    expect(fableLimit({ limits: [row('Opus', null)] })).toBeUndefined()
    expect(fableLimit({ five_hour: {} })).toBeUndefined()
    expect(fableLimit(null)).toBeUndefined()
  })
})

describe('band', () => {
  test('draws the row once usage is measured', async ($, on) => {
    mock.env(on, { USERPROFILE: 'C:\\Users\\miklj' })
    mock.clock(on, { now: NOW })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    on('session.root', () => ({ value: 'C:\\Users\\miklj\\projects\\verke' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.measure', (_, e) => ({ changed: e.changed }))
    on('prompt.context', () => ({
      blocks: [{ name: 'userEmail', text: "The user's email address is user@example.com. Use it only to identify the user." }],
    }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
    on('http.fetch', (_, e) => ({
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          limits: [
            {
              kind: 'weekly_scoped',
              percent: 12,
              resets_at: new Date(NOW + 80 * H).toISOString(),
              scope: { model: { display_name: e.init?.auth === 'h1' ? 'Fable' : 'none' } },
            },
          ],
        }),
      },
    }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    await $.session.start({ cwd: 'C:\\Users\\miklj\\projects\\verke', surface: 'terminal', isInteractive: true })
    await $.prompt.context({ blocks: [] })
    await $.session.measure({
      context: { tokens: 128_000, window: 200_000, percent: 64 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(NOW + 3 * H).toISOString() },
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 80 * H).toISOString() },
      ],
      changed: ['context', 'rateLimits'],
    })
    const band = {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns: 140,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      const hint = await $.ui.mount({
        plugin: 'status-line',
        surface,
        component: 'PromptHint',
        props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
      })
      expect(await hint.find({ type: 'Text', text: 'verke' })).toBeDefined()
      expect(await hint.find({ type: 'Text', text: /64%/ })).toBeDefined()
      expect(await hint.find({ type: 'Text', text: 'F 12%' })).toBeDefined()
      expect(await hint.find({ type: 'Text', text: 'user@example.com' })).toBeDefined()
      expect(await hint.find({ type: 'Text', text: 'engine' })).toBeDefined()
      await hint.unmount()

      const details = await $.ui.mount({ plugin: 'status-line', surface, component: 'AbovePrompt', props: band })
      expect(await details.find({ type: 'Text', text: 'engine' })).toBeDefined()
      await details.unmount()
    }

    await $.command.run(QUOTA)
    for (const surface of ['terminal', 'desktop'] as const) {
      const details = await $.ui.mount({ plugin: 'status-line', surface, component: 'AbovePrompt', props: band })
      expect(await details.find({ type: 'Text', text: /128k\/200k tokens/ })).toBeDefined()
      expect(await details.find({ type: 'Text', text: '~\\projects\\verke' })).toBeDefined()
      await details.unmount()
    }
    await $.command.run(QUOTA)
  })
})
