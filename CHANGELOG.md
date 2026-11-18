# Changelog

## 0.3.0 (2026-11-17)

- Monthly rules for Every: a day of the month (`monthly 5 09:00`, `on the 5th 09:00`, `the 15th of
  every month at 17:30`), the last day (`last day of the month 18:00`), a deadline (`by the 5th
  09:00`: it runs on the 1st, and a schedule written before the 5th that never ran is owed at once),
  and an nth weekday (`second thursday 09:00`, `last friday 16:00`). A day past the month's end runs
  on its last day, so the 31st is February's 28th or 29th. They are read only when the words name a
  day number, `last`, `by` or an ordinal, which the clock grammar never took, so every phrase that
  parsed before parses the same (supersuit-dev#3187, #2413).
- `nextOccurrence(rule, after)`: the first run strictly after a time, for clock and monthly rules,
  so a host stops writing its own eight-day loop. `lastOccurrence` takes monthly rules.
- `describeEvery(rule)`: what a rule means in plain words ("on the second Thursday of every month at
  09:00"). `deadlineOf(rule, occurrence)`: the end of a "by" rule's deadline day.

## 0.2.2 (2026-11-14)

- A session that reports while a tick is starting another session stays reported. The tick held
  the in-flight list it read at its top and saved it after the start, which takes seconds, so a
  slot `done` had just freed came back and the finished run was told six hours later as "never
  reported back". Every write the tick makes now re-reads the list first.

## 0.2.1 (2026-10-25)

- `shellGate` gives a gate five minutes (`GATE_TIMEOUT_MS`), up from one. A gate killed at its
  limit is now exit 124 with `timedOut: true`, where it used to be reported as 127 ("command not
  found"), which sent the reader looking for a missing binary when the gate was only slow
  (supersuit-dev#1052: a triage gate reading 23 repos took 64 seconds).
- `shellGate` returns the gate's stderr as `err`, and the runner's `gate-error` log line carries
  its last lines (`stderr="..."`), with `exit=timeout after=300s` for a timeout.
- The directory of the node running the runner goes first on a gate's PATH, so `node` in a gate
  resolves under a scheduler's minimal PATH. `shellGate` takes `env` and `timeoutMs`.

## 0.2.0 (2026-10-19)

- `contractMessage` takes `close`: a fifth step telling the session how to end itself after it
  reports, and step 4 then reads "Report exactly once, then close". Without it the message is
  unchanged. A finished session nobody watches should not stay open.

## 0.1.0 (2026-10-17)

- First release, extracted from Supersuit's own session runner (freedom-dev, where it runs every
  scheduled Pluma session). Triggers: At, Every (interval or clock rule), On (events), with a
  gate, an hours window, and up to `maxSessions` (3) at once. Schedule files, events, the run
  contract (`contractMessage`), the runner (`createRunner`) with every machine call injected, and
  the `supersessions` CLI.
