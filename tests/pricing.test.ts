import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergePrices, priceFor, priceUsage } from '../src/lib/pricing.js'

test('longest matching prefix wins so a dated snapshot keeps its family price', () => {
  assert.equal(priceFor('claude-opus-4-8')?.input, 5)
  assert.equal(priceFor('claude-sonnet-4-6')?.input, 3)
  assert.equal(priceFor('claude-sonnet-5')?.input, 2)
  assert.equal(priceFor('claude-fable-5')?.output, 50)
  assert.equal(priceFor('claude-mythos-5')?.output, 50)
  assert.equal(priceFor('gpt-5.6-terra')?.input, 2)
  assert.equal(priceFor('gpt-5.6-luna')?.output, 1.2)
  assert.equal(priceFor('gpt-5.6')?.output, 30)
  assert.deepEqual(priceFor('gpt-6-sol'), {
    input: 2,
    output: 10,
    cacheReadFactor: 0.1,
    cacheWriteFactor: 1.25,
    cacheWrite1hFactor: 1,
  })
  assert.equal(priceFor('some-unknown-model'), null)
})

test('cache reads and the two cache-write tiers are billed at their own multipliers', () => {
  const price = priceFor('claude-opus-5')
  assert.ok(price !== null)
  const { usd, usdWithoutCache } = priceUsage(
    { uncachedInput: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000, output: 0 },
    price,
  )
  assert.equal(Number(usd.toFixed(4)), 21.75)
  assert.equal(Number(usdWithoutCache.toFixed(4)), 20)
})

test('an unpriced model costs nothing rather than NaN', () => {
  const result = priceUsage(
    { uncachedInput: 100, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 100 },
    null,
  )
  assert.deepEqual(result, { usd: 0, usdWithoutCache: 0 })
})

test('a malformed override is reported and ignored instead of poisoning the table', () => {
  const { table, warnings } = mergePrices({
    'gpt-5.6': { input: 2, output: 8 },
    'claude-opus': { input: 'free' },
    broken: 42,
  })
  assert.equal(table['gpt-5.6']?.input, 2)
  assert.equal(table['gpt-5.6']?.cacheReadFactor, 0.1)
  assert.equal(table['claude-opus']?.input, 5, 'bad override must not replace the default')
  assert.equal(warnings.length, 2)
})
