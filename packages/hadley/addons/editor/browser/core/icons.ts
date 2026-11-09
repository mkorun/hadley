// One set of icons for the whole editor (and its chat, features/chat/): a 16 × 16 grid, lines of 1.6 with
// round ends and joins, no fill, in currentColor, so that each takes the colour and contrast of its control.
import { svg, type Shape } from './dom.ts'

const path = (d: string): Shape => ['path', { d }]
const dot = (cx: string): Shape => ['circle', { cx, cy: '8', r: '1.2', fill: 'currentColor', stroke: 'none' }]
const colon = (cy: string): Shape => ['circle', { cx: '7.75', cy, r: '.5', fill: 'currentColor' }]

const ICONS = {
  dots: [dot('3.5'), dot('8'), dot('12.5')],
  up: [path('M4 10l4-4 4 4')],
  down: [path('M4 6l4 4 4-4')],
  // merged with the block above or below: the neighbour as a frame, an arrow into it (Michael, 2026-11-09: a bar
  // over an arrow read as "to the top")
  merge_top: [
    ['rect', { x: '2.5', y: '2', width: '11', height: '5', rx: '1.2' }],
    path('M8 14V9.2M5.8 11.4L8 9.2l2.2 2.2'),
  ],
  merge_bot: [
    ['rect', { x: '2.5', y: '9', width: '11', height: '5', rx: '1.2' }],
    path('M8 2v4.8M5.8 4.6L8 6.8l2.2-2.2'),
  ],
  delete: [path('M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M7 7v3.5M9 7v3.5')],
  add: [path('M8 3.5v9M3.5 8h9')],
  // the front matter: keys, their colons and values, as Lima writes them
  data: [path('M2.5 4h3M2.5 8h3M2.5 12h3M10 4h3.5M10 8h2M10 12h3.5'), colon('4'), colon('8'), colon('12')],
  file: [path('M4 2.5h5l3 3v8H4zM9 2.5v3h3')],
  // the bundle's files, folded under the field (drawers.ts): a paper clip
  attach: [path('M10.5 7.5 6.6 11.4a2 2 0 0 1-2.8-2.8l4.6-4.6a3 3 0 0 1 4.2 4.2L8 12.8')],
  pencil: [path('M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3')],
  // the versions of a page: a clock
  clock: [['circle', { cx: '8', cy: '8', r: '5.5' }], path('M8 5v3.2l2.2 1.5')],
  // undo and redo: a ring with its arrow back, or forth (Michael, 2026-11-09)
  undo: [path('M3.8 9.5A4.5 4.5 0 1 0 5 4.7'), path('M3.5 2.5v3h3')],
  redo: [path('M12.2 9.5A4.5 4.5 0 1 1 11 4.7'), path('M12.5 2.5v3h-3')],
  // a version kept: a bookmark
  bookmark: [path('M4.5 2.5h7v11L8 10.8l-3.5 2.7z')],
  // the chat (features/chat/): its bubble, closing it, larger and smaller, what an AI does, and done
  chat: [path('M3 4.5h10v6H7l-3 2.5v-2.5H3z')],
  cross: [path('M4.5 4.5l7 7M11.5 4.5l-7 7')],
  expand: [path('M9.5 3H13v3.5M6.5 13H3V9.5M13 3l-4 4M3 13l4-4')],
  shrink: [path('M13 6.5H9.5V3M3 9.5h3.5V13M9.5 6.5 13 3M6.5 9.5 3 13')],
  // a large and a small star, as a sign of what an AI does; eight rays read as "loading" (Michael, 2026-11-09)
  sparkle: [
    [
      'path',
      { fill: 'currentColor', d: 'M7 2.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4z' },
    ],
    [
      'path',
      {
        fill: 'currentColor',
        d: 'M12.5 10.5c.2 1 .5 1.3 1.5 1.5-1 .2-1.3.5-1.5 1.5-.2-1-.5-1.3-1.5-1.5 1-.2 1.3-.5 1.5-1.5z',
      },
    ],
  ],
  check: [path('M3.5 8.5l3 3 6-7')],
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
