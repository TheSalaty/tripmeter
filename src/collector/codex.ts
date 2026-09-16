import GLib from 'gi://GLib'

import { aggregateCodex, readLimits } from '../lib/codex-parse.js'
import { withForecasts } from '../lib/forecast.js'
import type { PriceTable } from '../lib/pricing.js'
import type { Provider } from '../lib/types.js'
import { exists, isoSeconds, onPath, readTextFile, runShell } from './io.js'

const home = (): string => GLib.get_home_dir()
const codexDir = (): string => GLib.build_filenamev([home(), '.codex'])
const sessionsDir = (): string => GLib.build_filenamev([codexDir(), 'sessions'])

export const codexInstalled = (): boolean => exists(codexDir()) || onPath('codex')

const sessionFiles = (sinceMs: number): string[] => {
  const root = sessionsDir()
  if (!exists(root)) return []
  const recent = runShell(
    'find "$ROOT" -name "rollout-*.jsonl" -newermt "$SINCE" 2>/dev/null || true',
    { ROOT: root, SINCE: isoSeconds(sinceMs) },
  )
  const newest = runShell(
    'find "$ROOT" -name "rollout-*.jsonl" -printf "%T@ %p\\n" 2>/dev/null' +
      ' | sort -rn | head -3 | cut -d" " -f2- || true',
    { ROOT: root },
  )
  const paths = new Set<string>()
  for (const line of `${recent}\n${newest}`.split('\n')) {
    const path = line.trim()
    if (path.length > 0) paths.add(path)
  }
  return [...paths]
}

// A forecast needs the window before this one, and Codex stamps every token_count with the limits it saw.
const LIMIT_HISTORY_DAYS = 16

const limitHistory = (nowMs: number): string[] => {
  const root = sessionsDir()
  if (!exists(root)) return []
  const lines = runShell(
    'find "$ROOT" -name "rollout-*.jsonl" -newermt "$SINCE" -print0 2>/dev/null' +
      ' | xargs -0 -r grep -h \'"rate_limits"\' 2>/dev/null || true',
    { ROOT: root, SINCE: isoSeconds(nowMs - LIMIT_HISTORY_DAYS * 86_400_000) },
  )
  return lines.split('\n').filter((line) => line.length > 0)
}

const readSession = (path: string): string[] => {
  const text = readTextFile(path)
  if (text === null) return []
  return text
    .split('\n')
    .filter(
      (line) =>
        line.includes('"token_count"') ||
        line.includes('"turn_context"') ||
        line.includes('"session_meta"'),
    )
}

export const collectCodex = (options: { sinceMs: number; nowMs: number; table: PriceTable }): Provider => {
  const files = sessionFiles(options.sinceMs)
  const aggregate = aggregateCodex(
    files.map((path) => ({ lines: readSession(path) })),
    options,
  )
  const limits = readLimits(limitHistory(options.nowMs))

  const warnings = [...aggregate.warnings]
  if (limits.limits.length === 0) {
    warnings.push('No rate-limit snapshot found — run Codex once to record one')
  }

  return {
    id: 'codex',
    name: 'Codex',
    account: {
      authMethod: exists(GLib.build_filenamev([codexDir(), 'auth.json'])) ? 'ChatGPT' : null,
      email: null,
      organization: null,
      plan: limits.planType === null ? null : capitalise(limits.planType),
    },
    limits: withForecasts(limits.limits, { ...limits.usage, nowMs: options.nowMs }),
    limitsAt: limits.limitsAt,
    cost: aggregate.cost,
    warnings,
  }
}

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)
