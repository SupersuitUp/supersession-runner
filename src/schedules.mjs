// SCHEDULE FILES: one Markdown file per schedule, readable and editable by a person.
//
//   # Draft the investor update
//
//   **At:** 2026-10-18 15:00              one time, local
//   **Every:** 3h | daily 07:00 | weekdays 08:30 | monday 09:00 | mon, thu 18:00
//   **On:** <event name>                  once per event
//   **Gate:** <shell command>             optional: exit 0 = work (its first line is handed over), 1 = nothing to do
//   **Project:** <name>                   optional: a project the session opens on (what that means is the host's)
//   **Method:** /command or words         or a `## Briefing` section for words that need more than a line
//   **Arguments:** <passed to the command>
//   **Window:** 08:00-22:00               optional
//   **Stamp:** <name>                     optional: a gate that says nothing stamps this (the host decides what)
//   **Status:** active | paused | done
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseAt, parseEvery, lastOccurrence, parseWindow, inWindow, localDay } from "./when.mjs";
import { readLabels, setLabel, labelLine } from "./labels.mjs";
import { EVENT_NAME } from "./events.mjs";

export const STATUSES = ["active", "paused", "done"];

/** The default reading of a Method: a slash command with no spaces is a command, anything else is words. */
export function classifyMethod(method, args) {
  const m = String(method).trim();
  if (/^\/\S+$/.test(m)) return { kind: "command", command: args ? `${m} ${args}` : m, arguments: args || null, prompt: null };
  return { kind: "prompt", command: null, arguments: null, prompt: m };
}

/** One schedule from its file's text. Throws, naming what is wrong. */
export function shapeSchedule(slug, file, text, { classify = classifyMethod } = {}) {
  const l = readLabels(text);
  const name = (String(text).match(/^#\s+(.+)$/m) || [])[1]?.trim() || slug;
  const at = l.at ? parseAt(l.at) : null;
  const every = l.every ? parseEvery(l.every) : null;
  const on = l.on ? String(l.on).trim().toLowerCase() : null;
  if (on && !EVENT_NAME.test(on)) throw new Error(`On: ${l.on} is not an event name (lowercase words joined by hyphens)`);
  if (!at && !every && !on) throw new Error("it has no At, Every or On line, so nothing says when it runs");
  const brief = (String(text).match(/^##\s+Briefing\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m) || [])[1]?.trim() || null;
  const method = l.method || brief;
  if (!method) throw new Error("it has no Method line or Briefing section, so nothing says what it does");
  return {
    slug, id: `schedule:${slug}`, name, dir: file, source: "schedules",
    at, every, everyText: l.every || null, on,
    gate: l.gate || null, project: l.project || null, stamp: l.stamp || null,
    method, ...classify(method, l.arguments || null),
    window: l.window ? parseWindow(l.window) : null,
    status: (l.status || "active").toLowerCase(),
  };
}

/** Every schedule in a folder, by file name. Unreadable files are skipped and named in `.problems`. */
export function readSchedules(dir, { classify } = {}) {
  const out = [], problems = [];
  if (dir && existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".md") || f === "README.md") continue;
      const file = join(dir, f);
      try {
        if (!statSync(file).isFile()) continue;
        out.push({ ...shapeSchedule(basename(f, ".md"), file, readFileSync(file, "utf8"), { classify }), since: statSync(file).mtime });
      } catch (e) { problems.push({ slug: basename(f, ".md"), dir: file, why: e.message }); }
    }
  }
  Object.defineProperty(out, "problems", { value: problems, enumerable: false });
  return out;
}

/**
 * Is this schedule wanted now? `attempt` is what the runner last recorded for it ({ startedAt,
 * status, day, defers }); `hasEvent` says whether its event is waiting. Slots are the runner's.
 */
export function isDue(s, { now = new Date(), attempt = null, hasEvent = false, maxDefers = 3 } = {}) {
  if (s.status !== "active" || !inWindow(s.window, now)) return false;
  if (s.on) return hasEvent;
  const last = attempt?.startedAt ? new Date(attempt.startedAt) : null;
  // A clock rule never run waits for its first occurrence AFTER the file was written, so a new
  // "every Monday 09:00" made on a Sunday does not fire at once for last Monday.
  const base = last ?? (s.every?.kind === "clock" && s.since ? new Date(s.since) : null);
  // "Not now" retries at the next tick, maxDefers times a day, then waits for the next turn.
  const deferredToday = attempt?.status === "deferred" && attempt.day === localDay(now) && (attempt.defers || 0) < maxDefers;
  if (s.at) return now >= s.at && (!last || last < s.at || deferredToday);
  if (s.every.kind === "interval") return !last || now - last >= s.every.ms || deferredToday;
  const occ = lastOccurrence(s.every, now);
  return Boolean(occ) && (!base || base < occ || deferredToday);
}

/** Change one schedule's Status line in its own file. */
export function setScheduleStatus(s, status) {
  if (!STATUSES.includes(status)) throw new Error(`status must be active, paused or done (got ${status})`);
  writeFileSync(s.dir, setLabel(readFileSync(s.dir, "utf8"), "Status", status));
  return s.dir;
}

export function removeSchedule(s) { rmSync(s.dir, { force: true }); return s.dir; }

const slugify = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "schedule";

/** Write a new schedule file into `dir` and return its path. Validates by reading it back. */
export function addSchedule(dir, { name, slug, at, every, on, method, briefing, arguments: argv, project, gate, window, stamp } = {}, { classify } = {}) {
  if (!dir) throw new Error("no schedules folder given");
  if (!name || !String(name).trim()) throw new Error("a schedule needs a name");
  if (!at && !every && !on) throw new Error("a schedule needs an At or Every (or an On event): when should it run?");
  if ((!method || !String(method).trim()) && (!briefing || !String(briefing).trim())) throw new Error("a schedule needs a Method: what should the session do?");
  if (method && /\n/.test(String(method).trim())) { briefing = method; method = null; }
  if (at) parseAt(at);
  if (every) parseEvery(every);
  if (on && !EVENT_NAME.test(String(on))) throw new Error(`On: ${on} is not an event name (lowercase words joined by hyphens)`);
  if (window && !parseWindow(window)) throw new Error(`Window: ${window} is not HH:MM-HH:MM`);
  const s = slug || slugify(name);
  const file = join(dir, `${s}.md`);
  if (existsSync(file)) throw new Error(`a schedule named ${s} already exists (${file})`);
  const lines = [`# ${String(name).trim()}`, "",
    ...(at ? [labelLine("At", at)] : []), ...(every ? [labelLine("Every", every)] : []), ...(on ? [labelLine("On", on)] : []),
    ...(window ? [labelLine("Window", window)] : []), ...(gate ? [labelLine("Gate", gate)] : []),
    ...(project ? [labelLine("Project", project)] : []), ...(method ? [labelLine("Method", String(method).trim())] : []),
    ...(argv ? [labelLine("Arguments", argv)] : []), ...(stamp ? [labelLine("Stamp", stamp)] : []),
    labelLine("Status", "active"), "",
    ...(briefing ? ["## Briefing", "", String(briefing).trim(), ""] : [])];
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, lines.join("\n"));
  try { shapeSchedule(s, file, readFileSync(file, "utf8"), { classify }); } catch (e) { rmSync(file, { force: true }); throw e; }
  return file;
}
