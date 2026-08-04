# Rive — inventaire et pistes

Notes de repérage sur les assets Rive du jeu (relevé sur la **v824**, août 2026).
Mémo interne : ce qui existe, ce que le jeu en fait, ce qu'on pourrait en tirer.

Le pipeline actuellement en production est décrit dans le code :
[`exportPetsFromRive.js`](src/assets/sprites/exportPetsFromRive.js) et
[`riveRenderer.js`](src/assets/sprites/riveRenderer.js).

---

## 1. Pourquoi Rive

À la v824 le jeu a sorti les pets des atlas TexturePacker. `sprite/pet/*` ne
contient plus que les 10 œufs ; les créatures sont des **artboards vectoriels**
rendus à la volée côté client. Un `.riv` ne contient aucune image : uniquement
des courbes, des timelines et des state machines (vérifié — zéro signature
PNG/WebP dans `pets.riv`).

Conséquence : pour servir un PNG, il faut **jouer l'animation et photographier
une frame**. C'est ce que fait notre export.

---

## 2. Inventaire

Les `.riv` sont listés dans `manifest.json`, servis sous une URL versionnée par
hash de contenu (`/runtime-assets/<nom>.<hash>.riv`).

| Fichier | Taille | Contenu | Chargement |
|---|---|---|---|
| `pets.riv` | 3,0 Mo | 29 artboards, **638 timelines**, 29 state machines | ✅ |
| `decor.riv` | 224 Ko | 8 décors animés, 8 timelines, 8 SM | ✅ |
| `currency.riv` | 32 Ko | `BreadSlice`, 7 timelines | ✅ |
| `thought-bubble.riv` | 8 Ko | `ThoughtBubble`, 3 timelines | ✅ |
| `giftbox.riv` | 8 Ko | `Gift`, 2 timelines | ✅ |
| `avatar.riv` | 616 Ko | avatars joueurs | ❌ bloque |

Soit **~40 artboards et ~660 timelines** exploitables.

**pets.riv** — 28 pets + 1 artboard conteneur (`Pets`, qui duplique un pet ;
le jeu ne le rend jamais, il demande toujours un artboard nommé). Contient
`Rooster` et `Hedgehog`, absents de `/data/pets` : deux pets pas encore sortis.

Chaque pet expose une state machine `Pet State Machine` et ~22 timelines :
`Pet_Idle`, `Pet_IdleBreak`, `Pet_Walk`, `Pet_Sleep`, `Pet_Eat`, `Pet_Petted`,
`Pet_Ability`, `Pet_Mount` / `Pet_Dismount`, `Ability_Burst`,
`Thunder_On` / `Off`, `Fire_On` / `Off`, `Shadow_On` / `Off`…

Inputs de la state machine (booléens et triggers) : `sleep`, `held`, `fire`,
`thunder`, `isShadowVisible`, `ability`, `eat`, `hungry`, `idleBreak`, `mount`,
`dismount`, `petted`, `walk`.

**decor.riv** — `WoodWindmill`, `WeatherStation`, `WindSpinner`, `WindTurner`,
`Cauldron`, `StoneBirdBath`, `BoobooBooth`, `MarbleFountain`.

**avatar.riv** ne se charge pas : `rive.load()` ne résout jamais. Il référence
des assets **hors fichier** (`Top_Basket`, `Bottom_Mesh`,
`Top_DiscordPopsicle`… — les cosmétiques du bundle `cosmetic`) et le runtime
attend qu'on les lui fournisse. Faisable, mais il faut un resolver d'assets
plus la combinatoire des tenues.

---

## 3. Comment le jeu, lui, fabrique ses images fixes

Repéré dans le chunk `main-*.js` : une classe **`PetIconService`** qui bake les
icônes de pets de l'UI depuis le même `.riv`. C'est la référence à suivre si on
veut coller au rendu officiel.

Recette (`startSource` / `snapshotBase`) :

```js
createSprite({
  artboardName:  <PetId>,
  stateMachineName: `Pet State Machine`,
  settledPose:   recipe.pose,          // "awake" | "sleeping"
  settledWeatherActive: <bool>,        // FireHorse -> fire, ThunderWolf -> thunder
  riveRenderSizeMode: `fixed`,
  randomizeInitialPhase: false,        // ← déterministe, contrairement au monde
  riveAtlasPriority: `opportunistic`,
})
sprite.anchor = (0.5, 1)
sprite.height = bakeHeightPx           // 512, divisé par 2 si l'atlas déborde, min 128
sprite.width  = bakeHeightPx * (600/850)
```

Puis le cadrage, qui est **le point important** :

```js
frame = Rect(-w/2, -h, w, h)                  // repère ancré (0.5, 1)
bbox  = alphaBounds(render, seuil = 16)       // bbox alpha
cx    = render.width / 2
l     = max(cx - bbox.x, bbox.x + bbox.w - cx)
tight = Rect(-l, frame.y + bbox.y, 2*l, bbox.h)
```

Autrement dit : **symétrique horizontalement autour de l'axe de l'artboard**,
et serré verticalement. C'est ce qui donne des images parfaitement centrées,
même quand le pet a une queue ou une aile qui dépasse d'un seul côté.

Notes annexes :
- `settleDraws` vaut 1 par défaut → une seule passe de dessin, et
  `deterministicCapture` reste vrai. Au-delà de 1, le jeu désactive lui-même le
  cache de cadrage (le rendu n'est plus reproductible).
- **Le jeu ne désigne aucune frame.** `advanceZero()` fait littéralement
  `stateMachine.advance(0); artboard.advance(0)`, le hook `prepareSource` est
  omis à l'instanciation (`new sbe(a, b, c)`, 3 arguments) donc c'est un no-op,
  et `draw(captureTimeMs)` n'avance pas non plus : `advance(e)` calcule
  `lastTimeMs === null ? 0 : …`. La capture est donc la frame 0 de `Pet_Idle`,
  une boucle de 7 s dont la frame 0 tombe sur un extrême du balancement.
  C'est pour ça qu'on ne reprend **pas** sa pose : voir §3 bis.
- Le cadre serré est mémoïsé par `species@bakeHeight` (`tightFrameCache`).
- Dans le **monde** (pas l'UI), c'est l'inverse : `randomizeInitialPhase: true`
  et `settleSeconds: 4`, pour que les pets ne battent pas des ailes en cœur.

## 3 bis. Où on s'écarte du jeu, et pourquoi

**Cadrage : on suit le jeu.** La symétrisation autour de l'axe de l'artboard est
reprise telle quelle. Mesuré sur les 28 pets (axe de symétrie réel du dessin
contre centre de l'image), c'est nettement le meilleur des candidats :

| approche | erreur moyenne | max |
|---|---|---|
| v810 (rognage serré d'origine) | 14,5 px | 59,5 |
| rognage serré des deux côtés | 17,9 px | 63,5 |
| **axe artboard (retenu)** | **5,0 px** | 22,5 |

**Pose : on s'en écarte.** Le jeu capture la frame 0 de `Pet_Idle`. Or c'est une
boucle de 7 s et sa frame 0 tombe sur un extrême du balancement : corps de
travers, éventail du paon replié, regard décalé. Les anciens sprites d'atlas
étaient sur une pose neutre.

On prend donc la frame la plus proche de la **médiane pixel à pixel du cycle**.
Le pet passe l'essentiel de son idle autour de sa pose de repos ; balancements,
clignements et battements d'ailes sont des outliers qui s'éliminent seuls.
Aucun réglage par espèce — un pet ajouté par une maj est traité correctement
sans intervention.

Seule exception : les variantes météo (`FireHorseActive`, `ThunderWolfActive`),
où on restreint d'abord aux frames les plus larges. Le jeu ne les bake jamais,
donc il n'existe aucune pose de référence, et la médiane attrape les éclairs et
les flammes à un creux de leur pulsation.

---

## 4. Ce qui est faisable

Testé et mesuré, pas supposé.

**Poses fixes autres que l'idle.** Les inputs de la state machine sont
accessibles ; on sait déjà s'en servir (`fire` / `thunder` pour les variantes
météo). Donc : pet endormi, en train de manger, ability déclenchée, monté…
Coût identique à l'export actuel.

**Animations.** Test réel : `Pet_Idle` du Chicken = 7 s @60 fps → 168 frames
rendues en **2,5 s**, assemblées en WebP animé valide (434 Ko, boucle infinie,
42 ms/frame) et en planche de sprites 12×14. APNG et GIF passent par le même
chemin. Rien ne bloque techniquement.

**Décors animés et bulle de pensée.** Mêmes conditions que les pets.

**Résolution libre.** C'est du vectoriel : du 1024 px net ne coûte que du CPU,
là où l'ancien atlas était plafonné à sa résolution native.

---

## 5. Limites connues

- **Coût CPU** : ~15 ms par frame. Une timeline de 7 s en 24 fps ≈ 170 frames
  ≈ 3 s de rendu. Impensable à la volée par requête → pré-générer à la sync
  (comme les PNG actuels) ou cacher agressivement.
- **Volume** : 660 timelines en animé, ça se compte en centaines de Mo. Il faut
  choisir un sous-ensemble utile (idle, walk, sleep, eat) plutôt que tout sortir.
- **`avatar.riv`** : chantier à part (resolver d'assets + combinatoire).
- **Pas de WebGL** : le runtime tourne en Canvas2D (`@napi-rs/canvas`). Si un
  artboard utilisait des *image meshes*, il ne s'afficherait pas. Aucun des 5
  fichiers qui chargent n'est concerné aujourd'hui.
- **Pièges du runtime**, déjà encaissés, à ne pas réapprendre :
  - il sonde `getContext('webgl2')` au démarrage et `@napi-rs/canvas` **lève**
    au lieu de renvoyer `null` → il faut shunter vers Canvas2D ;
  - `renderer.flush()` ne valide pas la frame — sans
    `rive.resolveAnimationFrame()`, le PNG sort **entièrement transparent** ;
  - l'idle ne se stabilise jamais, il boucle : figer une frame arbitraire donne
    des poses ratées (ailes repliées, VFX invisibles, yeux fermés). Voir la
    sélection de frame dans `riveRenderer.js`.

---

## 6. Repère utile

Les atlas des anciennes versions restent servis par le CDN
(`/version/<v>/assets/atlases/sprites-*.json`). La **v810** contient encore les
28 frames `sprite/pet/*` d'avant Rive, avec leurs ancres et tailles d'origine.
C'est la référence qui a permis de valider les rendus Rive — à récupérer tant
que le CDN les garde.
