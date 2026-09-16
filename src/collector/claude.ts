import GLib from 'gi://GLib'

import { aggregateClaude } from '../lib/claude-parse.js'
import { parseProfile, parseUsage } from '../lib/claude-usage.js'
import { withForecasts } from '../lib/forecast.js'
import type { PriceTable } from '../lib/pricing.js'
import { emptyCost, type Account, type Limit, type Provider } from '../lib/types.js'
import { recordDailyUsage } from './history.js'
import { exists, httpGet, isoSeconds, onPath, readJsonFile, runShell, writeJsonFile } from './io.js'

const API = 'https://api.anthropic.com'
const OAUTH_BETA = 'oauth-2025-04-20'

const home = (): string => GLib.get_home_dir()
const claudeDir = (): string => GLib.build_filenamev([home(), '.claude'])
const projectsDir = (): string => GLib.build_filenamev([claudeDir(), 'projects'])
const credentialsPath = (): string => GLib.build_filenamev([claudeDir(), '.credentials.json'])

export const claudeInstalled = (): boolean =>
  exists(claudeDir()) || onPath('claude')

type Credentials = {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    subscriptionType?: string
  }
}

type Token = {
  value: string
  expiresAtMs: number | null
}

const readCredentials = (): Credentials | null => readJsonFile(credentialsPath()) as Credentials | null

const readToken = (payload: Credentials | null): Token | null => {
  const oauth = payload?.claudeAiOauth
  if (oauth === undefined || typeof oauth.accessToken !== 'string') return null
  return {
    value: oauth.accessToken,
    expiresAtMs: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
  }
}

const readSubscription = (payload: Credentials | null): string | null => {
  const type = payload?.claudeAiOauth?.subscriptionType
  return typeof type === 'string' ? type : null
}

type Fetched = {
  status: number
  payload: unknown
}

const oauthGet = (path: string, token: string): Fetched => {
  const result = httpGet(`${API}${path}`, {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': OAUTH_BETA,
    Accept: 'application/json',
  })
  if (result.status !== 200) return { status: result.status, payload: null }
  try {
    return { status: result.status, payload: JSON.parse(result.body) as unknown }
  } catch {
    return { status: result.status, payload: null }
  }
}

// api.anthropic.com rate-limits these two endpoints hard: a second call seconds after the first
// comes back 429, and the menu refreshes on every open. Both reads are served from a cache until
// they age out, and a failed read falls back to the last good one rather than blanking the section.
const USAGE_MAX_AGE_MS = 4 * 60_000
const PROFILE_MAX_AGE_MS = 24 * 3_600_000

type CacheEntry<T> = {
  fetchedAt: string
  value: T
}

type UsageCache = {
  usage?: CacheEntry<Limit[]>
  profile?: CacheEntry<Account>
}

const cachePath = (): string =>
  GLib.build_filenamev([GLib.get_user_state_dir(), 'tripmeter', 'claude-usage.json'])

const readCache = (): UsageCache => (readJsonFile(cachePath()) as UsageCache | null) ?? {}

const ageOf = <T>(entry: CacheEntry<T> | undefined, nowMs: number): number => {
  const at = entry === undefined ? NaN : Date.parse(entry.fetchedAt)
  return isFinite(at) ? nowMs - at : Infinity
}

const reason = (status: number): string =>
  status === 0 ? 'no response' : `HTTP ${status}`

const transcriptLines = (sinceMs: number): string[] => {
  const root = projectsDir()
  if (!exists(root)) return []
  const stdout = runShell(
    'find "$ROOT" -name "*.jsonl" -newermt "$SINCE" -print0 2>/dev/null' +
      ' | xargs -0 -r grep -h --binary-files=text -e \'"type":"assistant"\' 2>/dev/null' +
      ' || true',
    { ROOT: root, SINCE: isoSeconds(sinceMs) },
  )
  return stdout.length === 0 ? [] : stdout.split('\n')
}

export const collectClaude = (options: { sinceMs: number; nowMs: number; table: PriceTable }): Provider => {
  const warnings: string[] = []
  const provider: Provider = {
    id: 'claude',
    name: 'Claude Code',
    account: { authMethod: null, email: null, organization: null, plan: null },
    limits: [],
    limitsAt: null,
    cost: emptyCost(),
    warnings,
  }

  const credentials = readCredentials()
  const token = readToken(credentials)
  if (token === null) {
    warnings.push('Not signed in — no credentials in ~/.claude/.credentials.json')
  } else if (token.expiresAtMs !== null && token.expiresAtMs <= options.nowMs) {
    warnings.push('Access token expired — start Claude Code once to refresh it')
  } else {
    const cache = readCache()
    const subscription = readSubscription(credentials)

    if (ageOf(cache.usage, options.nowMs) < USAGE_MAX_AGE_MS && cache.usage !== undefined) {
      provider.limits = cache.usage.value
    } else {
      const usage = oauthGet('/api/oauth/usage', token.value)
      if (usage.payload !== null) {
        provider.limits = parseUsage(usage.payload)
        cache.usage = { fetchedAt: new Date(options.nowMs).toISOString(), value: provider.limits }
      } else if (cache.usage !== undefined) {
        provider.limits = cache.usage.value
        provider.limitsAt = cache.usage.fetchedAt
        warnings.push(`api.anthropic.com declined the limits read (${reason(usage.status)})`)
      } else {
        warnings.push(`Could not read usage limits from api.anthropic.com (${reason(usage.status)})`)
      }
    }

    if (ageOf(cache.profile, options.nowMs) < PROFILE_MAX_AGE_MS && cache.profile !== undefined) {
      provider.account = cache.profile.value
    } else {
      const profile = oauthGet('/api/oauth/profile', token.value)
      if (profile.payload !== null) {
        provider.account = parseProfile(profile.payload, subscription)
        cache.profile = { fetchedAt: new Date(options.nowMs).toISOString(), value: provider.account }
      } else if (cache.profile !== undefined) {
        provider.account = cache.profile.value
      } else {
        provider.account = parseProfile(null, subscription)
      }
    }

    writeJsonFile(cachePath(), cache)
  }

  const aggregate = aggregateClaude(transcriptLines(options.sinceMs), options)
  provider.cost = aggregate.cost
  warnings.push(...aggregate.warnings)

  // Claude reports no usage history of its own, so the weekday profile leans on what the
  // transcripts cost — a proxy for the limit, but the only one on this side.
  const history = recordDailyUsage(
    'claude',
    aggregate.cost.days.map(({ date, usd }) => ({ date, amount: usd })),
    options,
  )
  provider.limits = withForecasts(provider.limits, { ...history, nowMs: options.nowMs })
  return provider
}
