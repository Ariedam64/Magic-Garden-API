// tests/sync-plan.test.js
//
// Décisions de la sync de sprites (sans réseau ni rendu).
//
// Ce que ces tests protègent : une montée de version du jeu ne doit pas, à
// elle seule, relancer les rendus Rive. Entre le 17 et le 21/10, chaque mise à
// jour re-rendait les mêmes `.riv` (36 s de WASM dans l'API, puis ~54 min
// d'animations), parce que le `force` destiné aux atlas sautait la comparaison
// d'URL.
//
// Usage: node --test tests/sync-plan.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planPetSprites, planDecorSprites, planVersionChange } from "../src/services/syncPlan.js";

const PETS = { key: "pets", url: "https://x/runtime-assets/pets.aaa.riv" };
const HALLOWEEN = { key: "halloween-pets", url: "https://x/runtime-assets/halloween-pets.bbb.riv" };

describe("planPetSprites", () => {
  const stored = { pets: { url: PETS.url }, "halloween-pets": { url: HALLOWEEN.url } };

  it("skips the render when every .riv URL is unchanged", () => {
    const plan = planPetSprites({ files: [PETS, HALLOWEEN], stored, sidecarExists: true });
    assert.equal(plan.render, false);
    assert.equal(plan.reason, "unchanged");
    assert.deepEqual(plan.changed, []);
  });

  it("renders when one file's hashed URL moved, and says which", () => {
    const moved = { ...HALLOWEEN, url: "https://x/runtime-assets/halloween-pets.ccc.riv" };
    const plan = planPetSprites({ files: [PETS, moved], stored, sidecarExists: true });
    assert.equal(plan.render, true);
    assert.equal(plan.reason, "rive_changed");
    assert.deepEqual(plan.changed, [{ key: "halloween-pets", from: HALLOWEEN.url, to: moved.url }]);
  });

  it("renders a file seen for the first time", () => {
    const plan = planPetSprites({ files: [PETS, HALLOWEEN], stored: { pets: stored.pets } });
    assert.equal(plan.render, true);
    assert.equal(plan.changed[0].from, null);
  });

  it("renders when the PNGs are gone even though the URLs match", () => {
    const plan = planPetSprites({ files: [PETS], stored, sidecarExists: false });
    assert.equal(plan.render, true);
    assert.equal(plan.reason, "sidecar_missing");
  });

  it("only the explicit Rive flag forces a render of unchanged files", () => {
    const plan = planPetSprites({ files: [PETS], stored, sidecarExists: true, forceRive: true });
    assert.equal(plan.render, true);
    assert.equal(plan.reason, "forced");
  });

  it("does nothing when the manifest has no pets file", () => {
    const plan = planPetSprites({ files: [], stored, forceRive: true });
    assert.equal(plan.render, false);
    assert.equal(plan.reason, "rive_not_in_manifest");
  });
});

describe("planDecorSprites", () => {
  const url = "https://x/runtime-assets/decor.ddd.riv";

  it("skips a startup sync when nothing could have moved", () => {
    const plan = planDecorSprites({ currentUrl: url, storedUrl: url, sidecarExists: true });
    assert.deepEqual(plan, { render: false, reason: "unchanged" });
  });

  it("reruns on a game update: the atlases may now provide a decor", () => {
    const plan = planDecorSprites({ versionChanged: true, currentUrl: url, storedUrl: url });
    assert.deepEqual(plan, { render: true, reason: "version_changed" });
  });

  it("reruns when decor.riv changed, or was never exported", () => {
    assert.equal(planDecorSprites({ currentUrl: url, storedUrl: null }).reason, "rive_changed");
    assert.equal(
      planDecorSprites({ currentUrl: url, storedUrl: url, sidecarExists: false }).reason,
      "sidecar_missing"
    );
  });

  it("honours the explicit Rive flag", () => {
    const plan = planDecorSprites({ currentUrl: url, storedUrl: url, forceRive: true });
    assert.deepEqual(plan, { render: true, reason: "forced" });
  });

  it("does nothing without a decor file in the manifest", () => {
    assert.equal(planDecorSprites({ currentUrl: null, forceRive: true }).render, false);
  });
});

describe("planVersionChange", () => {
  it("triggers a resync when the game moved past the stored version", () => {
    assert.deepEqual(planVersionChange({ latestVersion: "1695", previousVersion: "1686" }), {
      resync: true,
      reason: "version_changed",
    });
  });

  it("ignores the same update while its own sync is still running", () => {
    // Le watcher repasse chaque minute ; la version stockée ne bouge qu'en fin
    // de sync. Sans ce cas, chaque passage armait une seconde sync complète.
    const plan = planVersionChange({
      latestVersion: "1695",
      previousVersion: "1686",
      syncingVersion: "1695",
    });
    assert.deepEqual(plan, { resync: false, reason: "already_syncing" });
  });

  it("still catches a newer update that lands during a sync", () => {
    const plan = planVersionChange({
      latestVersion: "1696",
      previousVersion: "1686",
      syncingVersion: "1695",
    });
    assert.equal(plan.resync, true);
  });

  it("does nothing when unchanged or when there is no reference yet", () => {
    assert.equal(planVersionChange({ latestVersion: "1695", previousVersion: "1695" }).resync, false);
    assert.equal(planVersionChange({ latestVersion: "1695", previousVersion: null }).reason, "no_reference");
    assert.equal(planVersionChange({ latestVersion: null, previousVersion: "1695" }).reason, "unknown_version");
  });
});
