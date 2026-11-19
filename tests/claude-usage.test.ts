import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseProfile, parseUsage } from '../src/lib/claude-usage.js'
import { formatAgo, formatTime, formatTokens, formatUntil, formatUsd } from '../src/lib/format.js'

test('the limits array is read with its scoped model name', () => {
  const limits = parseUsage({
    limits: [
      { kind: 'session', percent: 64, resets_at: '2026-08-13T11:39:59Z', is_active: true },
      { kind: 'weekly_all', percent: 43, resets_at: '2026-08-17T18:00:00Z', is_active: false },
      {
        kind: 'weekly_scoped',
        percent: 2,
        resets_at: '2026-08-17T18:00:00Z',
        scope: { model: { display_name: 'Fable' } },
      },
    ],
  })
  assert.deepEqual(
    limits.map((limit) => limit.label),
    ['Session (5h)', 'Weekly (7 day)', 'Weekly Fable'],
  )
  assert.equal(limits[0]?.isActive, true)
  assert.equal(limits[2]?.percent, 2)
})

test('limits keep a fixed order no matter how full they are', () => {
  const limits = parseUsage({
    limits: [
      { kind: 'weekly_scoped', percent: 100, scope: { model: { display_name: 'Fable' } } },
      { kind: 'weekly_all', percent: 92 },
      { kind: 'session', percent: 16 },
    ],
  })
  assert.deepEqual(
    limits.map((limit) => limit.label),
    ['Session (5h)', 'Weekly (7 day)', 'Weekly Fable'],
  )
})

test('an account still on the older response shape keeps its two headline limits', () => {
  const limits = parseUsage({
    limits: [],
    five_hour: { utilization: 30, resets_at: '2026-08-13T11:00:00Z' },
    seven_day: { utilization: 80, resets_at: null },
  })
  assert.deepEqual(
    limits.map((limit) => [limit.label, limit.percent, limit.resetsAt]),
    [
      ['Session (5h)', 30, '2026-08-13T11:00:00Z'],
      ['Weekly (7 day)', 80, null],
    ],
  )
})

test('a missing or junk payload yields no limits rather than throwing', () => {
  assert.deepEqual(parseUsage(null), [])
  assert.deepEqual(parseUsage('nope'), [])
})

test('the plan name comes from the organization type, falling back to the credentials file', () => {
  assert.equal(parseProfile({ organization: { organization_type: 'claude_team' } }, null).plan, 'Claude team')
  assert.equal(parseProfile({}, 'max').plan, 'Max')
  assert.equal(parseProfile({}, null).plan, null)
  assert.equal(parseProfile({ account: { email: 'a@b.c' } }, null).email, 'a@b.c')
})

test('reset times round to the unit the CLIs show', () => {
  const now = Date.parse('2026-08-13T10:00:00Z')
  assert.equal(formatUntil('2026-08-13T12:00:00Z', now), '2h')
  assert.equal(formatUntil('2026-08-17T18:00:00Z', now), '4d')
  assert.equal(formatUntil('2026-08-13T10:00:30Z', now), '1m')
  assert.equal(formatUntil('2026-08-13T09:00:00Z', now), 'now')
  assert.equal(formatUntil(null, now), null)
  assert.equal(
    formatTime('2026-08-13T10:00:00Z'),
    new Date('2026-08-13T10:00:00Z').toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  )
  assert.equal(formatTime(null), null)
  assert.equal(formatAgo('2026-08-13T09:58:00Z', now), '2m ago')
})

test('token and money figures use the units the dashboards use', () => {
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1_390_000_000), '1.39B')
  assert.equal(formatTokens(66_400_000), '66.4M')
  assert.equal(formatUsd(0.004), '<$0.01')
  assert.equal(formatUsd(983.784), '$983.78')
  assert.equal(formatUsd(4678.08), '$4,678')
})
