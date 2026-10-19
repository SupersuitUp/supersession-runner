import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, createEvents, contractMessage, MAX_SESSIONS, STALE_MS } from "../src/index.mjs";

const at = (day, hh, mm = 0) => { const d = new Date(`${day}T00:00:00`); d.setHours(hh, mm, 0, 0); return d; };

function harness({ due = [], gateAnswer = () => ({ code: 0, out: "" }), startOk = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "supersessions-run-"));
  const calls = { start: [], notify: [], marks: [], log: [], reports: [] };
  const state = { due };
  const events = createEvents(join(dir, "events"));
  const r = createRunner({
    inflightFile: join(dir, "inflight.json"),
    jobs: () => ({ due: state.due, all: [...state.due, ...(state.extra || [])] }),
    start: (o) => { calls.start.push(o); return startOk ? { ok: true, id: `s${calls.start.length}` } : { ok: false, reason: "paused" }; },
    message: (job, { extra }) => ({ name: `Run: ${job.name}`, message: [`do ${job.id}`, extra].filter(Boolean).join("\n") }),
    attempts: { mark: (job, now, status) => calls.marks.push([job.id, status]) },
    events, gate: (o) => gateAnswer(o),
    notify: (ev) => calls.notify.push(ev), log: (l) => calls.log.push(l),
    onReport: (job, status) => calls.reports.push([job.id, status]),
  });
  return { r, calls, state, events, dir };
}
const job = (id, extra = {}) => ({ id, kind: "schedule", name: id.toUpperCase(), ...extra });

test(`fills up to ${3} slots, never the same job twice, and the next waits for a report`, () => {
  assert.equal(MAX_SESSIONS, 3);
  const h = harness({ due: ["a", "b", "c", "d"].map((x) => job(x)) });
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 9) }).runs.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(h.r.tick({ now: at("2026-10-18", 9, 15) }).skipped, "every session slot is in use");
  h.r.done({ id: "b", status: "ok", now: at("2026-10-18", 9, 30) });
  h.state.due = ["a", "c", "d"].map((x) => job(x));   // b ran, so the host no longer calls it due
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 9, 45) }).runs.map((x) => x.id), ["d"], "a and c are still running; d takes b's slot");
  assert.deepEqual(h.calls.reports, [["b", "ok"]]);
});

test("a gate that says nothing starts nothing; one that says work hands over its first line; one that errors is logged, never told", () => {
  let answer = { code: 1, out: "" };
  const h = harness({ due: [job("q", { gate: "check" })], gateAnswer: () => answer });
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 9) }).runs.map((x) => x.status), ["nothing"]);
  assert.deepEqual(h.calls.marks.at(-1), ["q", "nothing"]);
  answer = { code: 0, out: "3 waiting\nmore" };
  h.r.tick({ now: at("2026-10-18", 10) });
  assert.match(h.calls.start[0].prompt, /The gate reported: 3 waiting$/);
  h.r.done({ id: "q", status: "ok" });
  answer = { code: 2, out: "" };
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 11) }).runs.map((x) => x.status), ["gate-error"]);
  assert.equal(h.calls.notify.length, 0);
});

test("an event job takes the oldest event, consumes it only once its session starts, and leaves others alone", () => {
  const h = harness({ due: [job("pr", { on: "pr-opened" })], startOk: false });
  h.events.emit("pr-opened", { n: 1 }, { now: at("2026-10-18", 9) });
  h.events.emit("pr-opened", { n: 2 }, { now: at("2026-10-18", 9, 1) });
  h.events.emit("other", {}, { now: at("2026-10-18", 9) });
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 9, 5) }).runs.map((x) => x.status), ["not-started"]);
  assert.equal(h.events.pending("pr-opened").length, 2, "a refused start consumes nothing");
  const ok = harness({ due: [job("pr", { on: "pr-opened" })] });
  ok.events.emit("pr-opened", { n: 1 }, { now: at("2026-10-18", 9) });
  ok.events.emit("pr-opened", { n: 2 }, { now: at("2026-10-18", 9, 1) });
  ok.events.emit("other", {}, { now: at("2026-10-18", 9) });
  ok.r.tick({ now: at("2026-10-18", 9, 5) });
  assert.match(ok.calls.start[0].prompt, /"n":1/);
  assert.deepEqual(ok.events.pending("pr-opened").map((e) => e.data.n), [2]);
  assert.equal(ok.events.pending("other").length, 1);
  assert.throws(() => ok.events.emit("../etc", {}), /event name/);
});

test("a session silent past the limit is given up on with one notice, and its slot is free", () => {
  assert.equal(STALE_MS, 6 * 3600e3);
  const h = harness({ due: [job("a")] });
  h.r.tick({ now: at("2026-10-18", 1) });
  h.state.due = [job("b")];
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 6, 59) }).runs.map((x) => x.id), ["b"]);
  h.state.due = [job("c")];
  h.r.tick({ now: at("2026-10-18", 7, 1) });
  assert.equal(h.calls.notify.length, 1);
  assert.match(h.calls.notify[0].title, /"A" never reported back/);
  assert.deepEqual(JSON.parse(readFileSync(join(h.dir, "inflight.json"), "utf8")).sessions.map((s) => s.id), ["b", "c"]);
});

test("only starts one job now whatever its time, still never twice; an unknown one is an error", () => {
  const h = harness();
  h.state.extra = [job("later")];
  assert.deepEqual(h.r.tick({ now: at("2026-10-18", 9), only: "later" }).runs.map((x) => x.status), ["started"]);
  assert.equal(h.r.tick({ now: at("2026-10-18", 9), only: "later" }).skipped, "that one is already running");
  assert.throws(() => h.r.tick({ only: "nope" }), /no job named nope/);
});

test("done: failed tells the operator once; an unknown status or job is refused", () => {
  const h = harness({ due: [job("a")] });
  h.r.tick({ now: at("2026-10-18", 9) });
  h.r.done({ id: "a", status: "failed", why: "the numbers are missing" });
  assert.equal(h.calls.notify.length, 1);
  assert.match(h.calls.notify[0].body, /numbers are missing/);
  assert.throws(() => h.r.done({ id: "a", status: "green" }), /ok, deferred or failed/);
  assert.throws(() => h.r.done({ id: "zz", status: "ok" }), /no job named zz/);
});

test("a locked tick starts nothing; an older in-flight record can be folded in", () => {
  const dir = mkdtempSync(join(tmpdir(), "supersessions-lock-"));
  const base = { inflightFile: join(dir, "i.json"), jobs: () => ({ due: [job("a")], all: [job("a")] }), start: () => ({ ok: true, id: "x" }), message: () => ({ name: "n", message: "m" }) };
  assert.equal(createRunner({ ...base, lock: { acquire: () => ({ acquired: false }), release: () => {} } }).tick().skipped, "locked");
  writeFileSync(join(dir, "i.json"), JSON.stringify({ sessions: [] }));
  const r = createRunner({ ...base, maxSessions: 1, migrate: (s) => [...s, { id: "old", name: "Old", session: "o1", startedAt: new Date().toISOString() }] });
  assert.equal(r.tick().skipped, "every session slot is in use", "the folded-in session holds the only slot");
});

test("the contract: run, solve, improve, report once; the host may name its own skills", () => {
  const m = contractMessage({ what: "the scheduled session \"X\"", job: { prompt: "Draft it." }, report: "report-cmd x --status ok|deferred|failed", file: "/w/x.md", root: "/w", extra: "The gate reported: 3" });
  assert.match(m, /^This is the scheduled session "X"\. The session runner started this session/);
  assert.match(m, /1\. Run it\. Its method is these words[\s\S]*Draft it\.\n\nThe gate reported: 3\n\n2\. If it failed, solve it/);
  assert.match(m, /3\. Before you finish, improve it\.[\s\S]*its file \(\/w\/x\.md\)/);
  assert.match(m, /4\. Report exactly once[\s\S]*report-cmd x --status ok\|deferred\|failed/);
  const own = contractMessage({ what: "w", job: { command: "/review", arguments: "a" }, report: "r", root: "/w", solve: "2. Use my-debugger.", improve: () => "3. Use my-improver." });
  assert.match(own, /Run \/review \(pass the superskill exactly these arguments: a\)/);
  assert.match(own, /2\. Use my-debugger\.\n\n3\. Use my-improver\./);
  assert.match(contractMessage({ what: "w", job: { unattended: "sh x.sh" }, report: "r", root: "/w" }), /sh x\.sh[\s\S]*Exit 75 means "not now"/);
});

// A finished session nobody is watching should not stay open: three finished runs of one
// recurrent sat idle on one Mac on 2026-10-19 until the operator said "This recurrent should close".
test("the contract: a host's close step comes after the report, and only when it gives one", () => {
  const plain = contractMessage({ what: "w", job: { prompt: "p" }, report: "r", root: "/w" });
  assert.match(plain, /4\. Report exactly once, as your last step, then stop:/);
  assert.doesNotMatch(plain, /\n\n5\./);
  const closing = contractMessage({ what: "w", job: { prompt: "p" }, report: "r", root: "/w", close: "Close this session with my-closer." });
  assert.match(closing, /4\. Report exactly once, then close:\n\n {4}r\n/);
  assert.doesNotMatch(closing, /as your last step, then stop/);
  assert.match(closing, /\n\n5\. Close this session with my-closer\.$/);
});
