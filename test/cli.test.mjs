import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = join(import.meta.dirname, "..", "bin", "supersessions.mjs");
const run = (cwd, ...a) => spawnSync(process.execPath, [BIN, ...a], { cwd, encoding: "utf8" });

test("the CLI adds, lists, pauses, emits and removes, and refuses what it cannot read with exit 2", () => {
  const cwd = mkdtempSync(join(tmpdir(), "supersessions-cli-"));
  assert.equal(run(cwd, "add", "--name", "Monday review", "--every", "monday 09:00", "--method", "/review").status, 0);
  assert.match(run(cwd, "list").stdout, /active\s+monday-review\s+every monday 09:00/);
  assert.equal(run(cwd, "pause", "monday-review").status, 0);
  assert.equal(JSON.parse(run(cwd, "list", "--json").stdout).schedules[0].status, "paused");
  assert.equal(run(cwd, "emit", "pr-opened", "--data", '{"n":1}').status, 0);
  assert.equal(readdirSync(join(cwd, ".supersessions", "events", "pr-opened")).length, 1);
  assert.equal(run(cwd, "add", "--name", "Bad", "--every", "sometimes", "--method", "x").status, 2);
  assert.equal(run(cwd, "emit", "Bad Name").status, 2);
  assert.equal(run(cwd, "remove", "monday-review").status, 0);
  assert.equal(existsSync(join(cwd, "schedules", "monday-review.md")), false);
  assert.equal(run(cwd, "nonsense").status, 2);
});
