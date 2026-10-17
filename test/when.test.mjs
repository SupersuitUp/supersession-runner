import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvery, parseAt, lastOccurrence, parseWindow, inWindow } from "../src/index.mjs";

const at = (day, hh, mm = 0) => { const d = new Date(`${day}T00:00:00`); d.setHours(hh, mm, 0, 0); return d; };

test("Every takes an interval or a clock rule, and refuses anything else by name", () => {
  assert.deepEqual(parseEvery("3h"), { kind: "interval", ms: 3 * 3600e3 });
  assert.deepEqual(parseEvery("45m"), { kind: "interval", ms: 45 * 60e3 });
  assert.deepEqual(parseEvery("2d"), { kind: "interval", ms: 2 * 86400e3 });
  assert.deepEqual(parseEvery("daily 07:00"), { kind: "clock", days: [0, 1, 2, 3, 4, 5, 6], hh: 7, mm: 0 });
  assert.deepEqual(parseEvery("weekdays 8:30"), { kind: "clock", days: [1, 2, 3, 4, 5], hh: 8, mm: 30 });
  assert.deepEqual(parseEvery("weekends 10:00"), { kind: "clock", days: [0, 6], hh: 10, mm: 0 });
  assert.deepEqual(parseEvery("Mon, Thu 18:00"), { kind: "clock", days: [1, 4], hh: 18, mm: 0 });
  for (const bad of ["2m", "4m", "sometimes", "monday", "monday 25:00", "monday 09:60", "funday 09:00", ""]) assert.throws(() => parseEvery(bad), /Every/, bad);
});

test("At is a local minute; anything else is refused", () => {
  assert.equal(parseAt("2026-10-18 15:00").getTime(), at("2026-10-18", 15).getTime());
  for (const bad of ["tomorrow 3pm", "2026-10-18", "2026-10-18 25:00", ""]) assert.throws(() => parseAt(bad), /At/, bad);
});

test("a clock rule's last occurrence is the most recent one at or before now", () => {
  const rule = parseEvery("weekdays 08:30");
  assert.equal(lastOccurrence(rule, at("2026-10-17", 12)).getTime(), at("2026-10-16", 8, 30).getTime(), "Saturday: Friday's");
  assert.equal(lastOccurrence(rule, at("2026-10-19", 8, 29)).getTime(), at("2026-10-16", 8, 30).getTime());
  assert.equal(lastOccurrence(rule, at("2026-10-19", 8, 30)).getTime(), at("2026-10-19", 8, 30).getTime(), "at the minute itself");
});

test("a window: inside, outside, wrapping midnight, the end exclusive, none meaning always", () => {
  const w = parseWindow("01:00-05:00");
  assert.deepEqual(w, { start: "01:00", end: "05:00" });
  assert.equal(inWindow(w, at("2026-10-17", 2)), true);
  assert.equal(inWindow(w, at("2026-10-17", 5)), false);
  const wrap = parseWindow("23:00-02:00");
  assert.equal(inWindow(wrap, at("2026-10-17", 23, 30)), true);
  assert.equal(inWindow(wrap, at("2026-10-17", 1)), true);
  assert.equal(inWindow(wrap, at("2026-10-17", 12)), false);
  assert.equal(inWindow(null, at("2026-10-17", 12)), true);
  assert.equal(parseWindow("overnight"), null);
  assert.equal(parseWindow("05:00-05:00"), null);
});
