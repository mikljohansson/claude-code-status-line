// Pure helpers: levels, bars, pace forecast, local time and path formatting.

export type Level = 'ok' | 'warn' | 'hot' | 'crit'

export const COLORS: Record<Level, string> = {
  ok: '#4fb37e',
  warn: '#d9b43c',
  hot: '#e3843a',
  crit: '#e2554f',
}

export const usageLevel = (p: number): Level =>
  p >= 90 ? 'crit' : p >= 75 ? 'hot' : p >= 50 ? 'warn' : 'ok'

export const contextLevel = (p: number): Level =>
  p >= 80 ? 'crit' : p >= 65 ? 'hot' : p >= 50 ? 'warn' : 'ok'

export const filledCells = (percent: number, cells: number) =>
  Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))

const HOUR = 3_600_000
export const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * HOUR,
  seven_day: 7 * 24 * HOUR,
}

export const windowOf = (kind: string) => WINDOW_MS[kind] ?? 5 * HOUR

export type Pace = { elapsed: number; projected?: number; runOutAt?: number }

// Straight-line projection from the share of the window used so far.
// Nothing before 10% of the window has passed: too noisy to be useful.
export function pace(percent: number, resetsAt: number, windowMs: number, now: number): Pace {
  const start = resetsAt - windowMs
  const elapsed = Math.max(0, Math.min(windowMs, now - start))
  if (elapsed < windowMs * 0.1 || percent <= 0) return { elapsed: elapsed / windowMs }
  const projected = Math.round((percent * windowMs) / elapsed)
  const runOutAt = start + (elapsed * 100) / percent
  return runOutAt < resetsAt
    ? { elapsed: elapsed / windowMs, projected, runOutAt }
    : { elapsed: elapsed / windowMs, projected }
}

export type Clock = {
  /** 24h HH:MM, prefixed with a weekday when not the same local day as `now`. */
  when: (ms: number, now: number) => string
  /** Zone abbreviation at that instant, such as CEST or CET. */
  zone: (ms: number) => string
}

export function makeClock(timeZone: string | undefined, weekdays: 'en' | 'de'): Clock {
  const tz = timeZone || undefined
  const locale = weekdays === 'de' ? 'de-DE' : 'en-GB'
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' })
  const zoneFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' })
  return {
    when: (ms, now) => {
      const hm = time.format(ms)
      if (day.format(ms) === day.format(now)) return hm
      return `${weekday.format(ms).replace(/\.$/, '')} ${hm}`
    },
    zone: ms => {
      const name = zoneFmt.formatToParts(ms).find(p => p.type === 'timeZoneName')?.value ?? ''
      return ZONE_NAMES[name] ?? name
    },
  }
}

// en-GB spells some zones as offsets; give Central Europe its usual names.
const ZONE_NAMES: Record<string, string> = { 'GMT+1': 'CET', 'GMT+2': 'CEST' }

// The last folder of a path; the home folder itself is "~".
export function lastSegment(path: string, home: string | undefined): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (home && trimmed.toLowerCase() === home.replace(/[\\/]+$/, '').toLowerCase()) return '~'
  return trimmed.split(/[\\/]/).pop() || trimmed
}

export function shortDir(cwd: string, home: string | undefined): string {
  const sep = cwd.includes('\\') ? '\\' : '/'
  let path = cwd
  if (home && path.toLowerCase().startsWith(home.toLowerCase())) {
    const rest = path.slice(home.length)
    if (rest === '' || rest[0] === '\\' || rest[0] === '/') path = '~' + rest
  }
  const parts = path.split(/[\\/]+/).filter((p, i) => p !== '' || i === 0)
  if (parts.length <= 4) return parts.join(sep) || sep
  return [parts[0], '…', ...parts.slice(-2)].join(sep)
}

// "claude-opus-5-5[1m]" -> "Opus 5.5 1M"; a name already readable passes through.
export function modelName(raw: string): string {
  const isLong = /\[1m\]/i.test(raw)
  const id = raw.replace(/\[1m\]/i, '').trim()
  const m = /^(?:claude-)?([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  const name = m ? `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? '.' + minor : ''}` : id
  return isLong ? `${name} 1M` : name
}

export const pct = (p: number) => `${Math.round(p)}%`.padStart(4)

export const tokensK = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

export const duration = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}
