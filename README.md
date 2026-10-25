# @supersuit/supersession-runner

Run agent sessions on their own: at a time, on a rhythm, or when something happens, a few at a
time, each keeping one contract. The runner decides **when** and **how many**; your host decides
**how a session starts** (Claude Code, another harness, anything that takes a prompt).

```bash
npm i @supersuit/supersession-runner
```

## A job, and the one contract it keeps

A job is a **trigger** (a time, an interval, a clock rule, or an event), an optional **gate** (a
cheap shell check: is there anything to do?), the **work** (a command or words), and **bounds**
(an hours window, and a slot out of a few). Every session the runner starts is told to:

1. **run the work,**
2. **solve what broke**, landing the fix and running again, leaving anything that reaches another
   person, spends money or cannot be undone for the operator,
3. **improve itself** before it finishes: the job's file, its script, or the skill it called,
4. **report exactly once**: ok, deferred ("not now"), or failed. Failed sends one notice. A session
   that never reports is given up on after six hours, with one notice.

## Schedule files

One Markdown file per job, in a folder a person can read and edit:

```markdown
# Draft the investor update

**At:** 2026-10-18 15:00              one time, local
**Every:** 3h | daily 07:00 | weekdays 08:30 | monday 09:00 | mon, thu 18:00
**On:** pull-request-opened           once per event
**Gate:** <shell command>             exit 0 = work (its first line is handed over), 1 = nothing to do
**Method:** /command or words         or a `## Briefing` section for more than one line
**Window:** 08:00-22:00
**Status:** active | paused | done
```

One of At, Every or On says when. A new clock rule waits for its first occurrence after the file
was written; a one-off is the host's to mark done once it reports.

## Running it

```js
import { createRunner, readSchedules, isDue, createEvents, contractMessage } from '@supersuit/supersession-runner'

const events = createEvents('.supersessions/events')
const attempts = new Map()                       // keep these on disk in a real host
const runner = createRunner({
  inflightFile: '.supersessions/inflight.json',
  maxSessions: 3,
  events,
  jobs: ({ now }) => {
    const all = readSchedules('schedules')
    const due = all.filter((s) => isDue(s, { now, attempt: attempts.get(s.id), hasEvent: s.on ? events.pending(s.on).length > 0 : false }))
    return { due, all }
  },
  attempts: { mark: (job, now, status) => attempts.set(job.id, { ...attempts.get(job.id), status, startedAt: status === 'started' ? now.toISOString() : attempts.get(job.id)?.startedAt }) },
  message: (job, { extra }) => ({
    name: `Scheduled: ${job.name}`,
    message: contractMessage({ what: `the scheduled session "${job.name}"`, job, extra, root: process.cwd(), file: job.dir,
      report: `node report.mjs ${job.id} --status ok|deferred|failed --why "<one sentence>"` }),
  }),
  start: ({ name, prompt }) => startYourSession(name, prompt),   // returns { ok: true, id } or { ok: false, reason }
  notify: (ev) => console.error(ev.title),
})

runner.tick()                                     // call every few minutes: cron, launchd, a CI schedule
runner.done({ id: 'schedule:investor-update', status: 'ok' })   // what report.mjs calls
```

`tick({ only: id })` starts one job now, whatever its time. Pass `gate` (or the bundled
`shellGate`), `log`, `lock`, `onNothing`, `onReport` and `migrate` as you need them; every machine
call is a parameter, so a test never starts a real session.

A gate exits 0 for work (its first line of stdout is handed to the session), 1 for nothing to do,
and anything else is a `gate-error`: logged with the tail of its stderr, never told to anyone, and
tried again next tick. `shellGate` runs it through `/bin/sh` with five minutes to finish
(`GATE_TIMEOUT_MS`); one killed at the limit logs `exit=timeout`, never a made-up exit code.

## From a terminal

```bash
npx supersessions add --name "Monday review" --every "monday 09:00" --method /review
npx supersessions list
npx supersessions due
npx supersessions emit pull-request-opened --data '{"number": 712}'
npx supersessions pause monday-review        # resume, remove
```

## License

MIT
