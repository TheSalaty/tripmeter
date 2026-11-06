import type { Limit } from './types.js'

// How a limit's use compares with an even spread over its window: at 40% of the
// way to the reset, 40% used is exactly on pace.

export type PaceStatus = 'under' | 'on' | 'over'

export type Pace = {
  // Where an even spread would be by now, 0–100.
  expected: number
  // Used minus expected, in percentage points.
  delta: number
  status: PaceStatus
  // When the limit runs out at the current rate, if that is before the reset.
  runsOutAtMs: number | null
}

// Within this many points of the even spread counts as on pace.
const ON_PACE_BAND = 5
// Too early in a window to say anything useful about the rate.
const MIN_ELAPSED_FRACTION = 0.05

export const windowMinutesFor = (label: string): number | null => {
  const hours = /\((\d+)h\)/.exec(label)
  if (hours !== null) return Number(hours[1]) * 60
  if (/^weekly/i.test(label)) return 7 * 24 * 60
  const days = /(\d+)[ -]day/i.exec(label)
  if (days !== null) return Number(days[1]) * 24 * 60
  const minutes = /^(\d+) min$/.exec(label)
  if (minutes !== null) return Number(minutes[1])
  return null
}

export const paceFor = (limit: Limit, nowMs: number): Pace | null => {
  const minutes = limit.windowMinutes ?? windowMinutesFor(limit.label)
  const resetMs = limit.resetsAt === null ? NaN : Date.parse(limit.resetsAt)
  if (minutes === null || !isFinite(resetMs)) return null

  const windowMs = minutes * 60_000
  const startMs = resetMs - windowMs
  const elapsed = Math.min(1, Math.max(0, (nowMs - startMs) / windowMs))
  if (resetMs <= nowMs) return null

  const expected = elapsed * 100
  const delta = limit.percent - expected
  const status: PaceStatus =
    delta > ON_PACE_BAND ? 'over' : delta < -ON_PACE_BAND ? 'under' : 'on'

  let runsOutAtMs: number | null = null
  if (elapsed >= MIN_ELAPSED_FRACTION && limit.percent > 0) {
    const usedMs = nowMs - startMs
    const emptyAtMs = startMs + (usedMs * 100) / limit.percent
    if (emptyAtMs < resetMs) runsOutAtMs = Math.max(nowMs, emptyAtMs)
  }
  return { expected, delta, status, runsOutAtMs }
}
