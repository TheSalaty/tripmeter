import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import St from 'gi://St'

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import { forecastBand } from '../lib/forecast.js'
import { formatPercent, formatResetClock, formatUntil } from '../lib/format.js'
import { severityFor } from '../lib/snapshot.js'
import type { Attribution, Limit } from '../lib/types.js'

export const staticItem = (styleClass: string): PopupMenu.PopupBaseMenuItem =>
  new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    style_class: `popup-menu-item aiu-row ${styleClass}`,
  })

export const sectionHeader = (title: string, trailing: string | null): PopupMenu.PopupBaseMenuItem => {
  const item = staticItem('aiu-section-header')
  item.add_child(new St.Label({ text: title, style_class: 'aiu-section-title' }))
  item.add_child(new St.Widget({ x_expand: true }))
  if (trailing !== null) {
    item.add_child(new St.Label({ text: trailing, style_class: 'aiu-section-trailing' }))
  }
  return item
}

export const keyValue = (
  key: string,
  value: string,
  options: { dim?: boolean } = {},
): PopupMenu.PopupBaseMenuItem => {
  const item = staticItem('aiu-kv')
  item.add_child(
    new St.Label({
      text: key,
      style_class: options.dim === true ? 'aiu-kv-key aiu-dim' : 'aiu-kv-key',
    }),
  )
  item.add_child(new St.Widget({ x_expand: true }))
  item.add_child(new St.Label({ text: value, style_class: 'aiu-kv-value' }))
  return item
}

export const note = (text: string): PopupMenu.PopupBaseMenuItem => {
  const item = staticItem('aiu-note')
  const label = new St.Label({ text, style_class: 'aiu-note-label' })
  label.clutter_text.line_wrap = true
  label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
  item.add_child(label)
  return item
}

export const limitRow = (limit: Limit, nowMs: number): PopupMenu.PopupBaseMenuItem => {
  const item = staticItem('aiu-limit')
  const column = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'aiu-limit-box' })
  const forecast = limit.forecast ?? null

  const heading = new St.BoxLayout({ x_expand: true })
  heading.add_child(new St.Label({ text: limit.label, style_class: 'aiu-limit-label' }))
  heading.add_child(new St.Widget({ x_expand: true }))
  heading.add_child(
    new St.Label({ text: formatPercent(limit.percent), style_class: 'aiu-limit-percent' }),
  )
  if (forecast !== null) {
    heading.add_child(
      new St.Label({
        text: `→ ${formatPercent(forecast.percent)}`,
        style_class: `aiu-limit-forecast aiu-forecast-${forecastBand(forecast.percent)}`,
      }),
    )
  }
  column.add_child(heading)

  // Two stacked bars rather than one: the lower one carries the projection, the upper one paints
  // today's usage over it with a transparent track so both segments stay visible.
  const stack = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true })
  if (forecast !== null) {
    const projection = new BarLevel.BarLevel({
      style_class: `aiu-bar aiu-bar-forecast aiu-bar-forecast-${forecastBand(forecast.percent)}`,
      x_expand: true,
    })
    projection.value = barValue(forecast.percent)
    stack.add_child(projection)
  }
  const bar = new BarLevel.BarLevel({
    style_class:
      `aiu-bar aiu-bar-${severityFor(limit.percent)}` + (forecast === null ? '' : ' aiu-bar-stacked'),
    x_expand: true,
  })
  bar.value = barValue(limit.percent)
  stack.add_child(bar)
  column.add_child(stack)

  const footer = new St.BoxLayout({ x_expand: true })
  const until = formatUntil(limit.resetsAt, nowMs)
  if (until !== null) {
    const clock = formatResetClock(limit.resetsAt, nowMs)
    footer.add_child(
      new St.Label({
        text:
          until === 'now'
            ? 'Resetting now'
            : `Resets in ${until}${clock === null ? '' : ` · ${clock}`}`,
        style_class: 'aiu-limit-reset aiu-dim',
      }),
    )
  }
  const full = forecast === null ? null : formatUntil(forecast.fullAt, nowMs)
  if (full !== null) {
    footer.add_child(new St.Widget({ x_expand: true }))
    footer.add_child(
      new St.Label({ text: `full in ${full}`, style_class: 'aiu-limit-forecast aiu-forecast-over' }),
    )
  }
  if (footer.get_n_children() > 0) column.add_child(footer)

  item.add_child(column)
  return item
}

const barValue = (percent: number): number => Math.max(0, Math.min(1, percent / 100))

export const attributionRows = (
  title: string,
  entries: readonly Attribution[],
  total: number,
  limit: number,
): PopupMenu.PopupBaseMenuItem[] => {
  if (entries.length === 0 || total <= 0) return []
  const rows = [keyValue(title, '% of cost', { dim: true })]
  for (const entry of entries.slice(0, limit)) {
    const share = Math.round((entry.usd / total) * 100)
    if (share < 1) continue
    rows.push(keyValue(`    ${entry.name}`, `${share}%`))
  }
  return rows.length > 1 ? rows : []
}

export const choiceRow = <T extends string | number>(
  choices: readonly { value: T; label: string }[],
  selected: T,
  onSelect: (value: T) => void,
): PopupMenu.PopupBaseMenuItem => {
  const item = staticItem('aiu-choices')
  const box = new St.BoxLayout({ x_expand: true, style_class: 'aiu-choice-box' })
  for (const choice of choices) {
    const button = new St.Button({
      label: choice.label,
      style_class:
        choice.value === selected ? 'aiu-choice aiu-choice-active' : 'aiu-choice',
      can_focus: true,
      x_expand: true,
    })
    button.connect('clicked', () => {
      onSelect(choice.value)
      return Clutter.EVENT_STOP
    })
    box.add_child(button)
  }
  item.add_child(box)
  return item
}
