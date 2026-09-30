export type ModelPrice = {
  input: number
  output: number
  cacheReadFactor: number
  cacheWriteFactor: number
  cacheWrite1hFactor: number
}

const anthropic = (input: number, output: number): ModelPrice => ({
  input,
  output,
  cacheReadFactor: 0.1,
  cacheWriteFactor: 1.25,
  cacheWrite1hFactor: 2,
})

const openai = (input: number, output: number, cacheWriteFactor = 1): ModelPrice => ({
  input,
  output,
  cacheReadFactor: 0.1,
  cacheWriteFactor,
  cacheWrite1hFactor: 1,
})

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5': anthropic(10, 50),
  'claude-mythos': anthropic(10, 50),
  'claude-opus': anthropic(5, 25),
  'claude-sonnet': anthropic(3, 15),
  'claude-sonnet-5': anthropic(2, 10),
  'claude-haiku': anthropic(1, 5),
  'gpt-6-sol': openai(2, 10, 1.25),
  'gpt-5.6': openai(5, 30),
  'gpt-5.6-terra': openai(2, 12),
  'gpt-5.6-luna': openai(0.2, 1.2),
  'gpt-5.5': openai(5, 30),
  'gpt-5': openai(1.25, 10),
  o4: openai(1.1, 4.4),
}

export type PriceTable = Record<string, ModelPrice>

export const priceFor = (model: string, table: PriceTable = DEFAULT_PRICES): ModelPrice | null => {
  let best: ModelPrice | null = null
  let bestLength = -1
  for (const [prefix, price] of Object.entries(table)) {
    if (model.startsWith(prefix) && prefix.length > bestLength) {
      best = price
      bestLength = prefix.length
    }
  }
  return best
}

export type Usage = {
  uncachedInput: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  output: number
}

export type Priced = {
  usd: number
  usdWithoutCache: number
}

export const priceUsage = (usage: Usage, price: ModelPrice | null): Priced => {
  if (price === null) return { usd: 0, usdWithoutCache: 0 }
  const cachedInput =
    usage.uncachedInput +
    usage.cacheRead * price.cacheReadFactor +
    usage.cacheWrite * price.cacheWriteFactor +
    usage.cacheWrite1h * price.cacheWrite1hFactor
  const rawInput = usage.uncachedInput + usage.cacheRead + usage.cacheWrite + usage.cacheWrite1h
  return {
    usd: (cachedInput * price.input + usage.output * price.output) / 1e6,
    usdWithoutCache: (rawInput * price.input + usage.output * price.output) / 1e6,
  }
}

export const mergePrices = (overrides: unknown): { table: PriceTable; warnings: string[] } => {
  const table: PriceTable = { ...DEFAULT_PRICES }
  const warnings: string[] = []
  if (overrides === null || typeof overrides !== 'object') return { table, warnings }

  for (const [prefix, raw] of Object.entries(overrides as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') {
      warnings.push(`pricing override for "${prefix}" is not an object`)
      continue
    }
    const candidate = raw as Partial<ModelPrice>
    if (typeof candidate.input !== 'number' || typeof candidate.output !== 'number') {
      warnings.push(`pricing override for "${prefix}" needs numeric "input" and "output"`)
      continue
    }
    const factor = (value: unknown, fallback: number): number =>
      typeof value === 'number' ? value : fallback
    table[prefix] = {
      input: candidate.input,
      output: candidate.output,
      cacheReadFactor: factor(candidate.cacheReadFactor, 0.1),
      cacheWriteFactor: factor(candidate.cacheWriteFactor, 1.25),
      cacheWrite1hFactor: factor(candidate.cacheWrite1hFactor, 2),
    }
  }
  return { table, warnings }
}
