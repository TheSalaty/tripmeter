import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

import { isWindowDays } from './lib/snapshot.js'
import type { LimitDisplay, PanelLimitSource, WindowDays } from './lib/types.js'
import { CollectorRunner, loadCachedSnapshot, saveCachedSnapshot } from './runner.js'
import { addToPanel, createIndicator, type UsageIndicatorInstance } from './ui/indicator.js'

const STALE_AFTER_SECONDS = 45

export default class TripmeterExtension extends Extension {
  private indicator: UsageIndicatorInstance | null = null
  private runner: CollectorRunner | null = null
  private settings: Gio.Settings | null = null
  private settingsHandlers: number[] = []
  private timerId = 0
  private lastRunMs = 0

  override enable(): void {
    const settings = this.getSettings()
    this.settings = settings
    this.runner = new CollectorRunner(`${this.path}/collector/main.js`)

    const indicator = createIndicator({
      onRefresh: () => this.refresh(false),
      onWindowChange: (days: WindowDays) => settings.set_int('window-days', days),
      onOpenPreferences: () => this.openPreferences(),
    })
    this.indicator = indicator
    const apply = (): void =>
      indicator.setSettings(
        this.windowDays(),
        settings.get_string('panel-mode'),
        this.panelLimitSource(),
        this.limitDisplay(),
      )
    apply()

    const cached = loadCachedSnapshot()
    if (cached !== null) indicator.setSnapshot(cached)

    addToPanel(indicator, this.uuid)

    this.settingsHandlers = [
      settings.connect('changed::window-days', () => {
        apply()
        this.refresh(true)
      }),
      settings.connect('changed::panel-mode', apply),
      settings.connect('changed::panel-limit-source', apply),
      settings.connect('changed::limit-display', apply),
      settings.connect('changed::refresh-interval', () => this.restartTimer()),
      settings.connect('changed::providers', () => this.refresh(true)),
    ]

    this.restartTimer()
    this.refresh(true)
  }

  override disable(): void {
    if (this.timerId !== 0) {
      GLib.source_remove(this.timerId)
      this.timerId = 0
    }
    for (const handler of this.settingsHandlers) this.settings?.disconnect(handler)
    this.settingsHandlers = []
    this.runner?.cancel()
    this.runner = null
    this.indicator?.destroy()
    this.indicator = null
    this.settings = null
  }

  private windowDays(): WindowDays {
    const raw = this.settings?.get_int('window-days') ?? 7
    return isWindowDays(raw) ? raw : 7
  }

  private panelLimitSource(): PanelLimitSource {
    const source = this.settings?.get_string('panel-limit-source')
    return source === 'claude' || source === 'codex' || source === 'both' ? source : 'both'
  }

  private limitDisplay(): LimitDisplay {
    return this.settings?.get_string('limit-display') === 'used' ? 'used' : 'left'
  }

  private restartTimer(): void {
    if (this.timerId !== 0) GLib.source_remove(this.timerId)
    const interval = this.settings?.get_int('refresh-interval') ?? 300
    this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, interval, () => {
      this.refresh(true)
      return GLib.SOURCE_CONTINUE
    })
  }

  private refresh(force: boolean): void {
    const runner = this.runner
    const indicator = this.indicator
    if (runner === null || indicator === null) return

    const ageSeconds = (Date.now() - this.lastRunMs) / 1000
    if (!force && this.lastRunMs !== 0 && ageSeconds < STALE_AFTER_SECONDS) return

    this.lastRunMs = Date.now()
    indicator.setBusy(true)
    runner.run(this.windowDays(), this.settings?.get_string('providers') ?? '[]', (result) => {
      indicator.setBusy(false)
      if (result.ok) {
        indicator.setSnapshot(result.snapshot)
        saveCachedSnapshot(result.snapshot)
      } else {
        indicator.setError(`Could not collect usage: ${result.error}`)
      }
    })
  }
}
