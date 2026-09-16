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
  totalTokens,
  type PanelLimitSource,
  type Provider,
  type Snapshot,
  type WindowDays,
} from '../lib/types.js'
import {
  attributionRows,
  choiceRow,
  keyValue,
  limitRow,
  note,
  sectionHeader,
  staticItem,
} from './rows.js'

const WINDOW_CHOICES: readonly { value: WindowDays; label: string }[] = [
  { value: 1, label: '24 h' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
]

const ICONS_URI = import.meta.url.replace('/ui/indicator.js', '/icons/')

// The shell slides a submenu open unless it is tall enough to need a scrollbar,
// so Claude would animate and Codex would not. Drop it for both.
const unanimatedSubmenu = (item: PopupMenu.PopupSubMenuMenuItem): void => {
  item.setSubmenuShown = (open: boolean): void => {
    if (open) item.menu.open(BoxPointer.PopupAnimation.NONE)
    else item.menu.close(BoxPointer.PopupAnimation.NONE)
  }
}

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
    private claudeIcon!: St.Icon
    private claudeLabel!: St.Label
    private codexIcon!: St.Icon
    private codexLabel!: St.Label
    private handlers!: IndicatorHandlers
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
      this.claudeIcon = this.providerIcon('claude')
      box.add_child(this.claudeIcon)
      this.claudeLabel = this.providerLabel()
      box.add_child(this.claudeLabel)
      this.codexIcon = this.providerIcon('codex')
      box.add_child(this.codexIcon)
      this.codexLabel = this.providerLabel()
      box.add_child(this.codexLabel)
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
          this.addProvider(menu, provider, snapshot, nowMs)
        }
        if (snapshot.providers.length === 0) {
          menu.addMenuItem(note('Neither Claude Code nor Codex found on this machine.'))
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

    private addProvider(
      menu: PopupMenu.PopupMenu,
      provider: Provider,
      snapshot: Snapshot,
      nowMs: number,
    ): void {
      menu.addMenuItem(sectionHeader(provider.name, provider.account.plan))

      for (const limit of provider.limits) menu.addMenuItem(limitRow(limit, nowMs))
      if (provider.limits.length === 0) {
        menu.addMenuItem(note('No usage limits reported.'))
      } else if (provider.limitsAt !== null) {
        const ago = formatAgo(provider.limitsAt, nowMs)
        menu.addMenuItem(
          note(`Limits from the last recorded session${ago === null ? '' : ` · ${ago}`}.`),
        )
      }

      const cost = provider.cost
      const tokens = totalTokens(cost.tokens)
      const summary = new PopupMenu.PopupSubMenuMenuItem(
        `${formatUsd(cost.usd)} · ${formatTokens(tokens)} tokens`,
        false,
      )
      unanimatedSubmenu(summary)
      this.addCostDetails(summary.menu, provider)
      menu.addMenuItem(summary)

      for (const warning of provider.warnings) menu.addMenuItem(note(warning))
    }

    private addCostDetails(submenu: PopupMenu.PopupMenuBase, provider: Provider): void {
      const cost = provider.cost
      const savings = cost.usdWithoutCache - cost.usd

      submenu.addMenuItem(keyValue('At API rates', formatUsd(cost.usd)))
      submenu.addMenuItem(keyValue('Saved by caching', formatUsd(savings)))
      if (cost.activeDays > 0) {
        submenu.addMenuItem(
          keyValue('Per active day', `${formatUsd(cost.usd / cost.activeDays)} · ${cost.activeDays}d`),
        )
      }
      submenu.addMenuItem(
        keyValue(
          'Tokens',
          `${formatTokens(cost.tokens.cacheRead)} cached · ` +
            `${formatTokens(cost.tokens.uncachedInput + cost.tokens.cacheWrite)} fresh · ` +
            `${formatTokens(cost.tokens.output)} out`,
          { dim: true },
        ),
      )

      if (cost.models.length > 0) {
        submenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
        submenu.addMenuItem(keyValue('Model', 'Cost · share', { dim: true }))
        for (const model of cost.models.slice(0, 6)) {
          submenu.addMenuItem(
            keyValue(
              `    ${model.model}`,
              `${formatUsd(model.usd)} · ${formatShare(model.usd, cost.usd)}`,
            ),
          )
        }
      }

      const breakdowns: readonly [string, typeof cost.skills][] = [
        ['Skills', cost.skills],
        ['Subagents', cost.subagents],
        ['MCP tools', cost.mcpTools],
      ]
      for (const [title, entries] of breakdowns) {
        const rows = attributionRows(title, entries, cost.usd, 5)
        if (rows.length === 0) continue
        submenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
        for (const row of rows) submenu.addMenuItem(row)
      }

      const busiest = [...cost.days].sort((a, b) => b.usd - a.usd).slice(0, 3)
      if (busiest.length > 1) {
        submenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
        submenu.addMenuItem(keyValue('Busiest days', 'Cost', { dim: true }))
        for (const day of busiest) {
          submenu.addMenuItem(keyValue(`    ${formatDate(day.date)}`, formatUsd(day.usd)))
        }
      }

      const identity = provider.account.email ?? provider.account.authMethod
      if (identity !== null) {
        submenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
        submenu.addMenuItem(keyValue('Account', identity, { dim: true }))
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
      const snapshot = this.state.snapshot
      if (this.state.panelMode === 'icon' || snapshot === null) {
        this.setProviderLabelsVisible(false, false)
        this.label.visible = this.state.panelMode === 'icon'
        this.label.text = '…'
        return
      }

      if (this.state.panelMode === 'cost') {
        this.setProviderLabelsVisible(false, false)
        this.label.text = formatUsd(totalUsd(snapshot))
        this.label.visible = true
        this.setLabelSeverity('normal')
        return
      }

      const limits = panelLimits(snapshot, this.state.panelLimitSource)
      if (limits.length === 0) {
        this.setProviderLabelsVisible(false, false)
        this.label.visible = false
        return
      }
      const claude = limits.find(({ provider }) => provider.id === 'claude')
      const codex = limits.find(({ provider }) => provider.id === 'codex')
      this.setProviderLabelsVisible(claude !== undefined, codex !== undefined)
      if (claude !== undefined) this.setProviderLabel(this.claudeLabel, claude.limit.percent)
      if (codex !== undefined) this.setProviderLabel(this.codexLabel, codex.limit.percent)
      this.label.visible = false
    }

    private providerIcon(provider: 'claude' | 'codex'): St.Icon {
      const icon = new St.Icon({
        gicon: new Gio.FileIcon({
          file: Gio.File.new_for_uri(`${ICONS_URI}${provider}-symbolic.svg`),
        }),
        icon_size: 16,
        style_class: 'aiu-provider-icon',
      })
      icon.visible = false
      return icon
    }

    private providerLabel(): St.Label {
      const label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'aiu-panel-label' })
      label.visible = false
      return label
    }

    private setProviderLabelsVisible(claude: boolean, codex: boolean): void {
      this.claudeIcon.visible = claude
      this.claudeLabel.visible = claude
      this.codexIcon.visible = codex
      this.codexLabel.visible = codex
    }

    private setProviderLabel(label: St.Label, percent: number): void {
      label.text = formatPercent(percent)
      label.style_class = `aiu-panel-label aiu-panel-${severityFor(percent)}`
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
