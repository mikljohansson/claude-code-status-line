import { describe, expect, mock, test } from 'claude-code/testing'

import { lastSegment, makeClock, modelName, pace, shortDir, usageLevel } from '../hooks/format'

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
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
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
