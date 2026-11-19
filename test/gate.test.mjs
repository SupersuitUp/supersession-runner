// The bundled shell gate and what the runner logs when a gate breaks (supersuit-dev#1052).
//
// A scheduled triage gate logged `status=gate-error exit=127` on eight ticks in a row and then
// passed unchanged. Nothing was missing: the gate took 64 seconds, the one-minute cap killed it,
// and a killed spawn has no exit status, which this mapped to 127 ("command not found"). The line
// carried no stderr, so nothing said what had happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellGate, createRunner, GATE_TIMEOUT_MS } from "../src/index.mjs";
import { windowsSh } from "../src/runner.mjs";

const cwd = mkdtempSync(join(tmpdir(), "supersessions-gate-"));

test("a gate past its time limit is reported as a timeout, never as exit 127", () => {
  const g = shellGate({ command: "sleep 5", cwd, timeoutMs: 200 });
  assert.equal(g.timedOut, true);
  assert.notEqual(g.code, 127, "127 means command not found, and nothing was missing");
  assert.notEqual(g.code, 0);
  assert.notEqual(g.code, 1, "a killed gate never reads as an empty queue");
});

test("the default limit leaves room for a gate that reads many repos (a minute was not enough)", () => {
  assert.ok(GATE_TIMEOUT_MS >= 5 * 60 * 1000, `GATE_TIMEOUT_MS is ${GATE_TIMEOUT_MS}`);
});

test("a gate's stderr comes back with its exit code", () => {
  const g = shellGate({ command: "echo first >&2; echo 'sh: nodex: command not found' >&2; exit 127", cwd });
  assert.equal(g.code, 127);
  assert.match(g.err, /nodex: command not found/);
});

test("`node` in a gate is the node running the runner, whatever PATH the scheduler gave it", () => {
  const g = shellGate({ command: "node -e 'process.stdout.write(process.execPath)'", cwd, env: { PATH: "/usr/bin:/bin" } });
  assert.equal(g.code, 0, g.err);
  assert.equal(g.out, process.execPath);
});

function runWith(answer) {
  const lines = [];
  const r = createRunner({
    inflightFile: join(mkdtempSync(join(tmpdir(), "supersessions-gl-")), "inflight.json"),
    jobs: () => ({ due: [{ id: "q", kind: "schedule", name: "Q", gate: "check" }], all: [] }),
    start: () => ({ ok: true, id: "s1" }),
    message: () => ({ name: "n", message: "m" }),
    gate: () => answer, log: (l) => lines.push(l),
  });
  const run = r.tick({ now: new Date("2026-10-24T20:14:00Z") }).runs[0];
  return { run, line: lines.find((l) => l.includes("gate-error")) || "" };
}

test("the gate-error line carries the tail of the gate's stderr, on one line", () => {
  const { run, line } = runWith({ code: 127, out: "", err: "noise\nsh: nodex: command not found\n" });
  assert.equal(run.status, "gate-error");
  assert.match(line, /exit=127/);
  assert.match(line, /stderr="[^"\n]*sh: nodex: command not found"/);
  assert.match(run.why, /command not found/);
});

test("a timed-out gate logs exit=timeout and its limit", () => {
  const { line, run } = runWith({ code: 124, out: "", err: "", timedOut: true, timeoutMs: 300000 });
  assert.match(line, /exit=timeout after=300s/);
  assert.match(run.why, /timed out after 300s/);
});

// Windows has no /bin/sh that node can spawn, so every gate there came back as exit 127 and the job never ran.
test("a gate runs through /bin/sh, and on Windows through the sh on PATH", () => {
  const seen = [];
  const spawn = (cmd, args) => { seen.push([cmd, ...args]); return { status: 0, stdout: "", stderr: "" }; };
  assert.equal(shellGate({ command: "true", cwd, platform: "darwin", spawn }).code, 0);
  assert.equal(shellGate({ command: "true", cwd, platform: "linux", spawn }).code, 0);
  assert.equal(shellGate({ command: "true", cwd, platform: "win32", spawn, env: { PATH: "C:\Windows" }, exists: () => false }).code, 0);
  assert.deepEqual(seen.map((c) => c[0]), ["/bin/sh", "/bin/sh", "sh"], "no Git anywhere: the bare name");
  assert.deepEqual(seen[2].slice(1), ["-c", "true"]);
});

// Under Task Scheduler's PATH a bare "sh" is not found: Git for Windows puts only Git/cmd on PATH (measured 2026-11-18).
const W = (s) => s.replace(/\//g, "\\");
test("on Windows the gate finds Git's sh.exe off PATH: beside git.exe, then in Git's install folder", () => {
  const has = (...files) => (p) => files.map(W).includes(p);
  const env = { PATH: W("C:/Windows/system32;C:/Program Files/Git/cmd"), ProgramFiles: W("C:/Program Files") };
  assert.equal(windowsSh({ env, exists: has("C:/Program Files/Git/cmd/git.exe", "C:/Program Files/Git/bin/sh.exe") }), W("C:/Program Files/Git/bin/sh.exe"));
  assert.equal(windowsSh({ env: { PATH: W("C:/Windows"), ProgramFiles: W("C:/Program Files") }, exists: has("C:/Program Files/Git/usr/bin/sh.exe") }), W("C:/Program Files/Git/usr/bin/sh.exe"));
  assert.equal(windowsSh({ env: { PATH: W("C:/tools"), LOCALAPPDATA: W("C:/Users/ada/AppData/Local") }, exists: has("C:/Users/ada/AppData/Local/Programs/Git/bin/sh.exe") }), W("C:/Users/ada/AppData/Local/Programs/Git/bin/sh.exe"));
  assert.equal(windowsSh({ env: { PATH: W("C:/msys/usr/bin") }, exists: has("C:/msys/usr/bin/sh.exe") }), W("C:/msys/usr/bin/sh.exe"), "an sh on PATH wins");
  const seen = [];
  shellGate({ command: "true", cwd, platform: "win32", env, exists: has("C:/Program Files/Git/bin/sh.exe"), spawn: (c) => { seen.push(c); return { status: 0 }; } });
  assert.deepEqual(seen, [W("C:/Program Files/Git/bin/sh.exe")]);
});
