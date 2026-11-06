import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  defaultProviderConfigs,
  mergeProviderConfigs,
  parseProviderConfigs,
  providersFromT3,
  sameSource,
} from '../src/lib/providers.js'

test('an empty setting means detect what is installed', () => {
  assert.equal(parseProviderConfigs('[]'), null)
  assert.equal(parseProviderConfigs('not json'), null)
  assert.deepEqual(
    defaultProviderConfigs({ claude: true, codex: false }).map(({ id }) => id),
    ['claude'],
  )
})

test('parsing fills defaults, drops unknown kinds and keeps ids unique', () => {
  const configs = parseProviderConfigs(JSON.stringify([
    { kind: 'claude', name: '', color: '#00BA0F' },
    { kind: 'claude', id: 'claude', home: '~/.claude-private', enabled: false, color: 'red' },
    { kind: 'gemini' },
  ]))
  assert.deepEqual(configs, [
    { id: 'claude', kind: 'claude', name: 'Claude Code', color: '#00ba0f', home: '', enabled: true },
    { id: 'claude-2', kind: 'claude', name: 'Claude Code', color: null, home: '~/.claude-private', enabled: false },
  ])
})

test('T3 Code provider instances become named, coloured providers', () => {
  const configs = providersFromT3({
    providerInstances: {
      grok: { driver: 'grok', enabled: false },
      claudeAgent: { driver: 'claudeAgent', enabled: true, config: { homePath: '' } },
      claudeAgent_privat: {
        driver: 'claudeAgent', displayName: 'privat', accentColor: '#00ba0f', enabled: true,
        config: { homePath: '~/.claude-private' },
      },
    },
  })
  assert.deepEqual(configs, [
    { id: 'claude', kind: 'claude', name: 'Claude Code', color: null, home: '', enabled: true },
    { id: 'claude-privat', kind: 'claude', name: 'privat', color: '#00ba0f', home: '~/.claude-private', enabled: true },
  ])
})

test('importing updates matching sources and keeps the rest', () => {
  const current = defaultProviderConfigs({ claude: true, codex: true })
  current[1]!.enabled = false
  const merged = mergeProviderConfigs(current, [
    { id: 'claude', kind: 'claude', name: 'Work', color: '#ff0000', home: '/home/me/.claude/', enabled: true },
    { id: 'claude-privat', kind: 'claude', name: 'privat', color: null, home: '~/.claude-private', enabled: true },
  ], '/home/me')
  assert.deepEqual(merged.map(({ id, name, enabled }) => [id, name, enabled]), [
    ['claude', 'Work', true],
    ['codex', 'Codex', false],
    ['claude-privat', 'privat', true],
  ])
})

test('the default home and its explicit path are the same source', () => {
  assert.ok(sameSource({ kind: 'claude', home: '' }, { kind: 'claude', home: '~/.claude' }, '/home/me'))
  assert.ok(!sameSource({ kind: 'claude', home: '' }, { kind: 'codex', home: '' }, '/home/me'))
})
