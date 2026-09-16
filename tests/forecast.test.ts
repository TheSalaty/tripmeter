import assert from 'node:assert/strict'
import { test } from 'node:test'

import { forecastBand, withForecasts, type UsageDay } from '../src/lib/forecast.js'
import type { Limit } from '../src/lib/types.js'

// September 2026: the 7th is a Monday, the 12th and 13th the first weekend, the 16th a Wednesday.
const at = (day: number, hour = 0): number => new Date(2026, 8, day, hour).getTime()
const NOW = at(16, 12)

const spent = (day: number, amount: number): UsageDay => ({
  date: `2026-09-${String(day).padStart(2, '0')}`,
  amount,
})

// The limit window runs Monday to Monday, so "now" sits two and a half days into seven.
const weekly = (percent: number): Limit => ({
  label: 'Weekly (7 day)',
  percent,
  resetsAt: new Date(at(21)).toISOString(),
  isActive: false,
  windowMinutes: 10_080,
  forecast: null,
})

const forecastOf = (limit: Limit, days: readonly UsageDay[], sinceMs = at(7)) =>
  withForecasts([limit], { days, sinceMs, nowMs: NOW })[0]?.forecast ?? null

const WORKDAYS = [7, 8, 9, 10, 11, 14, 15].map((day) => spent(day, 10))
const EVERY_DAY = [7, 8, 9, 10, 11, 12, 13, 14, 15].map((day) => spent(day, 10))

test('without enough whole days to profile, the projection just carries the pace so far', () => {
  assert.equal(forecastOf(weekly(40), [], at(16))?.percent, 112)
})

test('a spend pattern that never moves keeps the projection at the plain pace', () => {
  const forecast = forecastOf(weekly(40), EVERY_DAY)
  assert.equal(Math.round(forecast?.percent ?? 0), 112)
  assert.equal(forecast?.fullAt, new Date(at(20, 6)).toISOString())
})

test('idle weekends inside the window lower the projection below the plain pace', () => {
  // Two of the four days left are a weekend that historically carries almost no spend.
  assert.equal(Math.round(forecastOf(weekly(40), WORKDAYS)?.percent ?? 0), 89)
})

test('today is left out of the profile, being a day still only half spent', () => {
  const withToday = [...WORKDAYS, spent(16, 200)]
  assert.equal(
    Math.round(forecastOf(weekly(40), withToday)?.percent ?? 0),
    Math.round(forecastOf(weekly(40), WORKDAYS)?.percent ?? 0),
  )
})

test('a projection stays out of windows too short, too fresh or too empty to read a pace from', () => {
  assert.equal(forecastOf({ ...weekly(40), windowMinutes: 300 }, WORKDAYS), null)
  assert.equal(forecastOf({ ...weekly(40), windowMinutes: null }, WORKDAYS), null)
  assert.equal(forecastOf({ ...weekly(40), resetsAt: null }, WORKDAYS), null)
  assert.equal(forecastOf(weekly(0), WORKDAYS), null)
  const barelyStarted = withForecasts([{ ...weekly(2), resetsAt: new Date(at(23)).toISOString() }], {
    days: WORKDAYS,
    sinceMs: at(7),
    nowMs: at(16, 4),
  })
  assert.equal(barelyStarted[0]?.forecast, null)
})

test('the bands mark the 85–95% sweet spot', () => {
  assert.equal(forecastBand(84.9), 'low')
  assert.equal(forecastBand(85), 'target')
  assert.equal(forecastBand(94.9), 'target')
  assert.equal(forecastBand(95), 'high')
  assert.equal(forecastBand(100), 'high')
  assert.equal(forecastBand(100.1), 'over')
})
