import GLib from 'gi://GLib'

import type { ForecastWindow, UsageDay } from '../lib/forecast.js'
import { mergeDailyUsage, toUsageDays, type DailyUsage } from '../lib/history.js'
import type { ProviderId } from '../lib/types.js'

import { readJsonFile, writeJsonFile } from './io.js'

type Stored = Partial<Record<ProviderId, DailyUsage>>

const path = (): string =>
  GLib.build_filenamev([GLib.get_user_state_dir(), 'tripmeter', 'daily-usage.json'])

/** Daily usage the collector has seen, kept across runs so the weekday profile outlives one window. */
export const recordDailyUsage = (
  provider: ProviderId,
  days: readonly UsageDay[],
  window: { sinceMs: number; nowMs: number },
): Omit<ForecastWindow, 'nowMs'> => {
  const stored = (readJsonFile(path()) as Stored | null) ?? {}
  const merged = mergeDailyUsage(stored[provider] ?? {}, days, window)
  stored[provider] = merged
  writeJsonFile(path(), stored)
  return toUsageDays(merged)
}
