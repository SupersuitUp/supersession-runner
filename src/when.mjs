// WHEN a session should run: one time, an interval, a clock rule, a monthly rule, or an hours window.
// Pure; local time throughout, because "Monday at 9" means the person's Monday.

/** Shorter than this and a schedule is a busy loop, not a schedule. */
export const MIN_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Every word that names a day, as a whole word: the short name, the full name, its plural, and the common longer
 * abbreviations. Never the first three letters of any word: that read "monthly" as Monday, "sunset" as Sunday and
 * "wedding" as Wednesday.
 */
const DAY_WORDS = (() => {
  const out = {};
  const forms = [["sun", "sunday"], ["mon", "monday"], ["tue", "tues", "tuesday"], ["wed", "weds", "wednesday"],
    ["thu", "thur", "thurs", "thursday"], ["fri", "friday"], ["sat", "saturday"]];
  forms.forEach((names, day) => { for (const n of names) { out[n] = day; out[`${n}s`] = day; } });
  return Object.freeze(out);
})();
const dayOf = (w) => (Object.hasOwn(DAY_WORDS, w) ? DAY_WORDS[w] : null);
const ALL = [0, 1, 2, 3, 4, 5, 6];

/**
 * "3h", "45m", "2d", a clock rule ("daily 07:00", "weekdays 08:30", "mon, thu 18:00"), or a monthly rule:
 * a day of the month ("monthly 5 09:00", "on the 5th 09:00", "last day of the month 18:00"), a deadline
 * ("by the 5th 09:00": it runs on the 1st), or an nth weekday ("second thursday 09:00", "last friday 16:00").
 * Throws, naming it.
 */
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
    const monthly = parseMonthly(ck[1], text, hh, mm);
    if (monthly) return monthly;
    let days = [];
    for (const w of ck[1].split(/[\s,]+/).filter(Boolean)) {
      if (w === "daily" || w === "every" || w === "day" || w === "everyday") days.push(...ALL);
      else if (w === "weekdays" || w === "weekday") days.push(1, 2, 3, 4, 5);
      else if (w === "weekends" || w === "weekend") days.push(0, 6);
      else if (dayOf(w) != null) days.push(dayOf(w));
      else throw new Error(`Every: "${w}" in ${text} is not a day; say daily, weekdays, weekends, or day names`);
    }
    days = [...new Set(days)].sort((a, b) => a - b);
    return { kind: "clock", days, hh, mm };
  }
  throw new Error(`Every: ${text || "(empty)"} is not an interval (3h, 45m, 2d), a clock rule (daily 07:00, weekdays 08:30, monday 09:00) or a monthly rule (on the 5th 09:00, second thursday 09:00)`);
}

// ── Monthly rules (supersuit-dev#3187, #2413) ───────────────────────────────────────────────
//
// { kind: "monthly", day: 1-31 | "last", by?: 1-31, hh, mm } or { kind: "monthly", nth: 1-4 | -1, weekday: 0-6, hh, mm }.
// A day past the month's end runs on its last day, so "the 31st" is February's 28th or 29th. "By the 5th" is a
// deadline: it runs on the 1st, and a schedule never run that was written before the deadline is owed at once.
// Read only when the words name a day number, "last", "by" or an ordinal, none of which the clock grammar takes, so
// every phrase that parsed before parses exactly as it did, with one deliberate exception: a bare "monthly 09:00"
// (no day), which the old prefix day reader took as Monday, is refused (0.3.1).
const NTH = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };
const FILLER = new Set(["on", "the", "of", "every", "each", "month", "monthly", "at", "in", "a"]);
const MONTHLY_MARK = /^(\d{1,2}(st|nd|rd|th)?|last|by|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)$/;
const weekdayOf = dayOf;
const MONTHLY_FORMS = '"on the 5th 09:00", "by the 5th 09:00", "last day of the month 09:00" or "second thursday 09:00"';

function parseMonthly(head, text, hh, mm) {
  const words = head.split(/[\s,]+/).filter(Boolean);
  if (!words.some((w) => MONTHLY_MARK.test(w))) {
    // "monthly 09:00" names no day. It used to fall through to the clock grammar and run every Monday.
    if (words.some((w) => w === "monthly" || w === "month" || w === "months")) {
      throw new Error(`Every: ${text} says monthly but not which day of the month; say ${MONTHLY_FORMS}`);
    }
    return null;
  }
  const w = words.filter((x) => !FILLER.has(x));
  const by = w[0] === "by";
  if (by) w.shift();
  const num = w.length === 1 && w[0].match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (num) {
    const day = Number(num[1]);
    if (day < 1 || day > 31) throw new Error(`Every: ${text} names day ${day}, and a month has days 1 to 31`);
    return by ? { kind: "monthly", day: 1, by: day, hh, mm } : { kind: "monthly", day, hh, mm };
  }
  if (!by && w[0] === "last" && (w.length === 1 || (w.length === 2 && w[1] === "day"))) return { kind: "monthly", day: "last", hh, mm };
  if (!by && w.length === 2 && NTH[w[0]] != null && weekdayOf(w[1]) != null) return { kind: "monthly", nth: NTH[w[0]], weekday: weekdayOf(w[1]), hh, mm };
  throw new Error(`Every: ${text} is not a monthly rule; say the day ("on the 5th 09:00", "by the 5th 09:00", "last day of the month 09:00") or the weekday ("second thursday 09:00", "last friday 09:00"; first to fourth, or last)`);
}

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
/** The day of month `m` (0-based) of year `y` a monthly rule runs on. */
function monthDay(rule, y, m) {
  const dim = daysIn(y, m);
  if (rule.nth == null) return rule.day === "last" ? dim : Math.min(rule.day, dim);
  if (rule.nth === -1) return dim - ((new Date(y, m, dim).getDay() - rule.weekday + 7) % 7);
  return 1 + ((rule.weekday - new Date(y, m, 1).getDay() + 7) % 7) + 7 * (rule.nth - 1);
}
const inMonth = (rule, y, m) => new Date(y, m, monthDay(rule, y, m), rule.hh, rule.mm, 0, 0);

/** The end of the deadline day of a "by" rule's occurrence `occ`, or null for any other rule. */
export function deadlineOf(rule, occ) {
  if (rule?.kind !== "monthly" || !rule.by || !occ) return null;
  const y = occ.getFullYear(), m = occ.getMonth();
  return new Date(y, m, Math.min(rule.by, daysIn(y, m)), 23, 59, 59, 999);
}

/** "2026-10-18 15:00" as a local Date. Throws, naming it. */
export function parseAt(text) {
  const m = String(text ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`At: ${text || "(empty)"} is not a local time like 2026-10-18 15:00`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  if (Number.isNaN(d.getTime()) || d.getHours() !== Number(m[4])) throw new Error(`At: ${text} is not a real time`);
  return d;
}

/** The most recent occurrence of a clock or monthly rule at or before `now` (a clock rule: within eight days). */
export function lastOccurrence(rule, now = new Date()) {
  if (rule?.kind === "monthly") {
    for (let back = 0; back <= 1; back++) {
      const d = inMonth(rule, now.getFullYear(), now.getMonth() - back);
      if (d <= now) return d;
    }
    return null;
  }
  for (let back = 0; back <= 8; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, rule.hh, rule.mm, 0, 0);
    if (d <= now && rule.days.includes(d.getDay())) return d;
  }
  return null;
}

/** The first occurrence of a clock or monthly rule strictly after `after`. */
export function nextOccurrence(rule, after = new Date()) {
  if (rule?.kind === "monthly") {
    for (let ahead = 0; ahead <= 1; ahead++) {
      const d = inMonth(rule, after.getFullYear(), after.getMonth() + ahead);
      if (d > after) return d;
    }
    return null;
  }
  for (let ahead = 0; ahead <= 8; ahead++) {
    const d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + ahead, rule.hh, rule.mm, 0, 0);
    if (d > after && rule.days.includes(d.getDay())) return d;
  }
  return null;
}

const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORD = { 1: "first", 2: "second", 3: "third", 4: "fourth", "-1": "last" };
const nth = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const hm = (r) => `${String(r.hh).padStart(2, "0")}:${String(r.mm).padStart(2, "0")}`;
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What a parsed Every rule means, in plain words, for a person reading a list of schedules. */
export function describeEvery(rule) {
  if (!rule) return "";
  if (rule.kind === "interval") {
    const [n, unit] = rule.ms % 86400e3 === 0 ? [rule.ms / 86400e3, "day"] : rule.ms % 3600e3 === 0 ? [rule.ms / 3600e3, "hour"] : [Math.round(rule.ms / 60e3), "minute"];
    return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  }
  if (rule.kind === "monthly") {
    if (rule.by) return `by the ${nth(rule.by)} of every month: it runs on the 1st at ${hm(rule)}, and a run missed before the ${nth(rule.by)} happens as soon as it can`;
    if (rule.nth != null) return `on the ${ORD[rule.nth]} ${NAMES[rule.weekday]} of every month at ${hm(rule)}`;
    if (rule.day === "last") return `on the last day of every month at ${hm(rule)}`;
    return `on the ${nth(rule.day)} of every month at ${hm(rule)}${rule.day > 28 ? ", or the month's last day when it is shorter" : ""}`;
  }
  const d = rule.days || [];
  if (d.length === 7) return `every day at ${hm(rule)}`;
  if (d.join() === "1,2,3,4,5") return `every weekday at ${hm(rule)}`;
  const order = [1, 2, 3, 4, 5, 6, 0].filter((x) => d.includes(x));
  return `every ${andList(order.map((x) => NAMES[x]))} at ${hm(rule)}`;
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
