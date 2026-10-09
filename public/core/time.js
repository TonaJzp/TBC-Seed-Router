// When banners can be rolled. The game's event data gives every banner a
// start and an end hour (11:00) that the game applies in the player's local
// time, so times here are local: minutes since the epoch at a local clock
// reading, from the device's time zone (summer time included).

// The hour banners change in the game data, for data without hours.
const DEFAULT_HOUR = '11:00';
const MINUTE_MS = 60_000;

const pad = (n) => String(n).padStart(2, '0');

/** The minute of local date `iso` (YYYY-MM-DD) at `hhmm` (HH:MM). */
function localMinute(iso, hhmm = '00:00') {
  const [y, m, d] = iso.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return Math.floor(new Date(y, m - 1, d, h, min).getTime() / MINUTE_MS);
}

/** The minute of a Date. */
const minuteOf = (date) => Math.floor(date.getTime() / MINUTE_MS);

/** Local date (YYYY-MM-DD) and time (HH:MM) of a minute. */
function localParts(minute) {
  const d = new Date(minute * MINUTE_MS);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** First minute of the day after `iso`. */
function nextDayMinute(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d + 1).getTime() / MINUTE_MS);
}

/** Minute a banner opens and minute it is gone (it can be rolled until the one before). */
const startsAt = (e) => localMinute(e.start, e.startTime || DEFAULT_HOUR);
const endsAt = (e) => localMinute(e.end, e.endTime || DEFAULT_HOUR);

export { DEFAULT_HOUR, localMinute, minuteOf, localParts, nextDayMinute, startsAt, endsAt };
