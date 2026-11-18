// Monthly rules (supersuit-dev#3187, #2413): a day of the month ("the 5th", "by the 5th", "last day of the month")
// and an nth weekday ("second thursday", "last friday"). Every phrase the clock grammar already took parses exactly
// as before; a short month runs a late day on its last day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvery, lastOccurrence, nextOccurrence, describeEvery, readSchedules, isDue } from "../src/index.mjs";

const at = (day, hh, mm = 0) => { const d = new Date(`${day}T00:00:00`); d.setHours(hh, mm, 0, 0); return d; };
const same = (a, b, msg) => assert.equal(a?.getTime(), b.getTime(), msg);

test("a day of the month, a deadline, the last day and an nth weekday all parse", () => {
  assert.deepEqual(parseEvery("monthly 5 09:00"), { kind: "monthly", day: 5, hh: 9, mm: 0 });
  assert.deepEqual(parseEvery("on the 5th 09:00"), { kind: "monthly", day: 5, hh: 9, mm: 0 });
  assert.deepEqual(parseEvery("the 15th of every month at 17:30"), { kind: "monthly", day: 15, hh: 17, mm: 30 });
  assert.deepEqual(parseEvery("by the 5th 09:00"), { kind: "monthly", day: 1, by: 5, hh: 9, mm: 0 });
  assert.deepEqual(parseEvery("last day of the month 18:00"), { kind: "monthly", day: "last", hh: 18, mm: 0 });
  assert.deepEqual(parseEvery("second thursday 09:00"), { kind: "monthly", nth: 2, weekday: 4, hh: 9, mm: 0 });
  assert.deepEqual(parseEvery("the 1st monday of the month 08:00"), { kind: "monthly", nth: 1, weekday: 1, hh: 8, mm: 0 });
  assert.deepEqual(parseEvery("last friday 16:00"), { kind: "monthly", nth: -1, weekday: 5, hh: 16, mm: 0 });
  for (const bad of ["monthly 32 09:00", "monthly 0 09:00", "fifth friday 09:00", "second 09:00", "by second thursday 09:00", "second funday 09:00", "the 5th 25:00"]) {
    assert.throws(() => parseEvery(bad), /Every/, bad);
  }
});

test("every phrase the clock grammar already took parses exactly as before", () => {
  assert.deepEqual(parseEvery("daily 07:00"), { kind: "clock", days: [0, 1, 2, 3, 4, 5, 6], hh: 7, mm: 0 });
  assert.deepEqual(parseEvery("Mon, Thu 18:00"), { kind: "clock", days: [1, 4], hh: 18, mm: 0 });
  assert.deepEqual(parseEvery("every monday 09:00"), { kind: "clock", days: [0, 1, 2, 3, 4, 5, 6], hh: 9, mm: 0 });
  assert.deepEqual(parseEvery("monthly 09:00"), { kind: "clock", days: [1], hh: 9, mm: 0 }, "an old reading, kept: a day word read by its first three letters");
  assert.deepEqual(parseEvery("3h"), { kind: "interval", ms: 3 * 3600e3 });
});

test("the 31st runs on the last day of a short month; 'last day' is the 28th, 29th, 30th or 31st", () => {
  const r31 = parseEvery("on the 31st 09:00");
  same(nextOccurrence(r31, at("2027-02-01", 0)), at("2027-02-28", 9), "February 2027");
  same(nextOccurrence(r31, at("2028-02-01", 0)), at("2028-02-29", 9), "leap February");
  same(nextOccurrence(r31, at("2026-04-01", 0)), at("2026-04-30", 9), "April");
  same(nextOccurrence(r31, at("2026-05-01", 0)), at("2026-05-31", 9), "May has one");
  same(lastOccurrence(r31, at("2027-03-10", 12)), at("2027-02-28", 9), "looking back across a short month");
  const last = parseEvery("last day of the month 18:00");
  same(nextOccurrence(last, at("2026-11-30", 18)), at("2026-12-31", 18), "strictly after");
  same(lastOccurrence(last, at("2026-11-30", 18)), at("2026-11-30", 18), "at the minute itself");
});

test("an nth weekday and the last one, across month boundaries", () => {
  const second = parseEvery("second thursday 09:00");
  same(nextOccurrence(second, at("2026-11-01", 0)), at("2026-11-12", 9));
  same(nextOccurrence(second, at("2026-11-12", 9)), at("2026-12-10", 9), "strictly after: next month's");
  same(lastOccurrence(second, at("2026-11-11", 12)), at("2026-10-08", 9), "before this month's: last month's");
  const lastFri = parseEvery("last friday 16:00");
  same(nextOccurrence(lastFri, at("2026-11-01", 0)), at("2026-11-27", 16));
  same(nextOccurrence(lastFri, at("2026-07-01", 0)), at("2026-07-31", 16), "the last day itself");
  same(lastOccurrence(lastFri, at("2026-12-01", 0)), at("2026-11-27", 16));
});

test("by the 5th runs on the 1st, so the work is done before the deadline", () => {
  const by = parseEvery("by the 5th 09:00");
  same(nextOccurrence(by, at("2026-11-17", 12)), at("2026-12-01", 9));
  same(lastOccurrence(by, at("2026-11-17", 12)), at("2026-11-01", 9));
});

test("clock rules are unchanged by nextOccurrence", () => {
  const r = parseEvery("weekdays 08:30");
  same(nextOccurrence(r, at("2026-10-17", 12)), at("2026-10-19", 8, 30), "Saturday: Monday's");
  same(nextOccurrence(r, at("2026-10-19", 8, 30)), at("2026-10-20", 8, 30), "strictly after");
});

test("every rule says what it means in plain words", () => {
  const says = (t) => describeEvery(parseEvery(t));
  assert.equal(says("3h"), "every 3 hours");
  assert.equal(says("45m"), "every 45 minutes");
  assert.equal(says("daily 07:00"), "every day at 07:00");
  assert.equal(says("weekdays 08:30"), "every weekday at 08:30");
  assert.equal(says("weekends 10:00"), "every Saturday and Sunday at 10:00");
  assert.equal(says("mon, thu 17:00"), "every Monday and Thursday at 17:00");
  assert.equal(says("monthly 5 09:00"), "on the 5th of every month at 09:00");
  assert.equal(says("on the 31st 09:00"), "on the 31st of every month at 09:00, or the month's last day when it is shorter");
  assert.equal(says("last day of the month 18:00"), "on the last day of every month at 18:00");
  assert.equal(says("second thursday 09:00"), "on the second Thursday of every month at 09:00");
  assert.equal(says("last friday 16:00"), "on the last Friday of every month at 16:00");
  assert.equal(says("by the 5th 09:00"), "by the 5th of every month: it runs on the 1st at 09:00, and a run missed before the 5th happens as soon as it can");
});

test("due: a monthly rule once a month; 'by the 5th' made on the 3rd still runs this month, made on the 6th waits", () => {
  const d = mkdtempSync(join(tmpdir(), "supersessions-"));
  writeFileSync(join(d, "a-second.md"), "# Second\n\n**Every:** second thursday 09:00\n**Method:** x\n");
  writeFileSync(join(d, "b-early.md"), "# Early\n\n**Every:** by the 5th 09:00\n**Method:** x\n");
  writeFileSync(join(d, "c-late.md"), "# Late\n\n**Every:** by the 5th 09:00\n**Method:** x\n");
  utimesSync(join(d, "a-second.md"), at("2026-11-01", 12), at("2026-11-01", 12));
  utimesSync(join(d, "b-early.md"), at("2026-11-03", 12), at("2026-11-03", 12));
  utimesSync(join(d, "c-late.md"), at("2026-11-06", 12), at("2026-11-06", 12));
  const [second, early, late] = readSchedules(d);
  assert.equal(isDue(second, { now: at("2026-11-12", 8, 59) }), false);
  assert.equal(isDue(second, { now: at("2026-11-12", 9, 5) }), true);
  assert.equal(isDue(second, { now: at("2026-11-20", 9), attempt: { startedAt: at("2026-11-12", 9, 5).toISOString(), status: "ok" } }), false);
  assert.equal(isDue(early, { now: at("2026-11-03", 12, 15) }), true, "made inside the window: owed now");
  assert.equal(isDue(late, { now: at("2026-11-06", 12, 15) }), false, "made after the deadline: next month");
  assert.equal(isDue(late, { now: at("2026-12-01", 9, 1) }), true);
  assert.equal(isDue(early, { now: at("2026-11-04", 9), attempt: { startedAt: at("2026-11-03", 12, 15).toISOString(), status: "ok" } }), false, "once a month");
  rmSync(d, { recursive: true, force: true });
});
