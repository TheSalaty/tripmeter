import assert from 'node:assert/strict'
import { test } from 'node:test'

import { paceFor, windowMinutesFor } from '../src/lib/pace.js'

const HOUR = 3_600_000
const now = Date.parse('2026-11-06T18:00:00Z')
const limit = (label: string, percent: number, resetInMs: number) => ({
  label,
  percent,
  resetsAt: new Date(now + resetInMs).toISOString(),
  isActive: true,
  windowMinutes: null,
  forecast: null,
})

test('window lengths come from the limit labels', () => {
  assert.equal(windowMinutesFor('Session (5h)'), 300)
  assert.equal(windowMinutesFor('Weekly (7 day)'), 10080)
  assert.equal(windowMinutesFor('Weekly Fable'), 10080)
  assert.equal(windowMinutesFor('30 day'), 43200)
  assert.equal(windowMinutesFor('Primary'), null)
})

test('halfway through the session, just under half used is on pace', () => {
  const pace = paceFor(limit('Session (5h)', 48, 2.5 * HOUR), now)
  assert.equal(pace?.status, 'on')
  assert.equal(Math.round(pace?.expected ?? 0), 50)
  assert.equal(pace?.runsOutAtMs, null)
})

test('using too fast predicts when the limit runs out', () => {
  // 1 h into 5 h, 40% used → empty after 2.5 h, i.e. 1.5 h from now.
  const pace = paceFor(limit('Session (5h)', 40, 4 * HOUR), now)
  assert.equal(pace?.status, 'over')
  assert.equal(pace?.runsOutAtMs, now + 1.5 * HOUR)
})

test('leftover headroom counts as under pace', () => {
  const pace = paceFor(limit('Weekly (7 day)', 8, 24 * HOUR), now)
  assert.equal(pace?.status, 'under')
  assert.ok((pace?.delta ?? 0) < -70)
})

test('no pace without a reset time or a known window', () => {
  assert.equal(paceFor({ ...limit('Session (5h)', 5, HOUR), resetsAt: null }, now), null)
  assert.equal(paceFor(limit('Primary', 5, HOUR), now), null)
})
