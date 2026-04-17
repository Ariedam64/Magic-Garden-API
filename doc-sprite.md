# Mutation Sprite Rendering — Server-side Specification

How to compose a final sprite image from `base sprite + mutations`
(e.g. `Cactus` + `Rainbow + Wet + Amberlit`), so it can be served as a single
pre-composed PNG from `mg-api.ariedam.fr`.

This spec is self-contained. It describes inputs, outputs, and the exact
pipeline in terms of standard 2D canvas operations (Canvas2D / Skia /
Cairo / Pillow / sharp). No specific file layout is assumed.

---

## 1. High-level pipeline

Given:

- `base` = a sprite from a TexturePacker atlas (plant, tallplant, pet, crop, item, …).
- `mutations` = an unordered list of `MutationId` (e.g. `["Rainbow", "Wet", "Amberlit"]`).

The final output is a **single raster image** (PNG / WebP) built from the
following layers, rendered **bottom → top**:

```
┌──────────────────────────────────────────────────────────────┐
│ z=-1   Mutation icons (tall plants only, behind the plant)   │  e.g. Puddle under a tall plant
│ z= 0   Base sprite                                           │  original plant / pet / crop
│ z= 1   Color layers (tint filters), one per active mutation  │  Gold, Rainbow, Wet, …
│ z= 2   Standard mutation icons                               │  e.g. Chilled icon on top
│ z= 3   Tall-plant overlays (masked to base silhouette)       │  Wet / Chilled / Frozen / Thunderstruck overlays
│ z=10   Floating mutation icons                               │  Dawnlit / Amberlit / Dawnbound / Amberbound
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Atlas format (input)

Each atlas file is a standard TexturePacker multi-pack JSON that points to
a companion image (webp / png). Entry example:

```json
"sprite/tallplant/Cactus": {
  "frame":            { "x": 4,   "y": 4,   "w": 437, "h": 1262 },
  "rotated":          false,
  "trimmed":          true,
  "spriteSourceSize": { "x": 0,   "y": 18,  "w": 437, "h": 1262 },
  "sourceSize":       { "w": 446, "h": 1280 },
  "anchor":           { "x": 0.517937, "y": 0.952344 }
}
```

What each field is for, server-side:

| Field              | Meaning                                                              |
|--------------------|----------------------------------------------------------------------|
| `frame`            | Crop rectangle inside the atlas image.                               |
| `rotated`          | If `true`, the frame is stored rotated -90° and must be un-rotated.  |
| `trimmed`          | If `true`, the frame was trimmed; re-inflate it to `sourceSize`.     |
| `spriteSourceSize` | Where the trimmed frame sits inside the full `sourceSize` canvas.    |
| `sourceSize`       | Final canvas dimensions of the un-trimmed sprite.                    |
| `anchor`           | `{x,y}` in [0..1], origin used for positioning.                      |

To produce a usable sprite from an atlas entry:

1. Create an output canvas of size `sourceSize.w × sourceSize.h` (fully transparent).
2. Read the pixels from the atlas image at `frame`.
3. If `rotated`, rotate those pixels -90° (the stored width becomes the drawn height).
4. Paste them at `(spriteSourceSize.x, spriteSourceSize.y)`.
5. Remember `anchor` — you'll need it for overlay/icon placement.

**Key naming convention** — every asset key in the atlas follows:

```
sprite/<subfolder>/<TileName>
```

Relevant subfolders (only the ones used by the mutation system):

- `plant`            — ground-level crops.
- `tallplant`        — tall crops (Cactus, Bamboo, Celestial, Starweaver, …).
- `pet`              — pets.
- `mutation`         — mutation icons: `Wet`, `Chilled`, `Frozen`, `Dawnlit`, `Amberlit`, `Dawncharged`, `Ambercharged`, `Puddle`, `ThunderstruckGround`, …
- `mutation-overlay` — per-shape overlays for tall plants: `WetTallPlant`, `ChilledTallPlant`, `FrozenTallPlant`, `ThunderstruckTallPlant`.

---

## 3. Mutation catalog

| Id (internal)   | Display name  | Visual type                                   | Has tall-plant overlay? | Has floating icon? |
|-----------------|---------------|-----------------------------------------------|------|-----|
| `Gold`          | Gold          | Color filter only                             | no   | no  |
| `Rainbow`       | Rainbow       | Gradient color filter                         | no   | no  |
| `Wet`           | Wet           | Color filter + icon (`Puddle` on tall plants) | yes  | no  |
| `Chilled`       | Chilled       | Color filter + icon                           | yes  | no  |
| `Frozen`        | Frozen        | Color filter + icon                           | yes  | no  |
| `Thunderstruck` | Thunderstruck | Color filter + icon                           | yes  | no  |
| `Dawnlit`       | Dawnlit       | Color filter + floating icon                  | no   | yes |
| `Ambershine`    | Amberlit      | Color filter + floating icon                  | no   | yes |
| `Dawncharged`   | Dawnbound     | Color filter + floating icon                  | no   | yes |
| `Ambercharged`  | Amberbound    | Color filter + floating icon                  | no   | yes |

Note the mismatch between internal id and display name for the four "warm"
mutations — sprite keys on disk use the **display name**, not the id. Use
these aliases when looking up sprite keys (try each in order):

```text
Ambershine    → ["Ambershine", "Amberlit"]
Dawncharged   → ["Dawncharged", "Dawnbound"]
Ambercharged  → ["Ambercharged", "Amberbound"]
Thunderstruck → ["Thunderstruck", "ThunderstruckGround"]
others        → [itself]
```

---

## 4. Canonical sort order

Mutations MUST be sorted before rendering to guarantee a stable output:

```text
Gold, Rainbow, Wet, Chilled, Frozen, Thunderstruck,
Ambershine, Dawnlit, Dawncharged, Ambercharged
```

Unknown mutations go to the end. Deduplicate before sorting.

---

## 5. Mutation normalization (color vs overlay vs icon)

Before building layers, split the sorted mutation list into three sub-lists.

### 5.1. Color list — which mutations get a color filter

1. If `Gold` is present → keep only `Gold`. (exclusive)
2. Else if `Rainbow` is present → keep only `Rainbow`. (exclusive)
3. Else, if any "warm" mutation (`Ambershine`, `Dawnlit`, `Dawncharged`, `Ambercharged`)
   is present, **drop** all water/ice mutations (`Wet`, `Chilled`, `Frozen`, `Thunderstruck`)
   from the color list — the warm glow visually replaces them.
4. Otherwise, keep everything (still in canonical order).

### 5.2. Overlay list — tall plants only

Keep only the mutations that have a tall-plant overlay:
`Wet`, `Chilled`, `Frozen`, `Thunderstruck`. Sort canonically. Applied only
if the base sprite is a tall plant.

### 5.3. Icon list — original sorted list

Use the full canonical-sorted list, but:

- Skip `Gold` and `Rainbow` (they have no icon).
- On tall plants, substitute the icon for the `tallIconOverride` when set:
  - `Wet` → `Puddle`
  - `Thunderstruck` → `ThunderstruckGround`

---

## 6. Tall-plant detection

A sprite is "tall" if either:

1. Its key starts with `sprite/tallplant/`, **or**
2. Its sprite filename (last path segment, no extension) matches the plant sprite filename of a species whose `plant.tileTransformOrigin === "bottom"` in the game data.

Concretely: load `/data/plants`, keep entries where `plant.tileTransformOrigin === "bottom"`, extract the filename from `plant.sprite` (e.g. `"StarweaverPlant"`, `"Cactus"`, `"Tree"`, `"PalmTree"`, …). A sprite key whose last segment matches one of these names is tall.

This correctly excludes crop-form sprites (e.g. `sprite/plant/Starweaver` → `"Starweaver"` is not in the set, only `"StarweaverPlant"` is).

---

## 7. Color filters

Every color filter is applied **to a silhouette of the base sprite** — the
alpha of the base must be preserved exactly.

### 7.1. Solid color filter (Gold, Wet, Chilled, Frozen, Thunderstruck, Dawnlit, Amberlit, Dawnbound, Amberbound)

Canvas2D-style pseudocode (one layer per mutation):

```
layer = new Canvas(base.w, base.h)  // transparent
ctx = layer.getContext('2d')
ctx.imageSmoothingEnabled = false

# 1. Stamp the base sprite (we need its silhouette).
ctx.drawImage(base, 0, 0)

# 2. Replace RGB with the mutation color, keeping the silhouette.
ctx.globalCompositeOperation = 'source-in'
ctx.globalAlpha              = <alpha>
ctx.fillStyle                = <rgb>
ctx.fillRect(0, 0, base.w, base.h)

# 3. Composite `layer` on top of the base.
```

This yields a sprite-shaped rectangle tinted in the mutation color, which
you draw on top of the base sprite.

Colors (RGB, 0..255) and alpha:

| Mutation       | color                | alpha |
|----------------|----------------------|-------|
| Gold           | `rgb(235, 200, 0)`   | 0.70  |
| Wet            | `rgb(50, 180, 200)`  | 0.25  |
| Chilled        | `rgb(100, 160, 210)` | 0.45  |
| Frozen         | `rgb(100, 130, 220)` | 0.50  |
| Thunderstruck  | `rgb(16, 141, 163)`  | 0.40  |
| Dawnlit        | `rgb(209, 70, 231)`  | 0.50  |
| Ambershine     | `rgb(190, 100, 40)`  | 0.50  |
| Dawncharged    | `rgb(140, 80, 200)`  | 0.50  |
| Ambercharged   | `rgb(170, 60, 25)`   | 0.50  |

### 7.2. Rainbow (gradient + color blend)

Gradient, 6 stops, evenly distributed:

```
0.0 #FF1744
0.2 #FF9100
0.4 #FFEA00
0.6 #00E676
0.8 #2979FF
1.0 #D500F9
```

Angle:

- **Ground-level sprites**: 130°  (diagonal)
- **Tall plants**:          0°    (vertical)

The angle is measured clockwise from the vertical axis (top), matching the
game's `angle` convention (130° = diagonal top-left → bottom-right, 0° = top → bottom).

Algorithm:

```
# 1. Fill a canvas of size (base.w, base.h) with the linear gradient
#    along the chosen angle across the bounding box.
#    For tall plants (0°) the stops cover the full vertical range
#    (top = stop 0, bottom = stop 1).

grad = linearGradient(angle, base.w, base.h, stops)
gradCtx.fillStyle = grad
gradCtx.fillRect(0, 0, base.w, base.h)

# 2. Clip the gradient to the base silhouette.
gradCtx.globalCompositeOperation = 'destination-in'
gradCtx.drawImage(base, 0, 0)

# 3. Composite onto the base using the HSL "color" blend mode:
#    - keeps base luminosity (shading)
#    - takes hue + saturation from the gradient
#    - preserves base alpha
finalCtx.globalCompositeOperation = 'color'
finalCtx.drawImage(gradCanvas, 0, 0)
```

Alpha = 1 for the gradient. `node-canvas`, `skia-canvas` and most Canvas2D
implementations support `globalCompositeOperation = 'color'` directly, which
matches the game exactly. If your backend doesn't, fall back in this order:
`overlay` → `screen` → `lighter` → `source-atop`.

### 7.3. Stacking

Color layers are drawn in canonical sort order, each on top of the previous.
Since `Gold` / `Rainbow` are exclusive (§5.1), you will have at most one
"global" tint; on top of that, status tints (water/ice or warm) may stack
semi-transparently.

---

## 8. Tall-plant overlays

For `Wet`, `Chilled`, `Frozen`, `Thunderstruck`, **tall plants only** receive
an additional texture overlay drawn after the color filters but before the
floating icons.

Canonical asset keys:

```text
Wet           → sprite/mutation-overlay/WetTallPlant
Chilled       → sprite/mutation-overlay/ChilledTallPlant
Frozen        → sprite/mutation-overlay/FrozenTallPlant
Thunderstruck → sprite/mutation-overlay/ThunderstruckTallPlant
```

Fallback order if the canonical key isn't in the atlas (use aliases from §3):

```text
sprite/mutation-overlay/<Alias>TallPlant
sprite/mutation-overlay/<Alias>
sprite/mutation/<Alias><PlantName>             ← e.g. "WetCactus"
sprite/mutation/<Alias>-<PlantName>
sprite/mutation/<Alias>_<PlantName>
sprite/mutation/<Alias>/<PlantName>
sprite/mutation/<Alias>                        ← last resort
```

If none exist, skip the overlay for that mutation (do NOT 404 the request).

### Placement + masking

The overlay's top edge sits at the top of the base canvas, horizontally
aligned to the base anchor, and is then **masked to the base silhouette** —
that's what makes ice/puddle/lightning hug the plant shape.

```
ow, oh       = overlay.sourceSize
basePosX     = base.w * anchorX      # anchor of the base sprite
overlayX     = basePosX - anchorX * ow
overlayY     = 0

# 1. Draw overlay on a canvas of size (ow, oh) at (0, 0).
mCtx.drawImage(overlay, 0, 0)

# 2. Mask it to the base silhouette.
mCtx.globalCompositeOperation = 'destination-in'
mCtx.drawImage(base, -overlayX, -overlayY)

# 3. Composite onto the final image at (overlayX, overlayY).
finalCtx.drawImage(maskedCanvas, overlayX, overlayY)
```

If multiple overlay mutations are active (e.g. `Wet + Frozen`), draw them
one after another in canonical sort order.

---

## 9. Mutation icons

Small 2D stickers placed on / near the base sprite.

### 9.1. Which icon to use

Each mutation maps to a fixed icon key (and an optional tall-plant icon key):

```text
Wet           → sprite/mutation/Wet          (tall: sprite/mutation/Puddle)
Chilled       → sprite/mutation/Chilled
Frozen        → sprite/mutation/Frozen
Thunderstruck → sprite/mutation/Thunderstruck (tall: sprite/mutation/ThunderstruckGround)
Dawnlit       → sprite/mutation/Dawnlit
Ambershine    → sprite/mutation/Amberlit
Dawncharged   → sprite/mutation/Dawncharged
Ambercharged  → sprite/mutation/Ambercharged
```

On tall plants, use the `tall:` key when one is listed; otherwise fall back to the regular key.
`Gold` and `Rainbow` have **no icon** — skip them entirely.

### 9.2. Where to draw it

Inputs: the base sprite's `sourceSize (w, h)`, its `anchor (anchorX, anchorY)`,
a `speciesId` (= the `<TileName>` part of the base key, e.g. `Cactus`, `Carrot`),
and the icon's own `anchor` (iconAnchorX, iconAnchorY).

Constants:

```
TILE_SIZE_WORLD                      = 256
BASE_ICON_SCALE                      = 0.5
TALL_PLANT_MUTATION_ICON_SCALE_BOOST = 2
```

Compute the target position (normalized, then converted to px):

```ts
// X target: centered on the base anchor, unless an exception overrides.
let targetX = anchorX;
if (MUT_ICON_X_EXCEPT[species] !== undefined) targetX = MUT_ICON_X_EXCEPT[species];

// Y target: anchor-aligned for tall/vertical crops, 0.4 otherwise.
const isVertical = height > width * 1.5;
let targetY = isVertical ? anchorY : 0.4;
if (MUT_ICON_Y_EXCEPT[species] !== undefined) targetY = MUT_ICON_Y_EXCEPT[species];

const basePos  = { x: width * anchorX,       y: height * anchorY };
const offsetPx = { x: (targetX - anchorX) * width,
                   y: (targetY - anchorY) * height };

// Scale with the sprite, capped at 1.5x.
const minDim      = Math.min(width, height);
const scaleFactor = Math.min(1.5, minDim / TILE_SIZE_WORLD);
let   iconScale   = BASE_ICON_SCALE * scaleFactor;
if (isTallPlant) iconScale *= TALL_PLANT_MUTATION_ICON_SCALE_BOOST;

// Final draw (respect the icon texture's own anchor):
const drawW = iconSourceW * iconScale;
const drawH = iconSourceH * iconScale;
const drawX = basePos.x + offsetPx.x - drawW * iconAnchorX;
const drawY = basePos.y + offsetPx.y - drawH * iconAnchorY;
```

### 9.3. Per-species exceptions

Override `targetX` / `targetY` for these species:

```text
MUT_ICON_Y_EXCEPT:                MUT_ICON_X_EXCEPT:
  Banana         : 0.68              Pepper : 0.60
  Beet           : 0.65              Banana : 0.60
  Carrot         : 0.60
  Sunflower      : 0.50
  Starweaver     : 0.50
  Clover         : 0.30
  FourLeafClover : 0.30
  FavaBean       : 0.25
  BurrosTail     : 0.20
  Rose           : 0.16
```

### 9.4. Z-index

```
Default                             → z = 2    (above color layers, below overlays)
Tall plants (non-floating)          → z = -1   (behind the plant — e.g. Puddle)
Floating icons                      → z = 10   (above everything)
  (Dawnlit, Ambershine, Dawncharged, Ambercharged)
```

When drawing in a flat 2D context, draw in ascending z order:

```
1. All icons with z = -1 (drawn first, behind the base).
2. Base sprite.
3. All color layers (§7), in canonical sort order.
4. All icons with z = 2.
5. All tall-plant overlays (§8), in canonical sort order.
6. All icons with z = 10.
```

---

## 10. Output canvas

- Output size = **bounding box of all layers**, not fixed to `sourceSize`.
  Compute the union of the base sprite rect and every icon's draw rect, then
  expand the canvas to fit. Offset all draw positions by `(-bbMinX, -bbMinY)`
  so nothing is clipped. This lets mutation icons that extend past the base
  (e.g. floating icons on small crops) remain fully visible.
  Overlays are always clipped to the base silhouette and never expand the canvas.
- Image smoothing: **disabled** everywhere (pixel art).
  Canvas2D: `ctx.imageSmoothingEnabled = false`.
- Background: fully transparent.
- Encoding: PNG (lossless) for the cache; optional WebP re-encode for delivery.

**Cache key**:

```
<spriteKey>|<mutations sorted, comma-joined>
e.g.  sprite/tallplant/Cactus|Amberlit,Rainbow,Wet
```

Invalidate when the atlas manifest hash changes.

---

## 11. Pets

Pets use the exact same pipeline with two differences:

1. Base key is `sprite/pet/<PetName>`.
2. Pets are **never** tall → skip §8 entirely, and never use `tallIconOverride` from §9.1.

Everything else (color filters, icon placement, sort order, z-order) is identical.

---

## 12. Animated sprites

Some sprite keys resolve to an **animation** = an ordered list of per-frame
sprite keys with matching metadata.

Applying mutations to an animation = applying the full pipeline above to
**each frame independently**. All filters are per-pixel and deterministic,
so frames stay in sync.

Server-side options:

- Return per-frame PNGs (e.g. `?frame=0..N-1`) and let the client animate.
- Return an APNG or animated WebP with the original frame order / durations.

---

## 13. Server API

```
GET /assets/sprites/composed
  ?key=sprite/tallplant/Cactus             (required — full atlas key)
  &mutations=Rainbow,Wet,Amberlit          (optional, order-insensitive)
```

Example:

```
https://mg-api.ariedam.fr/assets/sprites/composed?key=sprite/tallplant/Cactus&mutations=Rainbow,Wet
```

Rules enforced by the server:

- `key` is required; missing or malformed key → 400.
- Deduplicate and canonical-sort `mutations` (§4) before processing.
- Apply normalization (§5) before building layers.
- Ignore unknown mutation ids — do not 404.
- Ignore missing overlay / icon assets — do not 404.
- 404 only when the base `key` does not exist in the atlas.
- Response is `image/png`.
- Cache header: `public, max-age=86400, stale-while-revalidate=3600`.
