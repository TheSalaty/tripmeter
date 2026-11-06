import GLib from 'gi://GLib'
import System from 'system'

import { mergePrices } from '../lib/pricing.js'
import { windowStartMs } from '../lib/snapshot.js'
import type { Snapshot, WindowDays } from '../lib/types.js'
import { collectClaude } from './claude.js'
import { collectCodex } from './codex.js'
import { effectiveProviderConfigs } from './detect.js'
import { readJsonFile } from './io.js'

const CONFIG_DIR = 'tripmeter'

const parseWindow = (argv: string[]): WindowDays => {
  const index = argv.indexOf('--window')
  const raw = index >= 0 ? Number(argv[index + 1]) : NaN
  if (raw === 1 || raw === 7 || raw === 30) return raw
  return 7
}

const argValue = (argv: string[], flag: string): string => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] ?? '' : ''
}

const priceOverridesPath = (): string =>
  GLib.build_filenamev([GLib.get_user_config_dir(), CONFIG_DIR, 'pricing.json'])

const main = (argv: string[]): number => {
  const windowDays = parseWindow(argv)
  const nowMs = Date.now()
  const sinceMs = windowStartMs(windowDays, nowMs)
  const { table, warnings } = mergePrices(readJsonFile(priceOverridesPath()))

  const snapshot: Snapshot = {
    generatedAt: new Date(nowMs).toISOString(),
    since: new Date(sinceMs).toISOString(),
    windowDays,
    providers: [],
    warnings,
  }

  const configs = effectiveProviderConfigs(argValue(argv, '--providers'))
  for (const config of configs) {
    if (!config.enabled) continue
    const options = { sinceMs, nowMs, table }
    snapshot.providers.push(
      config.kind === 'claude' ? collectClaude(config, options) : collectCodex(config, options),
    )
  }
  if (configs.length === 0) {
    snapshot.warnings.push('Neither Claude Code nor Codex found on this machine')
  } else if (snapshot.providers.length === 0) {
    snapshot.warnings.push('Every provider is switched off in the settings')
  }

  print(JSON.stringify(snapshot))
  return 0
}

main(System.programArgs)
