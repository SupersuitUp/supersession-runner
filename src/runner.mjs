// THE RUNNER: one tick fills free session slots from the jobs that are due, and one report per
// session frees its slot. Everything that touches the machine is passed in, so the runner is the
// same whether a launchd agent, cron, a CI job or a test calls it.
//
//   const r = createRunner({ inflightFile, jobs, start, message, attempts, ... })
//   r.tick({ now })            starts up to maxSessions sessions in all
//   r.tick({ now, only: id })  starts that one job now, whatever its time (still never twice)
//   r.done({ id, status })     the session's report: ok | deferred | failed
//
// A job is { id, kind, name, gate?, on?, at?, stamp?, ... } and the host's own fields. `jobs({ now })`
// returns { due, all }: what should run now, and every job (for `only` and `done` to find).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import { spawnSync } from "node:child_process";

export const MAX_SESSIONS = 3;
export const STALE_MS = 6 * 60 * 60 * 1000;
export const REPORT_STATUSES = ["ok", "deferred", "failed"];

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

/**
 * How long a gate may run. It was a minute until 2026-10-25, and a triage gate reading 23 repos
 * took 64 seconds, so it was killed on tick after tick and passed only when the network was quick
 * (supersuit-dev#1052). A tick comes every few minutes and the runner holds its lock meanwhile,
 * so five minutes is room for a slow scan without letting one wedge the queue for long.
 */
export const GATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A gate run through /bin/sh from `cwd`. { code, out, err, timedOut?, timeoutMs? }
 *
 * The directory of the node running this is put first on the gate's PATH, so `node` in a gate is
 * the same node, under a scheduler's minimal PATH (launchd, cron) as at a terminal.
 *
 * A gate killed at its limit has no exit status. That used to be reported as 127, "command not
 * found", which sent the reader looking for a missing binary when the gate was only slow. It is
 * now 124 (what timeout(1) exits) with `timedOut: true`; a spawn that could not start at all
 * (no /bin/sh) is still 127.
 */
export function shellGate({ command, cwd, env = process.env, timeoutMs = GATE_TIMEOUT_MS }) {
  const PATH = [dirname(process.execPath), env.PATH].filter(Boolean).join(delimiter);
  const r = spawnSync("/bin/sh", ["-c", command], { cwd, encoding: "utf8", timeout: timeoutMs, env: { ...env, PATH } });
  const out = String(r.stdout || ""), err = String(r.stderr || "");
  if (r.error?.code === "ETIMEDOUT" || (r.status === null && r.signal && r.error)) return { code: 124, out, err, timedOut: true, timeoutMs };
  return { code: r.status ?? (r.error ? 127 : 1), out, err: err || (r.error ? String(r.error.message || r.error) : "") };
}

/** The last non-empty lines of a gate's stderr, as one quotable line for a log. */
export function stderrTail(err, max = 240) {
  const lines = String(err || "").split("\n").map((l) => l.trim()).filter(Boolean);
  let tail = lines.slice(-3).join(" | ").replace(/"/g, "'");
  if (tail.length > max) tail = "..." + tail.slice(-(max - 3));
  return tail;
}

const noop = () => {};
const freeLock = { acquire: () => ({ acquired: true }), release: noop };

/**
 * @param {object} o
 * @param {string} o.inflightFile        where the sessions in flight are kept
 * @param {Function} o.jobs              ({ now }) => { due: Job[], all: Job[] }
 * @param {Function} o.start             ({ job, name, prompt }) => { ok, id } | { ok: false, reason }
 * @param {Function} o.message           (job, { extra }) => { name, message }
 * @param {object} [o.attempts]          { mark(job, now, status) }: what happened, for the job's own "is it due"
 * @param {object} [o.events]            createEvents(dir): for jobs with `on`
 * @param {Function} [o.gate]            ({ command, job }) => { code, out }
 * @param {Function} [o.notify]          (event) => void: one notice when a run fails or goes silent
 * @param {Function} [o.log]             (line) => void
 * @param {Function} [o.onNothing]       (job, now): its gate said there was nothing to do
 * @param {Function} [o.onReport]        (job, status, now): after a report is recorded
 * @param {Function} [o.migrate]         (sessions) => sessions: fold in an older in-flight record
 */
export function createRunner({
  inflightFile, jobs, start, message, attempts = { mark: noop }, events = null, gate = null,
  notify = noop, log = noop, onNothing = noop, onReport = noop, migrate = (s) => s,
  lock = freeLock, maxSessions = MAX_SESSIONS, staleMs = STALE_MS, noun = (job) => job.kind,
} = {}) {
  const load = () => {
    const cur = readJson(inflightFile);
    const before = Array.isArray(cur?.sessions) ? cur.sessions : [];
    const after = migrate(before.slice());
    if (after.length !== before.length) save(after);
    return after;
  };
  const save = (sessions) => {
    mkdirSync(dirname(inflightFile), { recursive: true });
    writeFileSync(inflightFile, JSON.stringify({ sessions }, null, 2) + "\n");
  };
  const tell = (ev) => { try { const p = notify(ev); if (p && typeof p.catch === "function") p.catch(noop); } catch { /* the log still has it */ } };

  function startJob(job, now) {
    let extra = "";
    if (job.gate && gate) {
      let g;
      try { g = gate({ command: job.gate, job }) || { code: 1, out: "" }; } catch (e) { g = { code: 127, out: e?.message || "" }; }
      if (g.code === 1) {
        attempts.mark(job, now, "nothing");
        onNothing(job, now);
        log(`slug=${job.id} status=nothing gate=empty`);
        return { id: job.id, slug: job.slug, status: "nothing" };
      }
      if (g.code !== 0) {
        // Say what broke: a timeout is not a missing command, and the gate's own last words
        // (stderr) name the missing thing when one is missing (supersuit-dev#1052).
        const secs = g.timedOut ? `${Math.round((g.timeoutMs || GATE_TIMEOUT_MS) / 1000)}s` : "";
        const tail = stderrTail(g.err);
        log(`slug=${job.id} status=gate-error ${g.timedOut ? `exit=timeout after=${secs}` : `exit=${g.code}`}${tail ? ` stderr="${tail}"` : ""}`);
        const why = [g.timedOut ? `gate timed out after ${secs}` : `gate exit ${g.code}`, tail].filter(Boolean).join(": ");
        return { id: job.id, slug: job.slug, status: "gate-error", why };
      }
      const line = String(g.out || "").trim().split("\n")[0];
      if (line) extra = `The gate reported: ${line}`;
    }
    // An event-triggered job takes the OLDEST waiting event, consumed only once the session has
    // started, so a refused start leaves it for the next tick.
    const ev = job.on && events ? events.pending(job.on)[0] || null : null;
    if (ev) extra = [extra, `The event: ${ev.name} at ${ev.at}, with ${JSON.stringify(ev.data ?? {})}`].filter(Boolean).join("\n\n");
    const { name, message: prompt } = message(job, { extra });
    let res;
    try { res = start({ job, name, prompt }) || { ok: false, reason: "no answer" }; }
    catch (e) { res = { ok: false, reason: e?.message || String(e) }; }
    if (!res.ok) {
      log(`slug=${job.id} status=not-started why=${String(res.reason).replace(/\s+/g, " ")}`);
      return { id: job.id, slug: job.slug, status: "not-started", why: res.reason };
    }
    if (ev) events.consume(ev);
    attempts.mark(job, now, "started");
    log(`slug=${job.id} status=started session=${res.id}`);
    return { id: job.id, slug: job.slug, status: "started", session: res.id };
  }

  function tick({ now = new Date(), only = null, pid = process.pid } = {}) {
    const got = lock.acquire({ pid });
    if (!got?.acquired) return { skipped: "locked", runs: [] };
    try {
      let inflight = load();
      for (const x of inflight.filter((e) => now - new Date(e.startedAt) >= staleMs)) {
        attempts.mark(x, now, "failed");
        log(`slug=${x.id} status=stale session=${x.session}`);
        tell({
          kind: "job-failed", key: `recurrent-failed:${x.id}`,
          title: `The ${noun(x)} "${x.name}" never reported back`,
          body: `Its session (${x.session}) started ${x.startedAt} and did not finish within ${staleMs / 3600000} hours. Open it to see where it stopped. It tries again at its next turn.`,
        });
      }
      const fresh = inflight.filter((e) => now - new Date(e.startedAt) < staleMs);
      if (fresh.length !== inflight.length) save(fresh);
      inflight = fresh;
      const busy = new Set(inflight.map((e) => e.id));

      let set;
      try { set = jobs({ now }); } catch (e) { log(`BROKEN: could not read the jobs: ${e.message}`); return { skipped: "unreadable", runs: [] }; }
      let list;
      if (only) {
        const j = set.all.find((x) => x.id === only);
        if (!j) throw new Error(`no job named ${only}`);
        if (busy.has(j.id)) return { skipped: "that one is already running", runs: [] };
        list = [j];
      } else list = set.due.filter((j) => !busy.has(j.id));
      if (!list.length) return { runs: [] };
      if (inflight.length >= maxSessions) return { skipped: "every session slot is in use", runs: [], inflight };

      const runs = [];
      for (const j of list) {
        if (inflight.length >= maxSessions) break;
        const out = startJob(j, now);
        runs.push(out);
        if (out.status === "started") {
          inflight.push({ id: j.id, kind: j.kind, name: j.name, marker: j.marker ?? null, session: out.session, startedAt: now.toISOString() });
          save(inflight);
        }
      }
      return { runs };
    } finally {
      try { lock.release({ pid }); } catch { /* a dead holder's lock is stale on the next read */ }
    }
  }

  /** The session's report. Throws on an unknown status or job, so a mistyped report is found at once. */
  function done({ id, status, why = "", now = new Date() } = {}) {
    if (!REPORT_STATUSES.includes(status)) throw new Error(`--status must be ok, deferred or failed (got ${status ?? "nothing"})`);
    const job = jobs({ now }).all.find((x) => x.id === id);
    if (!job) throw new Error(`no job named ${id}`);
    attempts.mark(job, now, status);
    onReport(job, status, now);
    const inflight = load();
    if (inflight.some((x) => x.id === id)) save(inflight.filter((x) => x.id !== id));
    log(`slug=${id} status=${status}${why ? ` why=${String(why).replace(/\s+/g, " ")}` : ""}`);
    if (status === "failed") {
      tell({
        kind: "job-failed", key: `recurrent-failed:${id}`,
        title: `The ${noun(job)} "${job.name}" failed`,
        body: `${why || "Its session could not get it green."} Open it for the whole run.${job.at ? "" : " It tries again at its next turn."}`,
      });
    }
    return { id, status };
  }

  return { tick, done, inflight: () => load(), clear: () => existsSync(inflightFile) && rmSync(inflightFile, { force: true }) };
}
