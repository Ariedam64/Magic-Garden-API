const url = process.argv[2] ?? "http://127.0.0.1:3002/live/stream";
const maxConns = Number(process.argv[3] ?? 5000);
const step = Number(process.argv[4] ?? 500);
const intervalSec = Number(process.argv[5] ?? 30);
const holdSec = Number(process.argv[6] ?? 60);

const controllers = [];
let opened = 0;
let errors = 0;
let requested = 0;

function openConnections(count) {
  for (let i = 0; i < count; i += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    requested += 1;

    fetch(url, { headers: { Accept: "text/event-stream" }, signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        opened += 1;
        return res.body?.getReader();
      })
      .then(async (reader) => {
        if (!reader) return;
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      })
      .catch(() => {
        errors += 1;
      });
  }
}

function logStatus(stage) {
  console.log({
    stage,
    target: Math.min(requested, maxConns),
    requested,
    opened,
    errors,
    active: controllers.length,
  });
}

let target = 0;
const interval = setInterval(() => {
  if (target >= maxConns) {
    clearInterval(interval);
    logStatus("max_reached");
    setTimeout(() => {
      controllers.forEach((c) => c.abort());
      logStatus("done");
      process.exit(0);
    }, holdSec * 1000);
    return;
  }

  target = Math.min(maxConns, target + step);
  const toAdd = target - controllers.length;
  if (toAdd > 0) {
    openConnections(toAdd);
  }
  logStatus("ramp");
}, intervalSec * 1000);

process.on("SIGINT", () => {
  clearInterval(interval);
  controllers.forEach((c) => c.abort());
  logStatus("interrupted");
  process.exit(0);
});

console.log({
  url,
  maxConns,
  step,
  intervalSec,
  holdSec,
});
