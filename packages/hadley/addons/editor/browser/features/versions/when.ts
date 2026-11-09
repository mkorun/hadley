// When a version was made, as the card says it: its day over a group ("Today", "Yesterday", "6 Nov"), its time in
// its row, and both in a sentence ("today, 11:40").
import { LANG, T } from '../../core/texts.ts'

const DAY = 24 * 60 * 60 * 1000

/** Days between the day of `at` and today: 0 today, 1 yesterday. */
function daysAgo(at: number, now = Date.now()): number {
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0)
  return Math.round((midnight(now) - midnight(at)) / DAY)
}

const date = (at: number): string =>
  new Date(at).toLocaleDateString(LANG, {
    day: 'numeric',
    month: 'short',
    ...(new Date(at).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  })

export const time = (at: number): string =>
  new Date(at).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' })

/** The day over a group of versions; the same for every version of one day. */
export function day(at: number): string {
  const ago = daysAgo(at)
  return ago === 0 ? T.today : ago === 1 ? T.yesterday : date(at)
}

/** Day and time in a sentence. */
export function moment(at: number): string {
  const ago = daysAgo(at)
  return ago === 0 ? T.todayAt(time(at)) : ago === 1 ? T.yesterdayAt(time(at)) : `${date(at)}, ${time(at)}`
}
