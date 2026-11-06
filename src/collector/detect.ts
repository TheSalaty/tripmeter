import GLib from 'gi://GLib'

import { defaultProviderConfigs, expandHome, parseProviderConfigs, type ProviderConfig } from '../lib/providers.js'
import type { ProviderKind } from '../lib/types.js'
import { exists, onPath } from './io.js'

const DEFAULT_DIRS: Record<ProviderKind, string> = { claude: '.claude', codex: '.codex' }
const BINARIES: Record<ProviderKind, string> = { claude: 'claude', codex: 'codex' }

// The directory a config reads from: its own `home`, or the CLI's default.
export const resolveHome = (config: Pick<ProviderConfig, 'kind' | 'home'>): string => {
  const home = GLib.get_home_dir()
  const expanded = expandHome(config.home, home)
  return expanded.length > 0 ? expanded : GLib.build_filenamev([home, DEFAULT_DIRS[config.kind]])
}

export const isInstalled = (kind: ProviderKind): boolean =>
  exists(resolveHome({ kind, home: '' })) || onPath(BINARIES[kind])

export const detectedProviderConfigs = (): ProviderConfig[] =>
  defaultProviderConfigs({ claude: isInstalled('claude'), codex: isInstalled('codex') })

// The configured list, or what is installed when nothing is configured yet.
export const effectiveProviderConfigs = (raw: string): ProviderConfig[] =>
  parseProviderConfigs(raw) ?? detectedProviderConfigs()
