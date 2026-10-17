import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSchedules, isDue, addSchedule, setScheduleStatus, removeSchedule, setLabel, readLabels, classifyMethod } from "../src/index.mjs";

const at = (day, hh, mm = 0) => { const d = new Date(`${day}T00:00:00`); d.setHours(hh, mm, 0, 0); return d; };
const dir = () => mkdtempSync(join(tmpdir(), "supersessions-"));

test("a schedule file reads into a job; an unreadable one is named in problems, never the whole list", () => {
  const d = dir();
  writeFileSync(join(d, "good.md"), "# Good\n\n**At:** 2026-10-18 15:00\n**Method:** Do it.\n");
  writeFileSync(join(d, "cmd.md"), "# Cmd\n\n**Every:** monday 09:00\n**Method:** /review\n**Arguments:** this week\n");
  writeFileSync(join(d, "brief.md"), "# Brief\n\n**On:** pr-opened\n\n## Briefing\n\nLine one.\nLine two.\n");
  writeFileSync(join(d, "broken.md"), "# Broken\n\n**Every:** whenever\n**Method:** x\n");
  writeFileSync(join(d, "nowhen.md"), "# No when\n\n**Method:** x\n");
  writeFileSync(join(d, "README.md"), "# not a schedule\n");
  const list = readSchedules(d);
  assert.deepEqual(list.map((s) => s.slug), ["brief", "cmd", "good"]);
  assert.deepEqual(list.problems.map((p) => p.slug).sort(), ["broken", "nowhen"]);
  const [brief, cmd, good] = list;
  assert.equal(good.id, "schedule:good");
  assert.equal(good.kind, "prompt");
  assert.equal(cmd.kind, "command");
  assert.equal(cmd.command, "/review this week");
  assert.equal(brief.on, "pr-opened");
  assert.equal(brief.prompt, "Line one.\nLine two.");
  rmSync(d, { recursive: true, force: true });
});

test("a host can read Methods its own way", () => {
  const d = dir();
  writeFileSync(join(d, "a.md"), "# A\n\n**Every:** 3h\n**Method:** freedom:audit-my-week\n");
  const [a] = readSchedules(d, { classify: (m) => ({ kind: "superskill", command: `/${m}`, arguments: null, prompt: null }) });
  assert.equal(a.kind, "superskill");
  assert.equal(a.command, "/freedom:audit-my-week");
  assert.equal(classifyMethod("Draft it").kind, "prompt");
  rmSync(d, { recursive: true, force: true });
});

test("due: a one-off once its time has come and never again; paused and done never", () => {
  const d = dir();
  writeFileSync(join(d, "a.md"), "# A\n\n**At:** 2026-10-18 15:00\n**Method:** x\n");
  const [a] = readSchedules(d);
  assert.equal(isDue(a, { now: at("2026-10-18", 14, 59) }), false);
  assert.equal(isDue(a, { now: at("2026-10-18", 15, 5) }), true);
  assert.equal(isDue(a, { now: at("2026-10-18", 16), attempt: { startedAt: at("2026-10-18", 15, 5).toISOString(), status: "ok" } }), false);
  assert.equal(isDue({ ...a, status: "paused" }, { now: at("2026-10-18", 16) }), false);
  assert.equal(isDue({ ...a, status: "done" }, { now: at("2026-10-18", 16) }), false);
  rmSync(d, { recursive: true, force: true });
});

test("due: an interval from its last start; a clock rule once per occurrence, and not for one before it existed", () => {
  const d = dir();
  writeFileSync(join(d, "iv.md"), "# Iv\n\n**Every:** 3h\n**Method:** x\n");
  writeFileSync(join(d, "mon.md"), "# Mon\n\n**Every:** monday 09:00\n**Method:** x\n");
  utimesSync(join(d, "mon.md"), at("2026-10-17", 12), at("2026-10-17", 12));
  const [iv, mon] = readSchedules(d);
  const started = (t) => ({ startedAt: t.toISOString(), status: "started" });
  assert.equal(isDue(iv, { now: at("2026-10-18", 9) }), true, "never run: due");
  assert.equal(isDue(iv, { now: at("2026-10-18", 11), attempt: started(at("2026-10-18", 9)) }), false);
  assert.equal(isDue(iv, { now: at("2026-10-18", 12), attempt: started(at("2026-10-18", 9)) }), true);
  assert.equal(isDue(mon, { now: at("2026-10-18", 10) }), false, "last Monday was before the file existed");
  assert.equal(isDue(mon, { now: at("2026-10-19", 9, 5) }), true);
  assert.equal(isDue(mon, { now: at("2026-10-19", 10), attempt: started(at("2026-10-19", 9, 5)) }), false);
  assert.equal(isDue(mon, { now: at("2026-10-26", 9), attempt: started(at("2026-10-19", 9, 5)) }), true);
  rmSync(d, { recursive: true, force: true });
});

test("due: 'not now' retries the same day, up to the limit; an event job only when its event waits; a window holds", () => {
  const d = dir();
  writeFileSync(join(d, "a.md"), "# A\n\n**At:** 2026-10-18 15:00\n**Window:** 15:00-16:00\n**Method:** x\n");
  writeFileSync(join(d, "e.md"), "# E\n\n**On:** pr-opened\n**Method:** x\n");
  const [a, e] = readSchedules(d);
  const def = (n) => ({ startedAt: at("2026-10-18", 15, 5).toISOString(), status: "deferred", day: "2026-10-18", defers: n });
  assert.equal(isDue(a, { now: at("2026-10-18", 15, 20), attempt: def(2) }), true);
  assert.equal(isDue(a, { now: at("2026-10-18", 15, 20), attempt: def(3) }), false);
  assert.equal(isDue(a, { now: at("2026-10-18", 16, 5) }), false, "outside its window");
  assert.equal(isDue(e, { now: at("2026-10-18", 9) }), false);
  assert.equal(isDue(e, { now: at("2026-10-18", 9), hasEvent: true }), true);
  rmSync(d, { recursive: true, force: true });
});

test("add writes a file that reads back; it refuses a duplicate, a missing when or what, a bad rule; status and remove touch only that file", () => {
  const d = dir();
  const f = addSchedule(d, { name: "Investor update", at: "2026-10-18 15:00", method: "Draft it." });
  assert.equal(f, join(d, "investor-update.md"));
  assert.throws(() => addSchedule(d, { name: "Investor update", at: "2026-10-18 15:00", method: "x" }), /already/);
  assert.throws(() => addSchedule(d, { name: "No when", method: "x" }), /At or Every/);
  assert.throws(() => addSchedule(d, { name: "No what", every: "3h" }), /Method/);
  assert.throws(() => addSchedule(d, { name: "Bad", every: "sometimes", method: "x" }), /Every/);
  assert.throws(() => addSchedule(d, { name: "Bad on", on: "Not An Event", method: "x" }), /event name/);
  const multi = addSchedule(d, { name: "Multi", every: "3h", method: "one\ntwo" });
  assert.match(readFileSync(multi, "utf8"), /## Briefing\n\none\ntwo/);
  let [s] = readSchedules(d).filter((x) => x.slug === "investor-update");
  setScheduleStatus(s, "paused");
  [s] = readSchedules(d).filter((x) => x.slug === "investor-update");
  assert.equal(s.status, "paused");
  assert.throws(() => setScheduleStatus(s, "gone"), /status/);
  removeSchedule(s);
  assert.deepEqual(readSchedules(d).map((x) => x.slug), ["multi"]);
  rmSync(d, { recursive: true, force: true });
});

test("setLabel replaces a label where it is, or adds it after the header's last label, never inside a section", () => {
  const t = "# T\n\n**At:** x\n**Status:** active\n\n## Briefing\n\n**Status:** not a label\n";
  const a = setLabel(t, "Status", "done");
  assert.equal(readLabels(a).status, "done");
  assert.match(a, /## Briefing\n\n\*\*Status:\*\* not a label/);
  const b = setLabel("# T\n\n**At:** x\n\nbody\n", "Status", "paused");
  assert.match(b, /\*\*At:\*\* x\n\*\*Status:\*\* paused\n\nbody/);
});
