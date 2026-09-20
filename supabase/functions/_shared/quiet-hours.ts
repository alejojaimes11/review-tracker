// Silent hours: notifications generated inside the quiet window are not sent
// right away — they wait (status pending, scheduled_for = end of the window).
// Pure functions, no I/O.

export const NOTIFICATION_TZ = 'America/Bogota'
export const QUIET_START_HOUR = 22 // 22:00 local
export const QUIET_END_HOUR = 7 // 07:00 local

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Offset of `tz` from UTC at `date`, in ms (negative west of UTC). */
function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d h:00. */
function localHourToUtc(year: number, month: number, day: number, hour: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0)
  const first = guess - tzOffsetMs(new Date(guess), tz)
  // A second pass covers the case where the offset differs at the corrected instant (DST zones).
  return new Date(guess - tzOffsetMs(new Date(first), tz))
}

export function isQuietHour(date: Date, tz = NOTIFICATION_TZ): boolean {
  const { hour } = localParts(date, tz)
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

/** `date` itself when sending is allowed, otherwise the next 07:00 local. */
export function nextSendTime(date: Date, tz = NOTIFICATION_TZ): Date {
  if (!isQuietHour(date, tz)) return date
  const p = localParts(date, tz)
  // Evening (>= 22:00) waits until tomorrow morning; early morning (< 07:00) until today's.
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + (p.hour >= QUIET_START_HOUR ? 1 : 0)))
  return localHourToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), QUIET_END_HOUR, tz)
}
