// Worker de test : renvoie ses arguments, avec son pid.
process.once("message", ({ task, args }) => {
  process.send({ ok: true, result: { task, args, pid: process.pid } }, () => process.exit(0));
});
