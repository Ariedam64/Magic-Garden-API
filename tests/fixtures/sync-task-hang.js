// Worker de test : annonce son pid puis ne répond jamais (tâche bloquée).
process.once("message", () => {
  process.send({ pid: process.pid });
  setInterval(() => {}, 1000);
});
