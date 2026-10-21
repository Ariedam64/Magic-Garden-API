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

import { planPetSprites, planDecorSprites } from "../src/services/syncPlan.js";

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
