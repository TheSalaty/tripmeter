import type { ProviderKind } from './types.js'

// One configured source of usage: a Claude Code config directory or a Codex home.
// `home` is empty for the CLI's default directory (~/.claude or ~/.codex).
export type ProviderConfig = {
  id: string
  kind: ProviderKind
  name: string
  color: string | null
  home: string
  enabled: boolean
}

export const DEFAULT_NAMES: Record<ProviderKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const isProviderKind = (value: unknown): value is ProviderKind =>
  value === 'claude' || value === 'codex'

export const normalizeColor = (value: unknown): string | null =>
  typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : null

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Unique, stable id from a preferred base such as `claude-privat`.
export const uniqueId = (base: string, taken: Iterable<string>): string => {
  const used = new Set(taken)
  const root = slug(base) || 'provider'
  if (!used.has(root)) return root
  for (let n = 2; ; n++) {
    if (!used.has(`${root}-${n}`)) return `${root}-${n}`
  }
}

// Parses the `providers` setting. Returns null when the setting is empty or unusable,
// meaning "nothing configured yet — detect what is installed".
export const parseProviderConfigs = (raw: string): ProviderConfig[] | null => {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(payload) || payload.length === 0) return null

  const configs: ProviderConfig[] = []
  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (!isProviderKind(candidate.kind)) continue
    const kind = candidate.kind
    const name = typeof candidate.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : DEFAULT_NAMES[kind]
    const preferred = typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : kind
    configs.push({
      id: uniqueId(preferred, configs.map(({ id }) => id)),
      kind,
      name,
      color: normalizeColor(candidate.color),
      home: typeof candidate.home === 'string' ? candidate.home.trim() : '',
      enabled: candidate.enabled !== false,
    })
  }
  return configs.length === 0 ? null : configs
}

export const serializeProviderConfigs = (configs: readonly ProviderConfig[]): string =>
  JSON.stringify(configs)

export const defaultProviderConfigs = (installed: Record<ProviderKind, boolean>): ProviderConfig[] =>
  (['claude', 'codex'] as const)
    .filter((kind) => installed[kind])
    .map((kind) => ({ id: kind, kind, name: DEFAULT_NAMES[kind], color: null, home: '', enabled: true }))

// `~/x` and `$HOME/x` → absolute; empty stays empty (the CLI default).
export const expandHome = (path: string, homeDir: string): string => {
  const trimmed = path.trim()
  if (trimmed === '~') return homeDir
  if (trimmed.startsWith('~/')) return `${homeDir}${trimmed.slice(1)}`
  if (trimmed.startsWith('$HOME/')) return `${homeDir}${trimmed.slice(5)}`
  return trimmed
}

// Two configs point at the same data when their resolved homes match.
export const sameSource = (
  a: Pick<ProviderConfig, 'kind' | 'home'>,
  b: Pick<ProviderConfig, 'kind' | 'home'>,
  homeDir: string,
): boolean => {
  if (a.kind !== b.kind) return false
  const resolve = (home: string): string => {
    const expanded = expandHome(home, homeDir).replace(/\/+$/, '')
    if (expanded.length > 0) return expanded
    return `${homeDir}/${a.kind === 'claude' ? '.claude' : '.codex'}`
  }
  return resolve(a.home) === resolve(b.home)
}

const T3_DRIVERS: Record<string, ProviderKind> = {
  claudeAgent: 'claude',
  codex: 'codex',
}

// Reads T3 Code's `providerInstances` (~/.t3/userdata/settings.json) and returns
// the Claude Code and Codex instances with T3's display name, accent colour and switch.
export const providersFromT3 = (settings: unknown): ProviderConfig[] => {
  if (settings === null || typeof settings !== 'object') return []
  const instances = (settings as { providerInstances?: unknown }).providerInstances
  if (instances === null || typeof instances !== 'object') return []

  const configs: ProviderConfig[] = []
  for (const [key, value] of Object.entries(instances as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue
    const instance = value as {
      driver?: unknown
      displayName?: unknown
      accentColor?: unknown
      enabled?: unknown
      config?: { homePath?: unknown }
    }
    const kind = typeof instance.driver === 'string' ? T3_DRIVERS[instance.driver] : undefined
    if (kind === undefined) continue
    const suffix = key.includes('_') ? key.slice(key.indexOf('_') + 1) : ''
    const displayName = typeof instance.displayName === 'string' ? instance.displayName.trim() : ''
    configs.push({
      id: uniqueId(suffix.length > 0 ? `${kind}-${suffix}` : kind, configs.map(({ id }) => id)),
      kind,
      name: displayName.length > 0 ? displayName : DEFAULT_NAMES[kind],
      color: normalizeColor(instance.accentColor),
      home: typeof instance.config?.homePath === 'string' ? instance.config.homePath.trim() : '',
      enabled: instance.enabled !== false,
    })
  }
  return configs
}

// Merges imported configs into the current list: a matching source takes the imported
// name, colour and switch; anything new is appended; nothing is removed.
export const mergeProviderConfigs = (
  current: readonly ProviderConfig[],
  imported: readonly ProviderConfig[],
  homeDir: string,
): ProviderConfig[] => {
  const result = current.map((config) => ({ ...config }))
  for (const incoming of imported) {
    const match = result.find((config) => sameSource(config, incoming, homeDir))
    if (match !== undefined) {
      match.name = incoming.name
      match.color = incoming.color ?? match.color
      match.enabled = incoming.enabled
    } else {
      result.push({ ...incoming, id: uniqueId(incoming.id, result.map(({ id }) => id)) })
    }
  }
  return result
}
