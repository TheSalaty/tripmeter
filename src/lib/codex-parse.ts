import { CostBuilder, localDay } from './cost-builder.js'
import type { ForecastWindow, UsageDay } from './forecast.js'
import type { PriceTable } from './pricing.js'
import type { Cost, Limit } from './types.js'

type TokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

type RateWindow = {
  used_percent?: number
  window_minutes?: number
  resets_at?: number
}

type RolloutEvent = {
  timestamp?: string
  type?: string
  payload?: {
    type?: string
    model?: string
    forked_from_id?: string
    info?: {
      total_token_usage?: TokenUsage
      last_token_usage?: TokenUsage
    }
    rate_limits?: {
      primary?: RateWindow | null
      secondary?: RateWindow | null
      plan_type?: string | null
    } | null
  }
}

export type CodexAggregate = {
  cost: Cost
  warnings: string[]
}

export type CodexLimits = {
  limits: Limit[]
  limitsAt: string | null
  planType: string | null
  usage: Omit<ForecastWindow, 'nowMs'>
}

type LimitSample = {
  epochMs: number
  percent: number
  windowMinutes: number
  resetsAtMs: number
}

// Codex restamps the same window with a reset time that drifts by a second or two.
const WINDOW_KEY_MS = 300_000
const DAY_MINUTES = 1440

const num = (value: unknown): number => (typeof value === 'number' && isFinite(value) ? value : 0)

const FORK_COPY_MAX_GAP_MS = 1000

const cumulative = (usage: TokenUsage | undefined) => ({
  input: num(usage?.input_tokens),
  cached: num(usage?.cached_input_tokens),
  write: num(usage?.cache_write_input_tokens),
  output: num(usage?.output_tokens),
  reasoning: num(usage?.reasoning_output_tokens),
})

export const aggregateCodex = (
  sessions: Iterable<{ lines: Iterable<string> }>,
  options: { sinceMs: number; table: PriceTable },
): CodexAggregate => {
  const builder = new CostBuilder(options.table)
  let malformed = 0

  for (const session of sessions) {
    let previous = cumulative(undefined)
    let model = 'unknown'
    let sawSessionMeta = false
    let forkCopyAnchorMs: number | null = null

    for (const line of session.lines) {
      if (line.length === 0) continue
      let event: RolloutEvent
      try {
        event = JSON.parse(line) as RolloutEvent
      } catch {
        malformed += 1
        continue
      }

      if (event.type === 'session_meta' && !sawSessionMeta) {
        sawSessionMeta = true
        const at = Date.parse(event.timestamp ?? '')
        if (typeof event.payload?.forked_from_id === 'string' && isFinite(at)) forkCopyAnchorMs = at
        continue
      }
      if (event.type === 'turn_context' && typeof event.payload?.model === 'string') {
        model = event.payload.model
        continue
      }
      if (event.payload?.type !== 'token_count') continue

      const totals = event.payload.info?.total_token_usage
      if (totals === undefined) continue
      const current = cumulative(totals)
      const base =
        current.input < previous.input || current.output < previous.output
          ? cumulative(undefined)
          : previous
      const delta = {
        input: current.input - base.input,
        cached: current.cached - base.cached,
        write: current.write - base.write,
        output: current.output - base.output,
        reasoning: Math.max(0, current.reasoning - base.reasoning),
      }
      previous = current
      if (delta.input + delta.output === 0) continue

      const epochMs = Date.parse(event.timestamp ?? '')
      if (!isFinite(epochMs)) continue

      if (forkCopyAnchorMs !== null) {
        if (epochMs - forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
          forkCopyAnchorMs = epochMs
          continue
        }
        forkCopyAnchorMs = null
      }

      if (epochMs < options.sinceMs) continue

      builder.add({
        epochMs,
        model,
        usage: {
          uncachedInput: Math.max(0, delta.input - delta.cached - delta.write),
          cacheRead: delta.cached,
          cacheWrite: delta.write,
          cacheWrite1h: 0,
          output: delta.output,
        },
        reasoning: delta.reasoning,
        attributions: {},
      })
    }
  }

  const warnings: string[] = []
  const unpriced = builder.unpricedModels()
  if (unpriced.length > 0) warnings.push(`No price known for ${unpriced.join(', ')}`)
  if (malformed > 0) warnings.push(`${malformed} unparsable session line(s) skipped`)

  return { cost: builder.build(), warnings }
}

export const readLimits = (lines: Iterable<string>): CodexLimits => {
  const samples: LimitSample[] = []
  let latest: { windows: (RateWindow | null)[]; at: string; plan: string | null } | null = null

  for (const line of lines) {
    if (!line.includes('rate_limits')) continue
    let event: RolloutEvent
    try {
      event = JSON.parse(line) as RolloutEvent
    } catch {
      continue
    }

    const rateLimits = event.payload?.rate_limits
    const at = event.timestamp
    if (rateLimits === undefined || rateLimits === null || typeof at !== 'string') continue

    const windows = [rateLimits.primary ?? null, rateLimits.secondary ?? null]
    // Codex also logs a credits limit that carries no windows at all; letting it win would blank the menu.
    if (windows.every((window) => window === null)) continue

    const epochMs = Date.parse(at)
    for (const window of windows) {
      const minutes = num(window?.window_minutes)
      const resetsAt = window?.resets_at
      if (window === null || minutes <= 0 || typeof resetsAt !== 'number' || !isFinite(epochMs)) continue
      samples.push({
        epochMs,
        percent: num(window.used_percent),
        windowMinutes: minutes,
        resetsAtMs: resetsAt * 1000,
      })
    }

    if (latest === null || at > latest.at) {
      latest = { windows, at, plan: rateLimits.plan_type ?? null }
    }
  }

  const usage = dailyUsage(samples)
  if (latest === null) return { limits: [], limitsAt: null, planType: null, usage }
  return { limits: toLimits(latest.windows), limitsAt: latest.at, planType: latest.plan, usage }
}

/**
 * What each day took out of the weekly allowance, read off the rise in the reported percentage —
 * closer to what the limit measures than the dollar estimate the same sessions produce.
 */
const dailyUsage = (samples: readonly LimitSample[]): Omit<ForecastWindow, 'nowMs'> => {
  const windows = new Map<number, LimitSample[]>()
  let firstMs = Infinity
  for (const sample of samples) {
    if (sample.windowMinutes < DAY_MINUTES) continue
    firstMs = Math.min(firstMs, sample.epochMs)
    const key = Math.round(sample.resetsAtMs / WINDOW_KEY_MS)
    const bucket = windows.get(key)
    if (bucket === undefined) windows.set(key, [sample])
    else bucket.push(sample)
  }

  const perDate = new Map<string, number>()
  for (const bucket of windows.values()) {
    const highWaterByDate = new Map<string, number>()
    let highWater = 0
    for (const sample of [...bucket].sort((a, b) => a.epochMs - b.epochMs)) {
      // Parallel sessions log stale snapshots, so the reading only ever counts upwards.
      highWater = Math.max(highWater, sample.percent)
      highWaterByDate.set(localDay(sample.epochMs), highWater)
    }
    let previous = 0
    for (const [date, high] of [...highWaterByDate].sort((a, b) => a[0].localeCompare(b[0]))) {
      perDate.set(date, (perDate.get(date) ?? 0) + Math.max(0, high - previous))
      previous = high
    }
  }

  const days: UsageDay[] = [...perDate]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { days, sinceMs: firstMs === Infinity ? Date.now() : startOfDay(firstMs) }
}

const startOfDay = (epochMs: number): number => {
  const start = new Date(epochMs)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

export const windowLabel = (minutes: number): string => {
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24)
    return days === 7 ? 'Weekly (7 day)' : `${days} day`
  }
  if (minutes % 60 === 0) return `Session (${minutes / 60}h)`
  return `${minutes} min`
}

const toLimits = (windows: readonly (RateWindow | null)[]): Limit[] => {
  const limits: Limit[] = []
  for (const [index, window] of windows.entries()) {
    if (window === null) continue
    const minutes = num(window.window_minutes)
    limits.push({
      label: minutes > 0 ? windowLabel(minutes) : index === 0 ? 'Primary' : 'Secondary',
      percent: num(window.used_percent),
      resetsAt:
        typeof window.resets_at === 'number'
          ? new Date(window.resets_at * 1000).toISOString()
          : null,
      isActive: index === 0,
      windowMinutes: minutes > 0 ? minutes : null,
      forecast: null,
    })
  }
  // Shortest window first, so the session limit heads the section however full the weekly one is.
  return limits.sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity))
}
