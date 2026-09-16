import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aggregateCodex, readLimits, windowLabel } from '../src/lib/codex-parse.js'
import { DEFAULT_PRICES } from '../src/lib/pricing.js'

const options = { sinceMs: Date.parse('2026-08-12T00:00:00Z'), table: DEFAULT_PRICES }

const turnContext = (model: string): string =>
  JSON.stringify({ timestamp: '2026-08-12T09:00:00Z', type: 'turn_context', payload: { model } })

const tokenCount = (
  at: string,
  totals: { input: number; cached: number; write?: number; output: number; reasoning?: number },
  rateLimits?: {
    primary?: { used_percent: number; window_minutes: number; resets_at: number }
    secondary?: { used_percent: number; window_minutes: number; resets_at: number }
  },
): string =>
  JSON.stringify({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: totals.input,
          cached_input_tokens: totals.cached,
          cache_write_input_tokens: totals.write ?? 0,
          output_tokens: totals.output,
          reasoning_output_tokens: totals.reasoning ?? 0,
        },
      },
      ...(rateLimits === undefined ? {} : { rate_limits: { ...rateLimits, plan_type: 'plus' } }),
    },
  })

test('spend is the rise in the running total, not the repeated snapshot', () => {
  const { cost } = aggregateCodex(
    [
      {
        lines: [
          turnContext('gpt-5.6-terra'),
          tokenCount('2026-08-12T10:00:00Z', { input: 1_000_000, cached: 0, output: 0 }),
          tokenCount('2026-08-12T10:00:01Z', { input: 1_000_000, cached: 0, output: 0 }),
          tokenCount('2026-08-12T10:05:00Z', { input: 3_000_000, cached: 2_000_000, output: 100_000 }),
        ],
      },
    ],
    options,
  )
  assert.equal(cost.tokens.uncachedInput, 1_000_000)
  assert.equal(cost.tokens.cacheRead, 2_000_000)
  assert.equal(cost.tokens.output, 100_000)
  assert.equal(Number(cost.usd.toFixed(4)), Number((2 * 1 + 2 * 0.2 + 12 * 0.1).toFixed(4)))
})

test('a fork counts only its own turns, not the parent history copied in ahead of them', () => {
  const meta = (at: string, forked: boolean): string =>
    JSON.stringify({
      timestamp: at,
      type: 'session_meta',
      payload: forked ? { id: 'child', forked_from_id: 'parent' } : { id: 'parent' },
    })

  const forkLines = [
    meta('2026-08-12T10:00:00Z', true),
    turnContext('gpt-5.6-terra'),
    tokenCount('2026-08-12T10:00:00Z', { input: 400_000, cached: 0, output: 1000 }),
    tokenCount('2026-08-12T10:00:00.030Z', { input: 900_000, cached: 0, output: 2000 }),
    tokenCount('2026-08-12T10:00:20Z', { input: 1_000_000, cached: 0, output: 2500 }),
  ]

  const forked = aggregateCodex([{ lines: forkLines }], options).cost
  assert.equal(forked.tokens.uncachedInput, 100_000)
  assert.equal(forked.tokens.output, 500)

  const unforked = aggregateCodex(
    [{ lines: [meta('2026-08-12T10:00:00Z', false), ...forkLines.slice(1)] }],
    options,
  ).cost
  assert.equal(unforked.tokens.uncachedInput, 1_000_000)
})

test('a restarted counter is treated as fresh spend rather than a negative delta', () => {
  const { cost } = aggregateCodex(
    [
      {
        lines: [
          tokenCount('2026-08-12T10:00:00Z', { input: 500_000, cached: 0, output: 1000 }),
          tokenCount('2026-08-12T10:01:00Z', { input: 100, cached: 0, output: 1 }),
        ],
      },
    ],
    options,
  )
  assert.equal(cost.tokens.uncachedInput, 500_100)
  assert.equal(cost.tokens.output, 1001)
})

test('each session accumulates from zero, so two sessions do not cancel out', () => {
  const { cost } = aggregateCodex(
    [
      { lines: [tokenCount('2026-08-12T10:00:00Z', { input: 200, cached: 0, output: 10 })] },
      { lines: [tokenCount('2026-08-12T11:00:00Z', { input: 300, cached: 0, output: 20 })] },
    ],
    options,
  )
  assert.equal(cost.tokens.uncachedInput, 500)
  assert.equal(cost.tokens.output, 30)
})

test('the newest rate-limit snapshot wins even when an older session is listed later', () => {
  const snapshot = (at: string, percent: number): string =>
    tokenCount(at, { input: 10, cached: 0, output: 1 }, {
      primary: { used_percent: percent, window_minutes: 10_080, resets_at: 1_787_031_017 },
    })

  const { limits, limitsAt, planType } = readLimits([
    snapshot('2026-08-12T12:00:00Z', 61),
    snapshot('2026-08-12T09:00:00Z', 20),
  ])
  assert.equal(limits[0]?.percent, 61)
  assert.equal(limits[0]?.label, 'Weekly (7 day)')
  assert.equal(limitsAt, '2026-08-12T12:00:00Z')
  assert.equal(planType, 'plus')
})

test('the session window heads the list however much fuller the weekly one is', () => {
  const { limits } = readLimits([
    tokenCount('2026-08-12T12:00:00Z', { input: 10, cached: 0, output: 1 }, {
      primary: { used_percent: 12, window_minutes: 300, resets_at: 1_787_031_017 },
      secondary: { used_percent: 80, window_minutes: 10_080, resets_at: 1_787_431_017 },
    }),
  ])
  assert.deepEqual(limits.map(({ label }) => label), ['Session (5h)', 'Weekly (7 day)'])
})

test('a credits snapshot carrying no windows leaves the last real one standing', () => {
  const { limits, limitsAt } = readLimits([
    tokenCount('2026-08-12T12:00:00Z', { input: 10, cached: 0, output: 1 }, {
      primary: { used_percent: 61, window_minutes: 10_080, resets_at: 1_787_031_017 },
    }),
    JSON.stringify({
      timestamp: '2026-08-12T13:00:00Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: { limit_id: 'premium', primary: null, secondary: null, plan_type: 'plus' },
      },
    }),
  ])
  assert.equal(limits[0]?.percent, 61)
  assert.equal(limitsAt, '2026-08-12T12:00:00Z')
})

test('window minutes map to the labels the CLIs use', () => {
  assert.equal(windowLabel(10_080), 'Weekly (7 day)')
  assert.equal(windowLabel(300), 'Session (5h)')
  assert.equal(windowLabel(43_200), '30 day')
  assert.equal(windowLabel(45), '45 min')
})
