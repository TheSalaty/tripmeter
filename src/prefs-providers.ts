import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import type Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'

import { effectiveProviderConfigs } from './collector/detect.js'
import { exists, readJsonFile } from './collector/io.js'
import {
  DEFAULT_NAMES,
  mergeProviderConfigs,
  providersFromT3,
  serializeProviderConfigs,
  uniqueId,
  type ProviderConfig,
} from './lib/providers.js'
import type { ProviderKind } from './lib/types.js'

const t3SettingsPath = (): string =>
  GLib.build_filenamev([GLib.get_home_dir(), '.t3', 'userdata', 'settings.json'])

const toHex = (rgba: Gdk.RGBA): string => {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')
  return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`
}

const toRgba = (hex: string | null): Gdk.RGBA => {
  const rgba = new Gdk.RGBA()
  rgba.parse(hex ?? '#808080')
  return rgba
}

// The "Providers" group: one expandable row per Claude Code account or Codex home,
// with an on/off switch, a name, a colour and the directory it reads from.
export const providersGroup = (settings: Gio.Settings): Adw.PreferencesGroup => {
  const group = new Adw.PreferencesGroup({
    title: 'Providers',
    description:
      'One entry per Claude Code account (config directory) or Codex home. ' +
      'Switched-off entries are hidden even while the CLI stays installed.',
  })

  let configs: ProviderConfig[] = effectiveProviderConfigs(settings.get_string('providers'))
  let rows: Gtk.Widget[] = []

  const save = (): void => {
    settings.set_string('providers', serializeProviderConfigs(configs))
  }

  const subtitleFor = (config: ProviderConfig): string =>
    `${DEFAULT_NAMES[config.kind]} · ${config.home.length > 0 ? config.home : `~/.${config.kind} (default)`}`

  const buttons = new Gtk.Box({ spacing: 6, halign: Gtk.Align.CENTER, margin_top: 12 })

  let buttonsAdded = false

  const render = (): void => {
    for (const row of rows) group.remove(row)
    if (buttonsAdded) group.remove(buttons)
    buttonsAdded = true
    rows = configs.map((config) => providerRow(config))
    for (const row of rows) group.add(row)
    group.add(buttons)
  }

  const providerRow = (config: ProviderConfig): Adw.ExpanderRow => {
    const row = new Adw.ExpanderRow({ title: config.name, subtitle: subtitleFor(config) })

    const swatch = new Gtk.ColorDialogButton({
      dialog: new Gtk.ColorDialog({ with_alpha: false, title: `Colour for ${config.name}` }),
      rgba: toRgba(config.color),
      valign: Gtk.Align.CENTER,
      tooltip_text: 'Accent colour in the panel and menu',
    })
    swatch.connect('notify::rgba', () => {
      config.color = toHex(swatch.rgba)
      save()
    })
    row.add_prefix(swatch)

    const toggle = new Gtk.Switch({ active: config.enabled, valign: Gtk.Align.CENTER })
    toggle.connect('notify::active', () => {
      config.enabled = toggle.active
      save()
    })
    row.add_suffix(toggle)

    const name = new Adw.EntryRow({ title: 'Name', text: config.name, show_apply_button: true })
    name.connect('apply', () => {
      const text = name.text.trim()
      config.name = text.length > 0 ? text : DEFAULT_NAMES[config.kind]
      row.title = config.name
      save()
    })
    row.add_row(name)

    const home = new Adw.EntryRow({
      title: config.kind === 'claude'
        ? 'Config directory (CLAUDE_CONFIG_DIR, empty = ~/.claude)'
        : 'Codex home (CODEX_HOME, empty = ~/.codex)',
      text: config.home,
      show_apply_button: true,
    })
    home.connect('apply', () => {
      config.home = home.text.trim()
      row.subtitle = subtitleFor(config)
      save()
    })
    row.add_row(home)

    const actions = new Adw.ActionRow({ title: 'Default colour or remove' })
    const resetColor = new Gtk.Button({ label: 'Default colour', valign: Gtk.Align.CENTER })
    resetColor.connect('clicked', () => {
      config.color = null
      save()
      render()
    })
    actions.add_suffix(resetColor)
    const remove = new Gtk.Button({ label: 'Remove', valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] })
    remove.connect('clicked', () => {
      configs = configs.filter((candidate) => candidate !== config)
      save()
      render()
    })
    actions.add_suffix(remove)
    row.add_row(actions)

    return row
  }

  const add = (kind: ProviderKind): void => {
    const sameKind = configs.filter((config) => config.kind === kind).length
    configs.push({
      id: uniqueId(kind, configs.map(({ id }) => id)),
      kind,
      name: sameKind === 0 ? DEFAULT_NAMES[kind] : `${DEFAULT_NAMES[kind]} ${sameKind + 1}`,
      color: null,
      home: '',
      enabled: true,
    })
    save()
    render()
  }

  const addClaude = new Gtk.Button({ label: 'Add Claude account' })
  addClaude.connect('clicked', () => add('claude'))
  buttons.append(addClaude)
  const addCodex = new Gtk.Button({ label: 'Add Codex' })
  addCodex.connect('clicked', () => add('codex'))
  buttons.append(addCodex)
  if (exists(t3SettingsPath())) {
    const importT3 = new Gtk.Button({
      label: 'Import from T3 Code',
      tooltip_text: 'Copy names, colours, directories and switches of T3 Code’s Claude and Codex providers',
    })
    importT3.connect('clicked', () => {
      configs = mergeProviderConfigs(configs, providersFromT3(readJsonFile(t3SettingsPath())), GLib.get_home_dir())
      save()
      render()
    })
    buttons.append(importT3)
  }
  render()
  return group
}

