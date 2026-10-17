// tests/history-event-windows.test.js
//
// Les boutiques d'évènement (`spooky`, `rain`, `amber`) n'ont jamais
// d'intervalle en base : leur `nextRestockAt` est leur fermeture. Redémarrer
// l'API pendant qu'elles sont ouvertes doublait la fenêtre (21:40 puis 21:50
// pour une même nuit du Spooky Shop).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-history-"));
process.env.HISTORY_DB_PATH = path.join(dir, "history.sqlite");
process.env.HISTORY_EVENTS_ENABLED = "false";

const { initHistoryDB, recordShopRestock, getDB, closeHistoryDB } = await import("../src/services/historyDB.js");
const { handleShops } = await import("../src/services/historyRecorder.js");

initHistoryDB();

const rows = (shop) =>
  getDB().prepare("SELECT restocked_at FROM shop_restocks WHERE shop_type = ? ORDER BY restocked_at").all(shop);

const spooky = (items) => ({
  spooky: { open: true, nextRestockAt: "2026-10-16T22:10:00.000Z", items },
});

const ITEMS = [
  { name: "GhostPlant", stock: 5 },
  { name: "SpookyEgg", stock: 1 },
];

test("a restart inside an open Spooky Shop window does not record it twice", (t) => {
  // Enregistrée à l'ouverture par le processus précédent.
  recordShopRestock("spooky", ITEMS.map((it) => ({ id: it.name, stock: it.stock })), null, Date.parse("2026-10-16T21:40:00.000Z"));

  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-16T21:52:00.000Z") });
  handleShops(spooky(ITEMS));
  t.mock.timers.reset();

  assert.equal(rows("spooky").length, 1);
});

test("a different window after a restart is still recorded", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-16T21:53:00.000Z") });
  // Même processus : le baseline `spooky` est déjà pris, on simule un autre shop.
  handleShops({
    amber: { open: true, nextRestockAt: "2026-10-16T22:00:00.000Z", items: [{ name: "Sunflower", stock: 2 }] },
  });
  t.mock.timers.reset();

  assert.equal(rows("amber").length, 1);
});

test.after(() => {
  closeHistoryDB();
  fs.rmSync(dir, { recursive: true, force: true });
});
