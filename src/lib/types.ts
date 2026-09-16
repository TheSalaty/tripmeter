export type ProviderId = 'claude' | 'codex'

export type PanelLimitSource = ProviderId | 'both'

export type WindowDays = 1 | 7 | 30

export type Limit = {
  label: string
  percent: number
  resetsAt: string | null
  isActive: boolean
  windowMinutes: number | null
  forecast: Forecast | null
}

export type Forecast = {
  percent: number
  fullAt: string | null
}

export type TokenTotals = {
  uncachedInput: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
}

export type ModelCost = {
  model: string
  usd: number
  tokens: number
}

export type DayCost = {
  date: string
  usd: number
  tokens: number
}

export type Attribution = {
  name: string
  usd: number
}

export type Cost = {
  usd: number
  usdWithoutCache: number
  tokens: TokenTotals
  models: ModelCost[]
  days: DayCost[]
  skills: Attribution[]
  subagents: Attribution[]
  mcpTools: Attribution[]
  activeDays: number
}

export type Account = {
  authMethod: string | null
  email: string | null
  organization: string | null
  plan: string | null
}

export type Provider = {
  id: ProviderId
  name: string
  account: Account
  limits: Limit[]
  limitsAt: string | null
  cost: Cost
  warnings: string[]
}

export type Snapshot = {
  generatedAt: string
  since: string
  windowDays: WindowDays
  providers: Provider[]
  warnings: string[]
}

export const emptyTokens = (): TokenTotals => ({
  uncachedInput: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
})

export const emptyCost = (): Cost => ({
  usd: 0,
  usdWithoutCache: 0,
  tokens: emptyTokens(),
  models: [],
  days: [],
  skills: [],
  subagents: [],
  mcpTools: [],
  activeDays: 0,
})

export const totalTokens = (t: TokenTotals): number =>
  t.uncachedInput + t.cacheRead + t.cacheWrite + t.output
