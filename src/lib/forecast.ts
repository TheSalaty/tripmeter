import { localDay } from './cost-builder.js'
import type { Forecast, Limit } from './types.js'

/** What one calendar day consumed, in whatever unit tracks the limit best for that provider. */
export type UsageDay = {
  date: string
  amount: number
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

const MIN_ELAPSED = 0.05
const MIN_PROFILE_DAYS = 6
const MIN_SHARE = 0.02
// A single quiet Tuesday should tilt the profile, not define it.
const PROFILE_WEIGHT = 0.75
const MIN_WEIGHT = 0.35
const MAX_WEIGHT = 1.8

export type ForecastWindow = {
  days: readonly UsageDay[]
  sinceMs: number
  nowMs: number
}

export const withForecasts = (limits: readonly Limit[], window: ForecastWindow): Limit[] => {
  const weekdays = weekdayWeights(window)
  return limits.map((limit) => ({ ...limit, forecast: forecastLimit(limit, weekdays, window.nowMs) }))
}

const forecastLimit = (
  limit: Limit,
  weekdays: readonly number[] | null,
  nowMs: number,
): Forecast | null => {
  const windowMs = (limit.windowMinutes ?? 0) * MINUTE_MS
  // A five-hour window refills faster than the menu refreshes, so only day-plus windows are worth projecting.
  if (windowMs < DAY_MS || limit.resetsAt === null || limit.percent <= 0) return null
  const resetsAtMs = Date.parse(limit.resetsAt)
  if (!isFinite(resetsAtMs)) return null

  const startMs = resetsAtMs - windowMs
  if ((nowMs - startMs) / windowMs < MIN_ELAPSED || nowMs >= resetsAtMs) return null

  const share = elapsedShare(weekdays, startMs, resetsAtMs, nowMs)
  if (share < MIN_SHARE) return null

  const percent = Math.max(limit.percent, limit.percent / share)
  return { percent, fullAt: fullAt(limit.percent, percent, resetsAtMs, nowMs) }
}

/**
 * Share of the window's expected usage that the elapsed part of it carries — the weekday profile,
 * so an idle weekend inside the window counts for less than a Tuesday.
 */
const elapsedShare = (
  weekdays: readonly number[] | null,
  startMs: number,
  endMs: number,
  nowMs: number,
): number => {
  if (weekdays === null) return (nowMs - startMs) / (endMs - startMs)
  let elapsed = 0
  let total = 0
  for (let at = startMs; at < endMs; at += HOUR_MS) {
    const weight = weekdays[new Date(at).getDay()] ?? 1
    total += weight
    if (at < nowMs) elapsed += weight
  }
  return total === 0 ? 0 : elapsed / total
}

const fullAt = (
  percent: number,
  projected: number,
  resetsAtMs: number,
  nowMs: number,
): string | null => {
  if (projected <= 100 || percent >= 100) return null
  const perMs = (projected - percent) / (resetsAtMs - nowMs)
  if (perMs <= 0) return null
  return new Date(nowMs + (100 - percent) / perMs).toISOString()
}

/** How each weekday's spend compares with an average day, from the whole days the cost window covers. */
const weekdayWeights = ({ days, sinceMs, nowMs }: ForecastWindow): number[] | null => {
  const spend = new Map(days.map((day) => [day.date, day.amount]))
  const today = localDay(nowMs)
  const totals = new Array<number>(7).fill(0)
  const counts = new Array<number>(7).fill(0)
  let observed = 0

  for (let at = sinceMs; at < nowMs; at += DAY_MS) {
    const date = localDay(at)
    // Today is still being spent, so counting it would make every weekday it lands on look idle.
    if (date >= today) continue
    const weekday = new Date(at).getDay()
    totals[weekday] = (totals[weekday] ?? 0) + (spend.get(date) ?? 0)
    counts[weekday] = (counts[weekday] ?? 0) + 1
    observed += 1
  }
  if (observed < MIN_PROFILE_DAYS) return null

  const averages = totals.map((total, weekday) => {
    const count = counts[weekday] ?? 0
    return count === 0 ? null : total / count
  })
  const seen = averages.filter((average): average is number => average !== null)
  const overall = seen.reduce((sum, average) => sum + average, 0) / seen.length
  if (overall <= 0) return null

  // A weekday the window never covered gets the average, which leaves the projection unchanged for it.
  return averages.map((average) =>
    average === null
      ? 1
      : clamp(1 + PROFILE_WEIGHT * (average / overall - 1), MIN_WEIGHT, MAX_WEIGHT),
  )
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export type ForecastBand = 'low' | 'target' | 'high' | 'over'

export const forecastBand = (percent: number): ForecastBand => {
  if (percent > 100) return 'over'
  if (percent >= 95) return 'high'
  if (percent >= 85) return 'target'
  return 'low'
}
