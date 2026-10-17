// EVENTS: the trigger that makes a session runner general. Anything (a hook, a webhook, another
// session) says "this happened" with a name and a payload; every job listening for that name gets
// one session per event, and the event is consumed when that session starts. One nobody listens
// for waits. Each event is one JSON file, so emitting needs no running process and no lock.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EVENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** An event store in one folder: { emit, pending, consume }. */
export function createEvents(dir) {
  return {
    dir,
    emit(name, data = {}, { now = new Date() } = {}) {
      if (!EVENT_NAME.test(String(name))) throw new Error(`event name ${name} must be lowercase words joined by hyphens`);
      const d = join(dir, name);
      mkdirSync(d, { recursive: true });
      const file = join(d, `${now.getTime()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`);
      writeFileSync(file, JSON.stringify({ name, at: now.toISOString(), data }) + "\n");
      return file;
    },
    /** Waiting events under one name, oldest first: [{ file, name, at, data }]. */
    pending(name) {
      const d = join(dir, String(name));
      if (!EVENT_NAME.test(String(name)) || !existsSync(d)) return [];
      return readdirSync(d).filter((f) => f.endsWith(".json")).sort().flatMap((f) => {
        try { return [{ file: join(d, f), ...JSON.parse(readFileSync(join(d, f), "utf8")) }]; } catch { return []; }
      });
    },
    consume(ev) { rmSync(ev.file, { force: true }); },
  };
}
