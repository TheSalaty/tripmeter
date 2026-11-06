import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import St from 'gi://St'

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

export const staticItem = (styleClass: string): PopupMenu.PopupBaseMenuItem =>
  new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    style_class: `popup-menu-item aiu-row ${styleClass}`,
  })

export const note = (text: string): PopupMenu.PopupBaseMenuItem => {
  const item = staticItem('aiu-note')
  const label = new St.Label({ text, style_class: 'aiu-note-label' })
  label.clutter_text.line_wrap = true
  label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
  item.add_child(label)
  return item
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
