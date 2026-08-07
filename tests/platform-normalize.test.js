// tests/platform-normalize.test.js
//
// Normalisation des payloads de l'API officielle du jeu (`/platform/v1/*`).
// Tests hors réseau : les payloads ci-dessous sont des captures réelles du
// 2026-08-07 (jour de la bascule WebSocket -> API officielle).

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeShops,
  withRestockCountdown,
  secondsUntilRestock,
  shopSignature,
} from "../src/core/platform/shops.js";
import { normalizeWeather } from "../src/core/platform/weather.js";
import { snapToGameGrid, snapIfNearGrid, GRID_MS } from "../src/core/platform/grid.js";

const SHOPS_PAYLOAD = {
  shops: {
    seed: {
      open: true,
      nextRestockAt: "2026-08-07T15:00:00.000Z",
      items: [
        { itemId: "Carrot", itemType: "Seed", name: "Carrot Seed", stock: 18 },
        { itemId: "BurrosTail", itemType: "Seed", name: "Burro's Tail Cutting", stock: 2 },
      ],
    },
    tool: {
      open: true,
      nextRestockAt: "2026-08-07T15:00:00.000Z",
      items: [
        { itemId: "WateringCan", itemType: "Tool", name: "Watering Can", stock: 4 },
        // Les shops mixtes existent aussi hors évènement : le shop `tool`
        // contient du décor.
        { itemId: "FeedingTrough", itemType: "Decor", name: "Feeding Trough", stock: 1 },
      ],
    },
    dawn: { open: false, nextRestockAt: null, items: [] },
  },
};

test("normalizeShops maps the official payload onto our public shape", () => {
  const shops = normalizeShops(SHOPS_PAYLOAD);

  assert.deepEqual(Object.keys(shops).sort(), ["dawn", "seed", "tool"]);

  // `name` reste l'identifiant canonique (c'est la clé de l'historique SQLite,
  // des sprites et du flag `purchasable`), le libellé va dans `displayName`.
  assert.deepEqual(shops.seed.items[0], {
    name: "Carrot",
    displayName: "Carrot Seed",
    itemType: "Seed",
    stock: 18,
  });

  assert.equal(shops.seed.open, true);
  assert.equal(shops.seed.nextRestockAt, "2026-08-07T15:00:00.000Z");
});

test("normalizeShops keeps mixed-type shops intact", () => {
  const shops = normalizeShops(SHOPS_PAYLOAD);

  assert.deepEqual(
    shops.tool.items.map((it) => [it.name, it.itemType]),
    [
      ["WateringCan", "Tool"],
      ["FeedingTrough", "Decor"],
    ]
  );
});

test("normalizeShops reports closed shops as open:false with no restock date", () => {
  const shops = normalizeShops(SHOPS_PAYLOAD);

  assert.equal(shops.dawn.open, false);
  assert.equal(shops.dawn.nextRestockAt, null);
  assert.deepEqual(shops.dawn.items, []);
  assert.equal(secondsUntilRestock(shops.dawn.nextRestockAt), 0);
});

test("normalizeShops drops out-of-stock and unidentifiable items", () => {
  const shops = normalizeShops({
    shops: {
      seed: {
        open: true,
        nextRestockAt: "2026-08-07T15:00:00.000Z",
        items: [
          { itemId: "Carrot", itemType: "Seed", name: "Carrot Seed", stock: 3 },
          { itemId: "Cabbage", itemType: "Seed", name: "Cabbage Seed", stock: 0 },
          { itemType: "Seed", name: "Mystery", stock: 5 },
        ],
      },
    },
  });

  assert.deepEqual(shops.seed.items.map((it) => it.name), ["Carrot"]);
});

test("normalizeShops tolerates a bare shop map and rejects junk", () => {
  const bare = normalizeShops({
    seed: { open: true, nextRestockAt: null, items: [{ itemId: "Carrot", stock: 1 }] },
  });
  assert.equal(bare.seed.items[0].name, "Carrot");

  assert.equal(normalizeShops(null), null);
  assert.equal(normalizeShops("nope"), null);
  assert.equal(normalizeShops({ shops: {} }), null);
});

test("secondsUntilRestock derives the countdown from nextRestockAt", () => {
  const now = Date.parse("2026-08-07T14:56:20.000Z");

  assert.equal(secondsUntilRestock("2026-08-07T15:00:00.000Z", now), 220);
  // Échéance dépassée : 0 plutôt qu'un négatif.
  assert.equal(secondsUntilRestock("2026-08-07T14:50:00.000Z", now), 0);
  assert.equal(secondsUntilRestock(null, now), 0);
  assert.equal(secondsUntilRestock("not-a-date", now), 0);
});

test("withRestockCountdown adds the countdown without touching the rest", () => {
  const shops = normalizeShops(SHOPS_PAYLOAD);
  const now = Date.parse("2026-08-07T14:59:00.000Z");
  const withCountdown = withRestockCountdown(shops, now);

  assert.equal(withCountdown.seed.secondsUntilRestock, 60);
  assert.equal(withCountdown.dawn.secondsUntilRestock, 0);
  assert.deepEqual(withCountdown.seed.items, shops.seed.items);
});

test("shopSignature ignores the ticking countdown but catches real changes", () => {
  const shops = normalizeShops(SHOPS_PAYLOAD);
  const early = withRestockCountdown(shops, Date.parse("2026-08-07T14:56:00.000Z"));
  const late = withRestockCountdown(shops, Date.parse("2026-08-07T14:59:59.000Z"));

  // Sans ça, chaque poll ressemblerait à un changement de shop.
  assert.equal(shopSignature(early.seed), shopSignature(late.seed));

  const restocked = normalizeShops({
    shops: {
      seed: {
        open: true,
        nextRestockAt: "2026-08-07T15:05:00.000Z",
        items: SHOPS_PAYLOAD.shops.seed.items,
      },
    },
  });
  assert.notEqual(shopSignature(restocked.seed), shopSignature(shops.seed));

  const restocked2 = normalizeShops({
    shops: {
      seed: {
        open: true,
        nextRestockAt: "2026-08-07T15:00:00.000Z",
        items: [{ itemId: "Carrot", itemType: "Seed", name: "Carrot Seed", stock: 17 }],
      },
    },
  });
  assert.notEqual(shopSignature(restocked2.seed), shopSignature(shops.seed));
});

test("normalizeWeather treats a null payload as Clear Skies", () => {
  // L'endpoint répond littéralement `null` hors évènement météo.
  assert.deepEqual(normalizeWeather(null), {
    weather: "Clear Skies",
    startedAt: null,
    endsAt: null,
    active: false,
  });
});

test("normalizeWeather maps the bare string payload the API returns", () => {
  // Forme réelle observée pendant un évènement : une chaîne JSON nue.
  assert.equal(normalizeWeather("Rain").weather, "Rain");
  assert.equal(normalizeWeather("Rain").active, true);

  // Libellés historiques : ceux stockés dans weather_events depuis toujours.
  assert.equal(normalizeWeather("Frost").weather, "Snow");
  assert.equal(normalizeWeather("Thunderstorm").weather, "Thunderstorm");
  assert.equal(normalizeWeather("Dawn").weather, "Dawn");
  assert.equal(normalizeWeather("AmberMoon").weather, "Amber Moon");
  assert.equal(normalizeWeather("Sunny").weather, "Clear Skies");
  assert.equal(normalizeWeather("Sunny").active, false);
});

test("normalizeWeather humanizes an unknown weather id instead of dropping it", () => {
  assert.equal(normalizeWeather("MeteorShower").weather, "Meteor Shower");
});

test("normalizeWeather reads object payloads and their timings", () => {
  const details = normalizeWeather({
    weatherId: "Frost",
    startedAt: "2026-08-07T15:35:00.000Z",
    endsAt: "2026-08-07T15:45:00.000Z",
  });

  assert.equal(details.weather, "Snow");
  assert.equal(details.startedAt, "2026-08-07T15:35:00.000Z");
  assert.equal(details.endsAt, "2026-08-07T15:45:00.000Z");

  // Enveloppé, et avec des timings en secondes epoch.
  const wrapped = normalizeWeather({
    weather: { type: "Rain", startsAt: 1786116900, endsAt: 1786117500 },
  });
  assert.equal(wrapped.weather, "Rain");
  assert.equal(wrapped.startedAt, "2026-08-07T15:35:00.000Z");
  assert.equal(wrapped.endsAt, "2026-08-07T15:45:00.000Z");
});

test("normalizeWeather returns a null label on an unrecognized shape", () => {
  // Le poller garde alors la dernière météo connue plutôt que d'en inventer une.
  assert.equal(normalizeWeather({ unexpected: 42 }).weather, null);
  assert.equal(normalizeWeather([1, 2]).weather, null);
});

test("snapToGameGrid recovers the exact transition time from a late observation", () => {
  // Cas réel : la pluie du 2026-08-07 a été vue à 15:35:14 par le poller, et
  // enregistrée à 15:35:00 par l'ancien flux WebSocket.
  const observed = Date.parse("2026-08-07T15:35:14.000Z");
  assert.equal(new Date(snapToGameGrid(observed)).toISOString(), "2026-08-07T15:35:00.000Z");

  // Déjà sur la grille : inchangé.
  const onGrid = Date.parse("2026-08-07T15:35:00.000Z");
  assert.equal(snapToGameGrid(onGrid), onGrid);

  // Horloge locale de quelques secondes en avance : on ne recule pas d'un cran.
  const slightlyEarly = Date.parse("2026-08-07T15:39:58.000Z");
  assert.equal(new Date(snapToGameGrid(slightlyEarly)).toISOString(), "2026-08-07T15:40:00.000Z");

  // Une observation en retard de presque tout un pas reste sur son pas.
  const veryLate = Date.parse("2026-08-07T15:35:00.000Z") + GRID_MS - 6000;
  assert.equal(new Date(snapToGameGrid(veryLate)).toISOString(), "2026-08-07T15:35:00.000Z");
});

test("snapIfNearGrid corrects interval noise but leaves off-grid cycles alone", () => {
  // Cas réel : le shop `dawn` a un intervalle de 600 s, mais l'ancien
  // enregistreur en avait mesuré 599 — la fenêtre reconstituée tombait à
  // 16:00:01 au lieu de 16:00:00.
  const oneSecondLate = Date.parse("2026-08-07T16:00:01.000Z");
  assert.equal(new Date(snapIfNearGrid(oneSecondLate)).toISOString(), "2026-08-07T16:00:00.000Z");

  const oneSecondEarly = Date.parse("2026-08-07T15:59:59.000Z");
  assert.equal(new Date(snapIfNearGrid(oneSecondEarly)).toISOString(), "2026-08-07T16:00:00.000Z");

  // Franchement hors grille (shop `apology`, ouvert à la main) : on n'y touche pas.
  const offGrid = Date.parse("2026-08-07T16:02:13.000Z");
  assert.equal(snapIfNearGrid(offGrid), offGrid);
});
