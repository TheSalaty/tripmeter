import GLib from 'gi://GLib'

import { aggregateClaude } from '../lib/claude-parse.js'
import { parseProfile, parseUsage } from '../lib/claude-usage.js'
import { withForecasts } from '../lib/forecast.js'
import type { PriceTable } from '../lib/pricing.js'
import { emptyCost, type Provider } from '../lib/types.js'
import { recordDailyUsage } from './history.js'
import { exists, httpGet, isoSeconds, onPath, readJsonFile, runShell } from './io.js'

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

const oauthGet = (path: string, token: string): unknown => {
  const result = httpGet(`${API}${path}`, {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': OAUTH_BETA,
    Accept: 'application/json',
  })
  if (result.status !== 200) return null
  try {
    return JSON.parse(result.body) as unknown
  } catch {
    return null
  }
}

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
  } else if (token.expiresAtMs !== null && token.expiresAtMs <= Date.now()) {
    warnings.push('Access token expired — start Claude Code once to refresh it')
  } else {
    const usage = oauthGet('/api/oauth/usage', token.value)
    if (usage === null) {
      warnings.push('Could not read usage limits from api.anthropic.com')
    } else {
      provider.limits = parseUsage(usage)
    }
    provider.account = parseProfile(oauthGet('/api/oauth/profile', token.value), readSubscription(credentials))
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
