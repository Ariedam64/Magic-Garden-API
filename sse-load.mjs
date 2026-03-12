const url = process.argv[2] ?? 'https://mg-api.ariedam.fr/live/stream';
const conns = Number(process.argv[3] ?? 100);
const duration = Number(process.argv[4] ?? 60);

const controllers = [];
let opened = 0;
let errors = 0;

for (let i = 0; i < conns; i++) {
  const controller = new AbortController();
  controllers.push(controller);

  fetch(url, { headers: { Accept: 'text/event-stream' }, signal: controller.signal })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      opened++;
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
      errors++;
    });
}

setTimeout(() => {
  controllers.forEach((c) => c.abort());
  console.log({ opened, errors });
}, duration * 1000);
