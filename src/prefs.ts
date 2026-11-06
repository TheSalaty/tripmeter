import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import { providersGroup } from './prefs-providers.js'

export default class TripmeterPreferences extends ExtensionPreferences {
  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings()

    const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' })
    window.add(page)

    const panel = new Adw.PreferencesGroup({ title: 'Panel' })
    page.add(panel)

    const modes = ['percent', 'cost', 'icon']
    const panelMode = new Adw.ComboRow({
      title: 'Panel button shows',
      subtitle: 'The tightest limit, the window’s cost, or the icon alone',
      model: Gtk.StringList.new(['Limit %', 'Cost', 'Icon only']),
    })
    panelMode.selected = Math.max(0, modes.indexOf(settings.get_string('panel-mode')))
    panelMode.connect('notify::selected', () => {
      settings.set_string('panel-mode', modes[panelMode.selected] ?? 'percent')
    })
    panel.add(panelMode)

    const sources = ['both', 'claude', 'codex']
    const panelSource = new Adw.ComboRow({
      title: 'Limit percentage shows',
      subtitle: 'Which enabled providers get a percentage in the panel',
      model: Gtk.StringList.new(['All', 'Claude accounts', 'Codex']),
    })
    panelSource.selected = Math.max(0, sources.indexOf(settings.get_string('panel-limit-source')))
    panelSource.connect('notify::selected', () => {
      settings.set_string('panel-limit-source', sources[panelSource.selected] ?? 'both')
    })
    panel.add(panelSource)


    const data = new Adw.PreferencesGroup({
      title: 'Collection',
      description:
        'Usage is read from the local session files of Claude Code and Codex, plus Claude’s ' +
        'own usage endpoint. Nothing is sent anywhere.',
    })
    page.add(data)

    const windows = [1, 7, 30]
    const windowRow = new Adw.ComboRow({
      title: 'Cost window',
      model: Gtk.StringList.new(['Past 24 hours', '7 days', '30 days']),
    })
    windowRow.selected = Math.max(0, windows.indexOf(settings.get_int('window-days')))
    windowRow.connect('notify::selected', () => {
      settings.set_int('window-days', windows[windowRow.selected] ?? 7)
    })
    data.add(windowRow)

    const interval = new Adw.SpinRow({
      title: 'Refresh interval',
      subtitle: 'Seconds between background collections',
      adjustment: new Gtk.Adjustment({ lower: 60, upper: 3600, step_increment: 30, page_increment: 300 }),
    })
    settings.bind('refresh-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT)
    data.add(interval)

    const providersPage = new Adw.PreferencesPage({ title: 'Providers', icon_name: 'system-users-symbolic' })
    providersPage.add(providersGroup(settings))
    window.add(providersPage)

    const pricing = new Adw.PreferencesGroup({
      title: 'Pricing',
      description:
        'Costs are what the same traffic would have cost at API list prices — subscriptions ' +
        'are flat-rate, so nothing here is a bill. Override the built-in price list by creating ' +
        `${GLib.build_filenamev([GLib.get_user_config_dir(), 'tripmeter', 'pricing.json'])}.`,
    })
    page.add(pricing)

    const example = new Adw.ActionRow({
      title: 'Example',
      subtitle: '{ "gpt-5.6": { "input": 1.25, "output": 10 } }  — USD per million tokens',
    })
    pricing.add(example)

    return Promise.resolve()
  }
}
