import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeDailyUsage, toUsageDays } from '../src/lib/history.js'

const at = (day: number, hour = 0): number => new Date(2026, 8, day, hour).getTime()
const NOW = at(16, 13)

test('a rolling 24-hour window keeps the fuller figure already on file for the day it starts in', () => {
  const merged = mergeDailyUsage(
    { '2026-09-15': 85 },
    [{ date: '2026-09-15', amount: 38 }, { date: '2026-09-16', amount: 84 }],
    { sinceMs: at(15, 13), nowMs: NOW },
  )
  assert.equal(merged['2026-09-15'], 85)
  assert.equal(merged['2026-09-16'], 84)
})

test('a window that starts at midnight overwrites the days it covers', () => {
  const merged = mergeDailyUsage(
    { '2026-09-14': 999, '2026-09-15': 999 },
    [{ date: '2026-09-15', amount: 85 }],
    { sinceMs: at(15), nowMs: NOW },
  )
  assert.equal(merged['2026-09-14'], 999)
  assert.equal(merged['2026-09-15'], 85)
})

test('days the run covered without spending are recorded as zero, not left as gaps', () => {
  const merged = mergeDailyUsage({}, [{ date: '2026-09-16', amount: 84 }], {
    sinceMs: at(12),
    nowMs: NOW,
  })
  assert.deepEqual(Object.keys(merged).sort(), [
    '2026-09-12',
    '2026-09-13',
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
  ])
  assert.equal(merged['2026-09-13'], 0)
})

test('anything older than the fortnight worth trusting is dropped', () => {
  const merged = mergeDailyUsage({ '2026-08-30': 5, '2026-09-01': 7 }, [], {
    sinceMs: at(16),
    nowMs: NOW,
  })
  assert.equal(merged['2026-08-30'], undefined)
  assert.equal(merged['2026-09-01'], 7)
})

test('the stored days come back as a window starting on the oldest one', () => {
  const { days, sinceMs } = toUsageDays({ '2026-09-15': 85, '2026-09-14': 10 })
  assert.deepEqual(days.map(({ date }) => date), ['2026-09-14', '2026-09-15'])
  assert.equal(sinceMs, at(14))
})
