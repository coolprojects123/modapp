/**
 * ics-parser.js — small RFC 5545 subset.
 * Handles VEVENT blocks with SUMMARY, DESCRIPTION, DTSTART, DTEND, UID,
 * and RRULEs with FREQ=DAILY|WEEKLY|MONTHLY|YEARLY (+ COUNT or UNTIL).
 * Not handled: TZID-qualified dates, EXDATE, RDATE, RECURRENCE-ID,
 * BYDAY/BYMONTH/INTERVAL parts, exotic line folding.
 *
 * Fixes vs the original:
 * 1. Unbounded recurring rules are fast-forwarded past pre-window
 *    occurrences instead of burning the 500-occurrence cap in the past.
 * 2. MONTHLY/YEARLY supported (birthdays etc. actually recur now).
 * 3. Calendar-arithmetic stepping keeps local time across DST.
 * 4. Date-only UNTIL is inclusive of that whole day.
 * 5. Events carry allDay (true when DTSTART is a date, not a date-time),
 *    so a real midnight meeting isn't mistaken for an all-day event.
 */
window.CalendarICS = (function () {
  function unfold(text) {
    return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  }

  function parseDate(value) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    if (h === undefined) return new Date(Number(y), Number(mo) - 1, Number(d));
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`);
  }

  function parseRRule(value) {
    const parts = {};
    for (const pair of value.split(';')) {
      const [k, v] = pair.split('=');
      if (k) parts[k] = v;
    }
    return parts;
  }

  // Unescape RFC 5545 text: \\n -> newline, \\, \; \\\ -> literal chars.
  function unescapeText(value) {
    return value
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  const SUPPORTED = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
  const MAX_OCCURRENCES = 500;

  function addSteps(date, freq, n) {
    const d = new Date(date);
    if (freq === 'DAILY') d.setDate(d.getDate() + n);
    else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7 * n);
    else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
    return d;
  }

  function stepsBefore(start, freq, windowStart) {
    if (start >= windowStart) return 0;
    const delta = windowStart - start;
    if (freq === 'DAILY') return Math.ceil(delta / 86400000);
    if (freq === 'WEEKLY') return Math.ceil(delta / (7 * 86400000));
    if (freq === 'MONTHLY') {
      return Math.max(0, (windowStart.getFullYear() - start.getFullYear()) * 12 +
        (windowStart.getMonth() - start.getMonth()));
    }
    return Math.max(0, windowStart.getFullYear() - start.getFullYear());
  }

  function expand(event, windowStart, horizon) {
    if (!event.rrule || !event.start) return [event];
    const freq = event.rrule.FREQ;
    if (!SUPPORTED.includes(freq)) return [event];

    const count = event.rrule.COUNT ? parseInt(event.rrule.COUNT, 10) : null;
    let until = event.rrule.UNTIL ? parseDate(event.rrule.UNTIL) : null;
    if (until && !event.rrule.UNTIL.includes('T')) {
      until = new Date(until.getTime() + 86399999); // date-only UNTIL: inclusive
    }
    const durationMs = event.end ? event.end.getTime() - event.start.getTime() : 0;

    let n = 0;
    let cursor = new Date(event.start.getTime());
    if (count === null) {
      cursor = addSteps(cursor, freq, stepsBefore(cursor, freq, windowStart));
    }

    const occurrences = [];
    while (occurrences.length < MAX_OCCURRENCES) {
      if (count !== null && n >= count) break;
      if (until && cursor > until) break;
      if (cursor > horizon) break;
      if (cursor >= windowStart) {
        occurrences.push({
          ...event,
          start: new Date(cursor.getTime()),
          end: durationMs ? new Date(cursor.getTime() + durationMs) : null,
        });
      }
      cursor = addSteps(cursor, freq, 1);
      n++;
    }
    return occurrences;
  }

  /**
   * Parses raw ICS text into a sorted array of occurrences:
   *   { uid, title, description|null, start: Date, end: Date|null }
   * Recurrences expand within [now - 90d, horizon] (default 1 year out).
   */
  function parse(text, horizon = new Date(Date.now() + 365 * 86400000)) {
    const windowStart = new Date(Date.now() - 90 * 86400000);
    const lines = unfold(text).split(/\r\n|\n/);
    const events = [];
    let current = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === 'BEGIN:VEVENT') {
        current = {};
        continue;
      }
      if (line === 'END:VEVENT') {
        if (current && current.start) events.push(current);
        current = null;
        continue;
      }
      if (!current) continue;

      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(';')[0];
      const value = line.slice(idx + 1);

      if (key === 'SUMMARY') current.title = unescapeText(value);
      else if (key === 'DESCRIPTION') current.description = unescapeText(value);
      else if (key === 'UID') current.uid = value;
      else if (key === 'DTSTART') {
        current.start = parseDate(value);
        current.allDay = /^\d{8}$/.test(value); // VALUE=DATE, not "starts at midnight"
      }
      else if (key === 'DTEND') current.end = parseDate(value);
      else if (key === 'RRULE') current.rrule = parseRRule(value);
    }

    const expanded = events.flatMap((e) => expand(e, windowStart, horizon));
    expanded.sort((a, b) => a.start - b.start);
    return expanded;
  }

  return { parse };
})();