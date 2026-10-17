// tests/csv-dates.test.js
//
// Les `expiryDate` sont des `Date` : sans traitement dédié, le CSV les aplatissait
// comme un objet vide et la colonne disparaissait.

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { jsonToCsv } from "../src/utils/csvConverter.js";

test("dates are exported as ISO strings, including dates built in a vm", () => {
  const vmDate = vm.runInNewContext("new Date('2026-11-10T00:00:00.000Z')");
  const csv = jsonToCsv({
    CarvingKnife: { name: "Carving Knife", expiryDate: new Date("2026-11-10T00:00:00.000Z") },
    SpookyEgg: { name: "Spooky Egg", expiryDate: vmDate },
  });

  const [header, ...lines] = csv.trim().split("\n");
  assert.ok(header.split(",").includes("expiryDate"), header);
  for (const line of lines) assert.match(line, /2026-11-10T00:00:00\.000Z/);
});
