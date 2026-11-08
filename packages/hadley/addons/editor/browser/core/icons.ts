// One set of icons for the whole editor (and the chat, addons/chat/assets/chat.js): a 16 × 16 grid, lines of 1.6 with
// round ends and joins, no fill, in currentColor, so that each takes the colour and contrast of its control.
import { svg, type Shape } from './dom.ts'

const path = (d: string): Shape => ['path', { d }]
const dot = (cx: string): Shape => ['circle', { cx, cy: '8', r: '1.2', fill: 'currentColor', stroke: 'none' }]
const colon = (cy: string): Shape => ['circle', { cx: '7.75', cy, r: '.5', fill: 'currentColor' }]

const ICONS = {
  dots: [dot('3.5'), dot('8'), dot('12.5')],
  up: [path('M4 10l4-4 4 4')],
  down: [path('M4 6l4 4 4-4')],
  merge_top: [path('M3 3h10M8 13V6.5M5 9.5l3-3 3 3')],
  merge_bot: [path('M3 13h10M8 3v6.5M5 6.5l3 3 3-3')],
  delete: [path('M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M7 7v3.5M9 7v3.5')],
  add: [path('M8 3.5v9M3.5 8h9')],
  // the front matter: keys, their colons and values, as Lima writes them
  data: [path('M2.5 4h3M2.5 8h3M2.5 12h3M10 4h3.5M10 8h2M10 12h3.5'), colon('4'), colon('8'), colon('12')],
  file: [path('M4 2.5h5l3 3v8H4zM9 2.5v3h3')],
  pencil: [path('M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3')],
} satisfies Record<string, readonly Shape[]>

export type IconName = keyof typeof ICONS

export const icon = (name: IconName): SVGSVGElement =>
  svg(
    {
      viewBox: '0 0 16 16',
      width: '15',
      height: '15',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    ICONS[name],
  )
