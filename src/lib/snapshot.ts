import type { Limit, PanelLimitSource, Provider, Snapshot, WindowDays } from './types.js'

export const isWindowDays = (value: number): value is WindowDays =>
  value === 1 || value === 7 || value === 30

export const windowStartMs = (windowDays: WindowDays, nowMs: number): number => {
  if (windowDays === 1) return nowMs - 86_400_000
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)
  return start.getTime() - (windowDays - 1) * 86_400_000
}

export const tightestLimit = (snapshot: Snapshot): { provider: Provider; limit: Limit } | null => {
  let best: { provider: Provider; limit: Limit } | null = null
  for (const provider of snapshot.providers) {
    for (const limit of provider.limits) {
      if (best === null || limit.percent > best.limit.percent) best = { provider, limit }
    }
  }
  return best
}

export const panelLimits = (
  snapshot: Snapshot,
  source: PanelLimitSource,
): { provider: Provider; limit: Limit }[] => {
  const providers = source === 'both' ? snapshot.providers : snapshot.providers.filter(({ id }) => id === source)
  return providers.flatMap((provider) => {
    // Both providers list their shortest window first, and that is the one the panel tracks.
    const limit = provider.limits[0]
    return limit === undefined ? [] : [{ provider, limit }]
  })
}

export const totalUsd = (snapshot: Snapshot): number =>
  snapshot.providers.reduce((sum, provider) => sum + provider.cost.usd, 0)

export type Severity = 'normal' | 'warning' | 'critical'

export const severityFor = (percent: number): Severity => {
  if (percent >= 90) return 'critical'
  if (percent >= 70) return 'warning'
  return 'normal'
}

export const isSnapshot = (value: unknown): value is Snapshot => {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<Snapshot>
  return (
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.since === 'string' &&
    typeof candidate.windowDays === 'number' &&
    Array.isArray(candidate.providers) &&
    Array.isArray(candidate.warnings)
  )
}
