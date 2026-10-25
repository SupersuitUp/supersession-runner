# Changelog

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
