import type { Account, Limit } from './types.js'

type ApiWindow = {
  utilization?: number
  resets_at?: string | null
}

type ApiLimit = {
  kind?: string
  group?: string
  percent?: number
  resets_at?: string | null
  is_active?: boolean
  scope?: { model?: { display_name?: string | null } | null; surface?: string | null } | null
}

type UsageResponse = {
  limits?: ApiLimit[]
  five_hour?: ApiWindow | null
  seven_day?: ApiWindow | null
}

const num = (value: unknown): number => (typeof value === 'number' && isFinite(value) ? value : 0)

const kindLabel = (limit: ApiLimit): string => {
  const scoped = limit.scope?.model?.display_name
  switch (limit.kind) {
    case 'session':
      return 'Session (5h)'
    case 'weekly_all':
      return 'Weekly (7 day)'
    case 'weekly_scoped':
      return scoped === undefined || scoped === null ? 'Weekly (scoped)' : `Weekly ${scoped}`
    default:
      break
  }
  const base = (limit.kind ?? limit.group ?? 'Limit').replace(/_/g, ' ')
  const capitalised = base.charAt(0).toUpperCase() + base.slice(1)
  return scoped === undefined || scoped === null ? capitalised : `${capitalised} ${scoped}`
}

export const parseUsage = (payload: unknown): Limit[] => {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as UsageResponse

  if (Array.isArray(response.limits) && response.limits.length > 0) {
    return response.limits
      .map((limit) => ({
        label: kindLabel(limit),
        percent: num(limit.percent),
        resetsAt: limit.resets_at ?? null,
        isActive: limit.is_active === true,
        windowMinutes: windowMinutes(limit.kind),
        forecast: null,
      }))
      .sort(byClaudePriority)
  }

  const legacy: Limit[] = []
  const add = (label: string, minutes: number, window: ApiWindow | null | undefined): void => {
    if (window === undefined || window === null) return
    legacy.push({
      label,
      percent: num(window.utilization),
      resetsAt: window.resets_at ?? null,
      isActive: false,
      windowMinutes: minutes,
      forecast: null,
    })
  }
  add('Session (5h)', 300, response.five_hour)
  add('Weekly (7 day)', 10_080, response.seven_day)
  return legacy.sort(byClaudePriority)
}

const windowMinutes = (kind: string | undefined): number | null => {
  if (kind === 'session') return 300
  return kind !== undefined && kind.startsWith('weekly') ? 10_080 : null
}

const byPercentDesc = (a: Limit, b: Limit): number => b.percent - a.percent

const byClaudePriority = (a: Limit, b: Limit): number =>
  Number(b.label === 'Session (5h)') - Number(a.label === 'Session (5h)') || byPercentDesc(a, b)

type ProfileResponse = {
  account?: { email?: string | null } | null
  organization?: { name?: string | null; organization_type?: string | null } | null
}

const planLabel = (organizationType: string | null | undefined, subscription: string | null): string | null => {
  switch (organizationType) {
    case 'claude_team':
      return 'Claude team'
    case 'claude_max':
      return 'Claude Max'
    case 'claude_pro':
      return 'Claude Pro'
    case 'claude_enterprise':
      return 'Claude Enterprise'
    default:
      break
  }
  if (subscription === null) return null
  return subscription.charAt(0).toUpperCase() + subscription.slice(1)
}

export const parseProfile = (payload: unknown, subscription: string | null): Account => {
  const response =
    payload !== null && typeof payload === 'object' ? (payload as ProfileResponse) : {}
  return {
    authMethod: 'Claude AI',
    email: response.account?.email ?? null,
    organization: response.organization?.name ?? null,
    plan: planLabel(response.organization?.organization_type, subscription),
  }
}
