import assert from 'node:assert/strict'
import { test } from 'node:test'

import { panelLimits } from '../src/lib/snapshot.js'
import { emptyCost, type Snapshot } from '../src/lib/types.js'

const limit = (label: string, percent: number, windowMinutes: number) => ({
  label, percent, resetsAt: null, isActive: false, windowMinutes, forecast: null,
})

test('the panel shows the session limit instead of the higher weekly one', () => {
  const snapshot: Snapshot = {
    generatedAt: '', since: '', windowDays: 7, warnings: [],
    providers: [{
      id: 'claude', name: 'Claude Code', limitsAt: null, warnings: [], cost: emptyCost(),
      account: { authMethod: null, email: null, organization: null, plan: null },
      limits: [limit('Session (5h)', 70, 300), limit('Weekly (7 day)', 76, 10_080)],
    }],
  }
  assert.equal(panelLimits(snapshot, 'claude')[0]?.limit.label, 'Session (5h)')
})
