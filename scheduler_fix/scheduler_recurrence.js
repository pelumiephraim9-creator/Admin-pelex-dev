'use strict';

const DAY_MS = 86400000;
const STEPS = { daily: 1, every2days: 2, every3days: 3, weekly: 7, biweekly: 14, fortnightly: 14 };

function parseDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid schedule date');
  return d;
}

/**
 * Advances from the scheduled instant, not from worker completion time.
 * Weekday/monthly calculations use UTC to avoid server-local timezone drift.
 * This keeps the clock time stable in UTC; timezone-aware scheduling should
 * store next_run as a timestamptz already converted from the user's timezone.
 */
function nextAfter(previous, frequency, now = new Date()) {
  const d = parseDate(previous);
  const freq = String(frequency || 'daily').toLowerCase();
  if (freq === 'monthly') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else if (freq === 'weekdays') {
    do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay()));
  } else {
    d.setTime(d.getTime() + (STEPS[freq] || 1) * DAY_MS);
  }
  // Catch up if a task has been overdue for a long time; avoid replay storms.
  let guard = 0;
  while (d <= now && guard++ < 500) {
    if (freq === 'monthly') {
      const day = d.getUTCDate();
      d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
    } else if (freq === 'weekdays') {
      do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay()));
    } else d.setTime(d.getTime() + (STEPS[freq] || 1) * DAY_MS);
  }
  return d.toISOString();
}
module.exports = { nextAfter };
