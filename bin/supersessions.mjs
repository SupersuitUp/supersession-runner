#!/usr/bin/env node
// supersessions: the schedule files and events, from a terminal. Starting sessions is the host's
// (it knows how to open one); this reads, writes and checks what the runner will act on.
//
//   supersessions list   [--dir schedules] [--json]
//   supersessions due    [--dir schedules] [--json]          what would start now (ignoring slots and history)
//   supersessions add    --name "<name>" (--at "YYYY-MM-DD HH:MM" | --every "<rule>" | --on <event>)
//                        (--method "<command or words>") [--arguments ..] [--gate ..] [--window HH:MM-HH:MM] [--project ..]
//   supersessions pause|resume|remove <slug>
//   supersessions emit   <event> [--data '<json>'] [--events .supersessions/events]
//
// Exit 0 done, 1 nothing matched, 2 refused (the reason is printed).
import { readSchedules, addSchedule, setScheduleStatus, removeSchedule, isDue, createEvents } from "../src/index.mjs";

const args = process.argv.slice(2);
const [cmd, ...rest] = args;
const json = args.includes("--json");
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dir = flag("--dir") || "schedules";
const events = createEvents(flag("--events") || ".supersessions/events");
const say = (obj, line) => console.log(json ? JSON.stringify(obj) : line);
const when = (s) => (s.at ? `at ${s.at.toLocaleString()}` : s.on ? `on ${s.on}` : `every ${s.everyText}`);
const find = (slug) => {
  const s = readSchedules(dir).find((x) => x.slug === slug || x.id === slug);
  if (!s) throw new Error(`no schedule named ${slug} in ${dir}`);
  return s;
};

try {
  if (cmd === "list" || !cmd) {
    const list = readSchedules(dir);
    say({ schedules: list, problems: list.problems }, list.length ? list.map((s) => `${s.status.padEnd(6)}  ${s.slug}  ${when(s)}`).join("\n") : "no schedules.");
    for (const p of list.problems) console.error(`  unreadable: ${p.dir}: ${p.why}`);
  } else if (cmd === "due") {
    const due = readSchedules(dir).filter((s) => isDue(s, { hasEvent: s.on ? events.pending(s.on).length > 0 : false }));
    say({ due: due.map((s) => s.id) }, due.length ? due.map((s) => `${s.slug}  ${when(s)}`).join("\n") : "nothing due.");
    if (!due.length) process.exitCode = 1;
  } else if (cmd === "add") {
    const f = addSchedule(dir, { name: flag("--name"), slug: flag("--slug"), at: flag("--at"), every: flag("--every"), on: flag("--on"), method: flag("--method"),
      arguments: flag("--arguments"), gate: flag("--gate"), window: flag("--window"), project: flag("--project") });
    say({ ok: true, file: f }, `scheduled: ${f}`);
  } else if (cmd === "pause" || cmd === "resume") {
    const f = setScheduleStatus(find(rest[0]), cmd === "pause" ? "paused" : "active");
    say({ ok: true, file: f }, `${cmd === "pause" ? "paused" : "resumed"}: ${f}`);
  } else if (cmd === "remove") {
    say({ ok: true, file: removeSchedule(find(rest[0])) }, `removed ${rest[0]}`);
  } else if (cmd === "emit") {
    let data = {};
    if (flag("--data")) { try { data = JSON.parse(flag("--data")); } catch { throw new Error("--data must be JSON"); } }
    say({ ok: true, file: events.emit(rest[0], data) }, `emitted ${rest[0]}`);
  } else {
    console.error("usage: supersessions list|due|add|pause|resume|remove|emit ... (see the header)");
    process.exitCode = 2;
  }
} catch (e) { console.error(`supersessions: ${e.message}`); process.exitCode = 2; }
