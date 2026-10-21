// tests/sync-task-runner.test.js
//
// Processus fils éphémères de la sync (rendus Rive, découpe des atlas).
//
// Ce que ces tests protègent : une tâche bloquée doit être **tuée** à son
// délai, pas seulement abandonnée. C'est la différence avec l'ancien
// `Promise.race` de l'export des décors, qui rendait la main en laissant le
// travail tourner — et avec le délai de garde de la sync, qui redémarrait
// toute l'API.
//
// Usage: node --test tests/sync-task-runner.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSyncTask, runningSyncTasks, SyncTaskError } from "../src/services/syncTaskRunner.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => path.join(FIXTURES, name);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runSyncTask", () => {
  it("returns the task result once the child has exited", async () => {
    const result = await runSyncTask(
      "echo",
      { keys: ["sprite/plant/Carrot"], n: 2 },
      { timeoutMs: 10_000, workerPath: fixture("sync-task-echo.js") }
    );
    assert.equal(result.task, "echo");
    assert.deepEqual(result.args, { keys: ["sprite/plant/Carrot"], n: 2 });
    assert.equal(isAlive(result.pid), false);
    assert.equal(runningSyncTasks(), 0);
  });

  it("kills a task that never answers, and says it timed out", async () => {
    const started = Date.now();
    await assert.rejects(
      runSyncTask("hang", {}, { timeoutMs: 400, workerPath: fixture("sync-task-hang.js") }),
      (err) => err instanceof SyncTaskError && err.timedOut && /timed out/.test(err.message)
    );
    assert.ok(Date.now() - started < 5_000);
    assert.equal(runningSyncTasks(), 0);
  });

  it("reports a child that dies without a result", async () => {
    await assert.rejects(
      runSyncTask("crash", {}, { timeoutMs: 10_000, workerPath: fixture("sync-task-crash.js") }),
      (err) => err instanceof SyncTaskError && !err.timedOut && /code 3/.test(err.message)
    );
  });

  it("the real worker rejects an unknown task instead of hanging", async () => {
    await assert.rejects(
      runSyncTask("nope", {}, { timeoutMs: 20_000 }),
      /Unknown sync task 'nope'/
    );
  });

  it("refuses to start without a timeout", async () => {
    await assert.rejects(runSyncTask("echo", {}, {}), TypeError);
  });

  it("importing the worker module does nothing outside a fork", async () => {
    const before = process.listenerCount("message") + process.listenerCount("disconnect");
    await import("../src/services/syncTaskWorker.js");
    const after = process.listenerCount("message") + process.listenerCount("disconnect");
    assert.equal(after, before);
  });
});
