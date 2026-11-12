import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Pango from 'gi://Pango'
import St from 'gi://St'

import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import { forecastBand } from '../lib/forecast.js'
import { displayPercent, formatAgo, formatPercent, formatResetClock, formatTokens, formatUntil, formatUsd } from '../lib/format.js'
import { paceFor, type Pace } from '../lib/pace.js'
import { severityFor } from '../lib/snapshot.js'
import { totalTokens, type Limit, type LimitDisplay, type Provider, type ProviderKind } from '../lib/types.js'
import { staticItem } from './rows.js'

const ICONS_URI = import.meta.url.replace('/ui/card.js', '/icons/')

const DEFAULT_COLORS: Record<ProviderKind, string> = { claude: '#d97757', codex: '#9141ac' }
const SEVERITY_COLORS = { warning: '#ffc252', critical: '#ff938c' }

export const providerColor = (provider: Provider): string =>
  provider.color ?? DEFAULT_COLORS[provider.kind]

const rgb = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

type Cairo = {
  setSourceRGBA: (r: number, g: number, b: number, a: number) => void
  arc: (x: number, y: number, r: number, a1: number, a2: number) => void
  newSubPath: () => void
  closePath: () => void
  fill: () => void
  $dispose: () => void
}

const roundedRect = (cr: Cairo, x: number, y: number, w: number, h: number, r: number): void => {
  const radius = Math.min(r, h / 2, w / 2)
  cr.newSubPath()
  cr.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0)
  cr.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2)
  cr.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI)
  cr.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2)
  cr.closePath()
}

// A level bar with a tick where an even spread of the limit would be by now. Counting what is
// left, the bar drains instead of filling and the tick moves down with it.
const paceBar = (
  limit: Limit,
  pace: Pace | null,
  display: LimitDisplay,
  color: string,
  thickness: number,
): St.DrawingArea => {
  const fraction = (used: number): number => Math.max(0, Math.min(1, displayPercent(used, display) / 100))
  const level = fraction(limit.percent)
  const expected = pace === null ? null : fraction(pace.expected)
  const forecast = limit.forecast ?? null
  const projected = forecast !== null && forecast.percent > limit.percent ? fraction(forecast.percent) : null
  const tick = 4
  const area = new St.DrawingArea({
    x_expand: true,
    height: thickness + tick * 2,
    style_class: forecast === null ? 'aiu-pace-bar' : `aiu-pace-bar aiu-landing-${forecastBand(forecast.percent)}`,
  })
  area.connect('repaint', () => {
    const cr = area.get_context() as unknown as Cairo
    const [width] = area.get_surface_size()
    const fg = area.get_theme_node().get_foreground_color()
    const [r, g, b] = rgb(color)
    const y = tick

    cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.14)
    roundedRect(cr, 0, y, width, thickness, thickness / 2)
    cr.fill()

    // The solid bar always ends at today's figure. Counting up, where the window lands at
    // reset is a paler stretch past it; counting down, it is a gap cut into the bar.
    const fill = (from: number, to: number, alpha: number): void => {
      if (to <= from) return
      cr.setSourceRGBA(r, g, b, alpha)
      roundedRect(cr, from, y, Math.max(to - from, thickness), thickness, thickness / 2)
      cr.fill()
    }
    const end = level * width
    const landing = projected === null ? null : projected * width
    const gap = 3
    if (landing !== null && landing > end) fill(0, landing, 0.35)
    if (landing !== null && landing >= thickness && end - landing >= thickness + gap) {
      // What the forecast leaves unused takes the forecast figure's colour.
      const [found, unused] = area.get_theme_node().lookup_color('-aiu-landing-color', false)
      if (found) cr.setSourceRGBA(unused.red / 255, unused.green / 255, unused.blue / 255, unused.alpha / 255)
      else cr.setSourceRGBA(r, g, b, 1)
      roundedRect(cr, 0, y, landing, thickness, thickness / 2)
      cr.fill()
      fill(landing + gap, end, 1)
    } else {
      fill(0, end, 1)
    }

    if (expected !== null) {
      const x = Math.max(1, Math.min(width - 3, expected * width - 1))
      cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.9)
      roundedRect(cr, x, 0, 2, thickness + tick * 2, 1)
      cr.fill()
    }
    cr.$dispose()
  })
  return area
}

const label = (text: string, styleClass: string, style: string | null = null): St.Label => {
  const widget = new St.Label({ text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER })
  if (style !== null) widget.style = style
  return widget
}

const wrapping = (text: string, styleClass: string): St.Label => {
  const widget = label(text, styleClass)
  widget.clutter_text.line_wrap = true
  widget.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
  return widget
}

const spacer = (): St.Widget => new St.Widget({ x_expand: true })

const when = (ms: number, nowMs: number): string => {
  const date = new Date(ms)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (ms - nowMs < 20 * 3_600_000) return `at ${time}`
  return `${date.toLocaleDateString('en', { weekday: 'short' })} ${time}`
}

// The weekly forecast weighs the weekdays still ahead, so when it has a date it beats the
// straight-line estimate.
export const paceText = (pace: Pace, limit: Limit, nowMs: number): string => {
  const points = Math.round(Math.abs(pace.delta))
  const forecastFull = limit.forecast?.fullAt == null ? NaN : Date.parse(limit.forecast.fullAt)
  const runsOutAtMs = isFinite(forecastFull) ? forecastFull : pace.runsOutAtMs
  if (runsOutAtMs !== null && pace.status !== 'under') {
    return `${pace.status === 'on' ? 'On pace' : `${points}% over pace`} · runs out ${when(runsOutAtMs, nowMs)}`
  }
  if (pace.status === 'on') return 'On pace'
  if (pace.status === 'under') return `${points}% under pace · room to use more`
  return `${points}% over pace · slow down`
}

const paceStyle = (pace: Pace | null, percent: number): string | null => {
  // Colour means trouble: a limit that is filling up but under pace stays neutral.
  const severity = severityFor(percent)
  if (severity === 'critical') return `color: ${SEVERITY_COLORS.critical};`
  if (pace?.status === 'under') return null
  if (severity === 'warning' || pace?.status === 'over') return `color: ${SEVERITY_COLORS.warning};`
  return null
}

const resetText = (limit: Limit, nowMs: number): string | null => {
  const until = formatUntil(limit.resetsAt, nowMs)
  if (until === null) return null
  if (until === 'now') return 'Resetting now'
  const clock = formatResetClock(limit.resetsAt, nowMs)
  return clock === null ? `Resets in ${until}` : `Resets ${clock}`
}

const percentRow = (
  limit: Limit,
  display: LimitDisplay,
  styleClass: string,
  style: string | null,
): St.BoxLayout => {
  const row = new St.BoxLayout({ x_align: Clutter.ActorAlign.END })
  row.add_child(label(formatPercent(Math.max(0, displayPercent(limit.percent, display))), styleClass, style))
  const unit = label(display, `aiu-card-unit ${styleClass}-unit`)
  unit.y_align = Clutter.ActorAlign.END
  row.add_child(unit)
  const forecast = limit.forecast ?? null
  if (forecast !== null) {
    row.add_child(
      label(
        `est. ${formatPercent(displayPercent(forecast.percent, display))} at reset`,
        `aiu-card-forecast aiu-forecast-${forecastBand(forecast.percent)}`,
      ),
    )
  }
  return row
}

const tile = (provider: Provider): St.Bin =>
  new St.Bin({
    style_class: 'aiu-tile',
    style: `background-color: ${providerColor(provider)};`,
    y_align: Clutter.ActorAlign.CENTER,
    child: new St.Icon({
      gicon: new Gio.FileIcon({ file: Gio.File.new_for_uri(`${ICONS_URI}${provider.kind}-symbolic.svg`) }),
      icon_size: 17,
      style_class: 'aiu-tile-icon',
    }),
  })

export type CardOptions = {
  nowMs: number
  display: LimitDisplay
  expanded: boolean
  onToggleDetails: () => void
  details: (box: St.BoxLayout) => void
}

export const providerCard = (provider: Provider, options: CardOptions): PopupMenu.PopupBaseMenuItem => {
  const { nowMs, display } = options
  const color = providerColor(provider)
  const item = staticItem('aiu-card-item')
  const card = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'aiu-card' })
  item.add_child(card)

  const [main, ...others] = provider.limits
  const mainPace = main === undefined ? null : paceFor(main, nowMs)

  const header = new St.BoxLayout({ style_class: 'aiu-card-header' })
  header.add_child(tile(provider))
  const names = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER })
  names.add_child(label(provider.name, 'aiu-card-name'))
  if (provider.account.plan !== null) names.add_child(label(provider.account.plan, 'aiu-card-sub'))
  header.add_child(names)
  header.add_child(spacer())
  if (main !== undefined) {
    const right = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER })
    right.add_child(percentRow(main, display, 'aiu-card-big', `color: ${color};`))
    const caption = [main.label.replace(/ \(.*\)$/, ''), resetText(main, nowMs)]
      .filter((part) => part !== null)
      .join(' · ')
    const sub = label(caption, 'aiu-card-sub')
    sub.x_align = Clutter.ActorAlign.END
    right.add_child(sub)
    header.add_child(right)
  }
  card.add_child(header)

  if (main !== undefined) {
    card.add_child(paceBar(main, mainPace, display, color, 6))
    if (mainPace !== null) {
      card.add_child(label(paceText(mainPace, main, nowMs), 'aiu-card-pace', paceStyle(mainPace, main.percent)))
    }
  } else {
    card.add_child(label('No limits reported', 'aiu-card-sub'))
  }

  for (const limit of others) {
    const pace = paceFor(limit, nowMs)
    const block = new St.BoxLayout({ vertical: true, style_class: 'aiu-card-limit' })
    const top = new St.BoxLayout()
    top.add_child(label(limit.label.replace(/ \(7 day\)$/, ''), 'aiu-card-limit-label'))
    top.add_child(spacer())
    top.add_child(percentRow(limit, display, 'aiu-card-limit-percent', null))
    block.add_child(top)
    block.add_child(paceBar(limit, pace, display, color, 4))
    const parts = [resetText(limit, nowMs), pace === null ? null : paceText(pace, limit, nowMs)]
    const caption = parts.filter((part) => part !== null).join(' · ')
    if (caption.length > 0) block.add_child(label(caption, 'aiu-card-sub', paceStyle(pace, limit.percent)))
    card.add_child(block)
  }

  if (provider.limitsAt !== null && provider.limits.length > 0) {
    const ago = formatAgo(provider.limitsAt, nowMs)
    const source = provider.kind === 'claude' ? 'the last successful read' : 'the last recorded session'
    card.add_child(wrapping(`Limits from ${source}${ago === null ? '' : ` · ${ago}`}`, 'aiu-card-note'))
  }

  const cost = provider.cost
  const toggle = new St.Button({ style_class: 'aiu-card-cost', x_expand: true, can_focus: true })
  const costRow = new St.BoxLayout({ x_expand: true })
  costRow.add_child(label(`${formatTokens(totalTokens(cost.tokens))} tokens`, 'aiu-card-sub'))
  costRow.add_child(spacer())
  costRow.add_child(label(formatUsd(cost.usd), 'aiu-card-usd'))
  costRow.add_child(
    new St.Icon({
      icon_name: options.expanded ? 'pan-down-symbolic' : 'pan-end-symbolic',
      icon_size: 14,
      style_class: 'aiu-card-chevron',
    }),
  )
  toggle.set_child(costRow)
  toggle.connect('clicked', () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      options.onToggleDetails()
      return GLib.SOURCE_REMOVE
    })
    return Clutter.EVENT_STOP
  })
  card.add_child(toggle)

  if (options.expanded) {
    const details = new St.BoxLayout({ vertical: true, style_class: 'aiu-card-details' })
    options.details(details)
    card.add_child(details)
  }

  for (const warning of provider.warnings) card.add_child(wrapping(warning, 'aiu-card-note'))
  return item
}

export const detailRow = (key: string, value: string, dim = false): St.BoxLayout => {
  const row = new St.BoxLayout({ style_class: 'aiu-detail-row' })
  row.add_child(label(key, dim ? 'aiu-detail-key aiu-dim' : 'aiu-detail-key'))
  row.add_child(spacer())
  row.add_child(label(value, dim ? 'aiu-detail-value aiu-dim' : 'aiu-detail-value'))
  return row
}

export const detailGap = (): St.Widget => new St.Widget({ style_class: 'aiu-detail-gap' })
