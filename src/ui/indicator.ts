import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GObject from 'gi://GObject'
import St from 'gi://St'

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import {
  formatAgo,
  formatDate,
  formatPercent,
  formatRange,
  formatShare,
  formatTokens,
  formatUsd,
} from '../lib/format.js'
import { panelLimits, severityFor, totalUsd } from '../lib/snapshot.js'
import {
  type PanelLimitSource,
  type Provider,
  type ProviderKind,
  type Snapshot,
  type WindowDays,
} from '../lib/types.js'
import { detailGap, detailRow, providerCard } from './card.js'
import { choiceRow, note, staticItem } from './rows.js'

const WINDOW_CHOICES: readonly { value: WindowDays; label: string }[] = [
  { value: 1, label: '24 h' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
]

const ICONS_URI = import.meta.url.replace('/ui/indicator.js', '/icons/')

export type IndicatorHandlers = {
  onRefresh: () => void
  onWindowChange: (days: WindowDays) => void
  onOpenPreferences: () => void
}

type State = {
  snapshot: Snapshot | null
  windowDays: WindowDays
  panelMode: string
  panelLimitSource: PanelLimitSource
  busy: boolean
  error: string | null
}

export const UsageIndicator = GObject.registerClass(
  class UsageIndicator extends PanelMenu.Button {
    private label!: St.Label
    private limitsBox!: St.BoxLayout
    private handlers!: IndicatorHandlers
    private expanded = new Set<string>()
    private state: State = {
      snapshot: null,
      windowDays: 7,
      panelMode: 'percent',
      panelLimitSource: 'both',
      busy: false,
      error: null,
    }

    constructor(handlers: IndicatorHandlers) {
      super(0.5, 'Tripmeter', false)
      this.handlers = handlers

      const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' })
      this.limitsBox = new St.BoxLayout()
      box.add_child(this.limitsBox)
      this.label = new St.Label({
        text: '…',
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'aiu-panel-label',
      })
      box.add_child(this.label)
      this.add_child(box)

      const menu = this.menu as PopupMenu.PopupMenu
      menu.connect('open-state-changed', (_source, open) => {
        if (open) this.handlers.onRefresh()
      })
    }

    setBusy(busy: boolean): void {
      this.state.busy = busy
      this.rebuild()
    }

    setError(error: string | null): void {
      this.state.error = error
      this.rebuild()
    }

    setSettings(windowDays: WindowDays, panelMode: string, panelLimitSource: PanelLimitSource): void {
      this.state.windowDays = windowDays
      this.state.panelMode = panelMode
      this.state.panelLimitSource = panelLimitSource
      this.rebuild()
    }

    setSnapshot(snapshot: Snapshot): void {
      this.state.snapshot = snapshot
      this.state.error = null
      this.rebuild()
    }

    private rebuild(): void {
      this.populate()
    }

    private populate(): void {
      this.updatePanel()
      const menu = this.menu as PopupMenu.PopupMenu
      menu.removeAll()

      const snapshot = this.state.snapshot
      const nowMs = Date.now()

      if (snapshot === null) {
        menu.addMenuItem(note(this.state.error ?? 'Collecting usage…'))
      } else {
        for (const provider of snapshot.providers) {
          this.addProvider(menu, provider, nowMs)
        }
        for (const warning of snapshot.warnings) menu.addMenuItem(note(warning))
      }

      menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
      menu.addMenuItem(
        choiceRow(WINDOW_CHOICES, this.state.windowDays, (days) =>
          this.handlers.onWindowChange(days),
        ),
      )
      const range = snapshot === null ? null : formatRange(snapshot.since, nowMs)
      if (range !== null) menu.addMenuItem(note(range))
      menu.addMenuItem(this.footer(snapshot, nowMs))
    }

    private addProvider(menu: PopupMenu.PopupMenu, provider: Provider, nowMs: number): void {
      menu.addMenuItem(
        providerCard(provider, {
          nowMs,
          expanded: this.expanded.has(provider.id),
          onToggleDetails: () => {
            if (this.expanded.has(provider.id)) this.expanded.delete(provider.id)
            else this.expanded.add(provider.id)
            this.rebuild()
          },
          details: (box) => this.addCostDetails(box, provider),
        }),
      )
    }

    private addCostDetails(box: St.BoxLayout, provider: Provider): void {
      const cost = provider.cost
      const savings = cost.usdWithoutCache - cost.usd

      box.add_child(detailRow('At API rates', formatUsd(cost.usd)))
      box.add_child(detailRow('Saved by caching', formatUsd(savings)))
      if (cost.activeDays > 0) {
        box.add_child(
          detailRow('Per active day', `${formatUsd(cost.usd / cost.activeDays)} · ${cost.activeDays}d`),
        )
      }
      box.add_child(
        detailRow(
          'Tokens',
          `${formatTokens(cost.tokens.cacheRead)} cached · ` +
            `${formatTokens(cost.tokens.uncachedInput + cost.tokens.cacheWrite)} fresh · ` +
            `${formatTokens(cost.tokens.output)} out`,
          true,
        ),
      )

      if (cost.models.length > 0) {
        box.add_child(detailGap())
        box.add_child(detailRow('Model', 'Cost · share', true))
        for (const model of cost.models.slice(0, 6)) {
          box.add_child(
            detailRow(`    ${model.model}`, `${formatUsd(model.usd)} · ${formatShare(model.usd, cost.usd)}`),
          )
        }
      }

      const breakdowns: readonly [string, typeof cost.skills][] = [
        ['Skills', cost.skills],
        ['Subagents', cost.subagents],
        ['MCP tools', cost.mcpTools],
      ]
      for (const [title, entries] of breakdowns) {
        if (entries.length === 0 || cost.usd <= 0) continue
        const rows = entries
          .slice(0, 5)
          .map((entry) => [entry.name, Math.round((entry.usd / cost.usd) * 100)] as const)
          .filter(([, share]) => share >= 1)
        if (rows.length === 0) continue
        box.add_child(detailGap())
        box.add_child(detailRow(title, '% of cost', true))
        for (const [name, share] of rows) box.add_child(detailRow(`    ${name}`, `${share}%`))
      }

      const busiest = [...cost.days].sort((a, b) => b.usd - a.usd).slice(0, 3)
      if (busiest.length > 1) {
        box.add_child(detailGap())
        box.add_child(detailRow('Busiest days', 'Cost', true))
        for (const day of busiest) box.add_child(detailRow(`    ${formatDate(day.date)}`, formatUsd(day.usd)))
      }

      const identity = provider.account.email ?? provider.account.authMethod
      if (identity !== null) {
        box.add_child(detailGap())
        box.add_child(detailRow('Account', identity, true))
      }
    }

    private footer(snapshot: Snapshot | null, nowMs: number): PopupMenu.PopupBaseMenuItem {
      const item = staticItem('aiu-footer')
      const ago = snapshot === null ? null : formatAgo(snapshot.generatedAt, nowMs)
      item.add_child(
        new St.Label({
          text: this.state.busy ? 'Refreshing…' : ago === null ? '' : `Updated ${ago}`,
          style_class: 'aiu-dim',
        }),
      )
      item.add_child(new St.Widget({ x_expand: true }))

      const refresh = new St.Button({
        style_class: 'aiu-icon-button',
        child: new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: 16 }),
        can_focus: true,
      })
      refresh.connect('clicked', () => {
        this.handlers.onRefresh()
        return Clutter.EVENT_STOP
      })
      item.add_child(refresh)

      const settings = new St.Button({
        style_class: 'aiu-icon-button',
        child: new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 16 }),
        can_focus: true,
      })
      settings.connect('clicked', () => {
        this.menu.close(BoxPointer.PopupAnimation.FULL)
        this.handlers.onOpenPreferences()
        return Clutter.EVENT_STOP
      })
      item.add_child(settings)
      return item
    }

    private updatePanel(): void {
      this.limitsBox.destroy_all_children()
      const snapshot = this.state.snapshot
      if (this.state.panelMode === 'icon' || snapshot === null) {
        this.label.visible = this.state.panelMode === 'icon'
        this.label.text = '…'
        return
      }

      if (this.state.panelMode === 'cost') {
        this.label.text = formatUsd(totalUsd(snapshot))
        this.label.visible = true
        this.setLabelSeverity('normal')
        return
      }

      this.label.visible = false
      for (const { provider, limit } of panelLimits(snapshot, this.state.panelLimitSource)) {
        this.limitsBox.add_child(this.providerIcon(provider.kind, provider.color))
        const label = new St.Label({
          text: formatPercent(limit.percent),
          y_align: Clutter.ActorAlign.CENTER,
          style_class: `aiu-panel-label aiu-panel-${severityFor(limit.percent)}`,
        })
        this.limitsBox.add_child(label)
      }
    }

    private providerIcon(kind: ProviderKind, color: string | null): St.Icon {
      return new St.Icon({
        gicon: new Gio.FileIcon({
          file: Gio.File.new_for_uri(`${ICONS_URI}${kind}-symbolic.svg`),
        }),
        icon_size: 16,
        style_class: 'aiu-provider-icon',
        style: color === null ? null : `color: ${color};`,
      })
    }

    private setLabelSeverity(severity: string): void {
      this.label.style_class = `aiu-panel-label aiu-panel-${severity}`
    }
  },
)

export type UsageIndicatorInstance = InstanceType<typeof UsageIndicator>

export const createIndicator = (handlers: IndicatorHandlers): UsageIndicatorInstance => {
  const Constructor = UsageIndicator as unknown as new (
    handlers: IndicatorHandlers,
  ) => UsageIndicatorInstance
  return new Constructor(handlers)
}

export const addToPanel = (indicator: UsageIndicatorInstance, uuid: string): void => {
  const existing = Main.panel.statusArea[uuid] as { destroy?: () => void } | undefined
  existing?.destroy?.()
  Main.panel.addToStatusArea(uuid, indicator, 0, 'right')
}
