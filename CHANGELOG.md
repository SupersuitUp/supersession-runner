# Changelog

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
