// WHEN a session should run: one time, an interval, a clock rule, or an hours window.
// Pure; local time throughout, because "Monday at 9" means the person's Monday.

/** Shorter than this and a schedule is a busy loop, not a schedule. */
export const MIN_INTERVAL_MS = 5 * 60 * 1000;
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const ALL = [0, 1, 2, 3, 4, 5, 6];

/** "3h", "45m", "2d", or a clock rule: "daily 07:00", "weekdays 08:30", "mon, thu 18:00". Throws, naming it. */
export function parseEvery(text) {
  const t = String(text ?? "").trim().toLowerCase();
  const iv = t.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (iv) {
    const n = Number(iv[1]), u = iv[2][0];
    const ms = n * (u === "m" ? 60e3 : u === "h" ? 3600e3 : 86400e3);
    if (ms < MIN_INTERVAL_MS) throw new Error(`Every: ${text} is under five minutes, which is a busy loop, not a schedule`);
    return { kind: "interval", ms };
  }
  const ck = t.match(/^(.+?)\s+(\d{1,2}):(\d{2})$/);
  if (ck) {
    const hh = Number(ck[2]), mm = Number(ck[3]);
    if (hh > 23 || mm > 59) throw new Error(`Every: ${text} is not a time of day`);
    let days = [];
    for (const w of ck[1].split(/[\s,]+/).filter(Boolean)) {
      if (w === "daily" || w === "every" || w === "day" || w === "everyday") days.push(...ALL);
      else if (w === "weekdays" || w === "weekday") days.push(1, 2, 3, 4, 5);
      else if (w === "weekends" || w === "weekend") days.push(0, 6);
      else if (DAYS[w.slice(0, 3)] != null && /^[a-z]+s?$/.test(w)) days.push(DAYS[w.slice(0, 3)]);
      else throw new Error(`Every: "${w}" in ${text} is not a day; say daily, weekdays, weekends, or day names`);
    }
    days = [...new Set(days)].sort((a, b) => a - b);
    return { kind: "clock", days, hh, mm };
  }
  throw new Error(`Every: ${text || "(empty)"} is not an interval (3h, 45m, 2d) or a clock rule (daily 07:00, weekdays 08:30, monday 09:00)`);
}

/** "2026-10-18 15:00" as a local Date. Throws, naming it. */
export function parseAt(text) {
  const m = String(text ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`At: ${text || "(empty)"} is not a local time like 2026-10-18 15:00`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  if (Number.isNaN(d.getTime()) || d.getHours() !== Number(m[4])) throw new Error(`At: ${text} is not a real time`);
  return d;
}

/** The most recent occurrence of a clock rule at or before `now`, within the last eight days. */
export function lastOccurrence(rule, now = new Date()) {
  for (let back = 0; back <= 8; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, rule.hh, rule.mm, 0, 0);
    if (d <= now && rule.days.includes(d.getDay())) return d;
  }
  return null;
}

/** "01:00-05:00" as { start, end }; a window may wrap past midnight. Null for anything else. */
export function parseWindow(text) {
  const m = String(text ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hm = (h, mm = "0") => (Number(h) > 23 || Number(mm) > 59 ? null : `${String(Number(h)).padStart(2, "0")}:${String(Number(mm)).padStart(2, "0")}`);
  const start = hm(m[1], m[2]), end = hm(m[3], m[4]);
  return start && end && start !== end ? { start, end } : null;
}

const minutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
/** Is `now` inside the window? No window means any time. The end is exclusive. */
export function inWindow(window, now = new Date()) {
  if (!window) return true;
  const t = now.getHours() * 60 + now.getMinutes(), s = minutes(window.start), e = minutes(window.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The local day of a Date, YYYY-MM-DD. */
export const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
