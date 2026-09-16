import { localDay } from './cost-builder.js'
import type { UsageDay } from './forecast.js'

const DAY_MS = 86_400_000
// Sixteen days is as far back as a weekday rhythm is worth trusting — two of every weekday.
const KEEP_DAYS = 16

export type DailyUsage = Record<string, number>

/**
 * Folds the days this run read into the days earlier runs recorded, so a 24-hour cost window still
 * leaves the forecast a week's rhythm to read.
 */
export const mergeDailyUsage = (
  stored: DailyUsage,
  days: readonly UsageDay[],
  window: { sinceMs: number; nowMs: number },
): DailyUsage => {
  const merged: DailyUsage = {}
  const oldest = localDay(window.nowMs - KEEP_DAYS * DAY_MS)
  // A rolling 24-hour window starts mid-morning: its first day is only partly read, so the fuller
  // figure already on file for that day has to survive this run.
  const covered = localDay(
    startOfDay(window.sinceMs) === window.sinceMs ? window.sinceMs : window.sinceMs + DAY_MS,
  )

  for (const [date, amount] of Object.entries(stored)) {
    if (date >= oldest && date < covered) merged[date] = amount
  }
  // Days the run covered without spending anything are zeroes, not gaps — an idle Sunday is a fact.
  for (let at = window.sinceMs; at <= window.nowMs; at += DAY_MS) {
    const date = localDay(at)
    if (date >= covered) merged[date] = 0
  }
  for (const day of days) if (day.date >= covered) merged[day.date] = day.amount
  return merged
}

export const toUsageDays = (usage: DailyUsage): { days: UsageDay[]; sinceMs: number } => {
  const dates = Object.keys(usage).sort()
  const first = dates[0]
  return {
    days: dates.map((date) => ({ date, amount: usage[date] ?? 0 })),
    sinceMs: first === undefined ? Date.now() : new Date(`${first}T00:00:00`).getTime(),
  }
}

const startOfDay = (epochMs: number): number => {
  const start = new Date(epochMs)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}
