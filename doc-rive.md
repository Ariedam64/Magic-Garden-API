# Rive — inventaire et pistes

Notes de repérage sur les assets Rive du jeu (relevé sur la **v824**, août 2026).
Mémo interne : ce qui existe, ce que le jeu en fait, ce qu'on pourrait en tirer.

Le pipeline actuellement en production est décrit dans le code :
[`exportPetsFromRive.js`](src/assets/sprites/exportPetsFromRive.js) et
[`riveRenderer.js`](src/assets/sprites/riveRenderer.js) pour les PNG,
[`exportPetAnimations.js`](src/assets/sprites/exportPetAnimations.js) et
[`riveAnimator.js`](src/assets/sprites/riveAnimator.js) pour les boucles
animées (§ 7).

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

**Attention à l'endroit où on les cherche** : le jeu ne les range pas au même
endroit. `pets.riv` et `avatar.riv` sont dans le bundle `default`, mais les
quatre autres ont **chacun leur propre bundle**, nommé d'après le fichier
(`decor.riv`, `currency.riv`, `giftbox.riv`, `thought-bubble.riv`). Une
résolution qui ne regarde que `default` — ce que faisait la version d'origine,
écrite quand seuls les pets comptaient — en rate les deux tiers sans rien
signaler. `riveManifest.js` balaie donc tous les bundles.

Ce tableau n'est plus à maintenir à la main : `/assets/rive` le publie, relevé
à chaque sync (`riveSync.js`), avec pour chaque fichier ses artboards, ses
timelines et **le type de chaque entrée de state machine**.

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

**Animations.** ✅ Fait — voir § 7.

**Décors animés.** ✅ Fait — voir § 8. **Bulle de pensée, pièce, coffre** :
mêmes conditions, le pipeline du § 7 les prendrait tels quels.

**Résolution libre.** C'est du vectoriel : du 1024 px net ne coûte que du CPU,
là où l'ancien atlas était plafonné à sa résolution native.

---

## 5. Limites connues

- **Coût CPU** : ~15 ms par frame. Une timeline de 7 s en 24 fps ≈ 170 frames
  ≈ 3 s de rendu. Impensable à la volée par requête → pré-générer à la sync
  (comme les PNG actuels) ou cacher agressivement.
- **Volume** : 660 timelines en animé, ça se compte en centaines de Mo. Il faut
  choisir un sous-ensemble utile (idle, walk, sleep, eat) plutôt que tout sortir.
- **`avatar.riv`** : chantier à part (resolver d'assets + combinatoire). Il
  apparaît dans `/assets/rive` avec `loadable: false` — l'inventaire le signale
  au lieu de le passer sous silence, et son URL étant versionnée par hash, on ne
  le réessaie pas à chaque sync (juste une fois par nouvelle version).
- **Pas de WebGL** : le runtime tourne en Canvas2D (`@napi-rs/canvas`). Si un
  artboard utilisait des *image meshes*, il ne s'afficherait pas. Aucun des 5
  fichiers qui chargent n'est concerné aujourd'hui.
- **Un `.riv` illisible ne rejette pas, il ne résout jamais.** C'est le cas
  d'`avatar.riv`, et ce sera celui de `pets.riv` le jour où le jeu passera à un
  format Rive plus récent que notre runtime épinglé. `loadRiveFile` borne donc
  le chargement : l'export est sauté, les PNG déjà sur disque restent servis.
  Sans cette borne, le blocage remonte jusqu'au timeout de la sync, qui tue le
  process — donc boucle de redémarrage sous pm2.
- **Une state machine renommée corromprait tout en silence** : sans elle,
  l'artboard rend sa pose d'édition (pet à la mauvaise échelle, ombre au sol
  visible) et produit un PNG parfaitement valide. `renderArtboardToPng` lève
  donc plutôt que de rendre ce repli.

### Ce qui survit tout seul à une maj, et ce qui ne survit pas

Survit : l'ajout de pets (nouveaux artboards exportés d'office), un changement
d'artwork (suivi par le hash du `.riv`), un changement de résolution, le retour
d'un champ `sprite` dans les données de pets (on ne l'écrase pas).

Ne survit pas, mais échoue proprement (log + PNG existants conservés) : le
renommage de l'alias `rive/pets.riv` dans le manifest, celui de la state
machine `Pet State Machine`, un format Rive trop récent.

Ne survit pas et passe inaperçu : un **troisième pet à variante météo** — la
liste `ACTIVE_VARIANTS` est en dur dans `exportPetsFromRive.js`, on exporterait
le pet mais pas sa variante active. Et un second artboard non-pet ajouté au
fichier serait exporté comme un pet (on ne saute que l'artboard par défaut).
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

---

## 7. Les boucles animées

Le jeu ne produit **aucun fichier animé** : il rejoue le Rive en direct dans le
navigateur. Servir un pet qui bouge à un client qui n'embarquera jamais de
runtime Rive (un bot Discord, une page web, un overlay) est donc un usage
propre à l'API.

Sortie : `sprites_dump/animation/pets/<Espèce>_<clip>.webp`, servi sous
`/assets/animations/pets/…` et rattaché à chaque espèce dans `/data/pets`.

### Ce qu'on joue, et pourquoi pas la state machine

Les images fixes pilotent la state machine. Pour une boucle, non : la SM
enchaîne des états selon ses conditions, et **8 de ses 13 entrées sont des
triggers** (`walk`, `eat`, `petted`… cf. § 2), pas des booléens qu'on
maintiendrait. Impossible d'en tirer une boucle reproductible — mesuré : en
laissant la SM avancer, `ThunderWolf` filme la transition `Thunder_On` (l'éclair
qui apparaît, les yeux pas encore allumés) et la boucle ne raccorde pas.

On instancie donc la SM, on l'avance de 0 — c'est elle qui pose l'échelle du
pet et masque l'ombre au sol —, puis c'est une `LinearAnimationInstance` qui
pilote le temps. La timeline a une durée connue et boucle exactement sur
elle-même : première et dernière frame identiques à 0,2 % d'alpha près.

Pour les variantes météo, on amorce la SM de 4 s avant de capturer, comme les
PNG : on filme le régime établi (éclair présent, yeux jaunes) et pas
l'allumage. Contrepartie assumée : les VFX sont figés pendant que le corps
respire, faute d'une boucle propre qui les anime.

### Cadrage

Un cadre recalculé frame par frame ferait tressauter le sujet. On prend donc
**l'union des bbox du cycle**, symétrisée autour de l'axe de l'artboard comme
pour les images fixes (§ 3).

Cette union sort d'une passe de repérage qui rejoue le cycle entier à 160 px de
haut (~3 ms/frame, négligeable devant la passe finale) — *entier*, pas
échantillonné : c'est ce qui garantit qu'aucune frame ne se fait rogner. Un test
le vérifie pixel à pixel sur les quatre bords de chaque frame.

Cette passe sert aussi à **normaliser la taille** : le sujet occupe un tiers de
son artboard pour un poussin, la quasi-totalité pour un cheval. On rend donc
chaque espèce à la hauteur qui donne un sujet de 256 px, au lieu de rasteriser
beaucoup de vide et de sortir des tailles sans rapport entre elles.

### Clips retenus

`Pet_Idle` (7 s), `Pet_Walk` (0,6 s), `Pet_Eat` (1 s), `Pet_Sleep` (8 s) — les
états durables qui bouclent sur eux-mêmes. Les one-shots (`Pet_Mount`,
`Ability_Burst`, `Thunder_On`…) n'ont pas de sens en boucle. Les variantes
météo n'ont que l'idle.

**30 fps partout.** On avait commencé à 15 pour l'idle, pour tenir le poids des
fichiers : le pas se voit. Contre-intuitivement c'est sur les mouvements
*lents* qu'un échantillonnage bas saccade le plus — l'œil suit le mouvement et
voit chaque saut, là où un mouvement rapide masque le sien. Mesuré sur l'idle du
Chicken, à hauteur de sujet constante :

| fps | frames | poids |
|---|---|---|
| 15 | 105 | 466 Ko |
| 24 | 168 | 777 Ko |
| **30 (retenu)** | **210** | **970 Ko** |
| 60 (comme le jeu) | 420 | 1,9 Mo |

Le rendu, lui, ne bouge quasiment pas (~2 s par boucle à 15 comme à 30 fps :
l'amorçage domine). Et baisser la qualité WebP ne rattrape rien — de 75 à 65 on
ne gagne que 6 % pour une image visiblement plus sale. Le poids du fichier est
donc le seul vrai arbitrage, et il est linéaire en nombre de frames.

Attention au plafond `MAX_FRAMES` : il ne tronque pas la boucle, il en **abaisse
le fps**, donc en silence. Il doit rester au-dessus du clip le plus long
(`Pet_Sleep`, 8 s → 240 frames à 30 fps) ; en deçà, `renderArtboardAnimation`
loggue un avertissement plutôt que de laisser passer.

### Format

WebP par défaut : alpha 8 bits (ces sprites ont des bords adoucis et des ombres
translucides) et bien plus compact que le GIF. Le GIF reste générable
(`PET_ANIMATIONS_FORMATS=webp,gif`) pour les clients qui n'acceptent que lui, au
prix d'une palette de 256 couleurs et d'une transparence binaire — et du double
de volume sur disque.

**En near-lossless, pas en lossy.** C'est le piège de ce pipeline, et on est
tombé dedans : ces sprites sont du vectoriel — grands aplats, contours nets —,
exactement le contenu que le lossy traite le plus mal, et son sous-échantillonnage
de chrominance (4:2:0) fait déteindre les couleurs saturées sur les aplats
clairs. Le bec orange bavait sur le plumage crème. Mesuré sur l'idle du Chicken,
erreur par rapport au rendu source (moyenne / max, sur 255) :

| réglage | poids | err. moy. | err. max |
|---|---|---|---|
| lossy q75, 4:2:0 | 971 Ko | 3,10 | **85** |
| lossy q90, chroma pleine | 1 558 Ko | 1,78 | 72 |
| lossy q95, chroma pleine | 1 904 Ko | 1,51 | 63 |
| **near-lossless q20 (retenu)** | **1 545 Ko** | **0,55** | **8** |
| near-lossless q60 | 1 882 Ko | 0,16 | 2 |
| lossless | 2 137 Ko | 0 | 0 |

Le point à retenir : **monter la qualité du lossy ne sauve rien**. À poids
comparable (~1,9 Mo) il reste dix fois plus faux que le near-lossless. Il faut
changer de mode, pas de réglage. Le curseur est `PET_ANIMATIONS_QUALITY`
(défaut 20) ; q60 coûte +22 % pour un gain sous le seuil de perception.

`effort` reste à 4 : monter à 6 ne gagne que 3 % de poids pour 57 % de temps
d'encodage en plus.

Piège d'encodage : `sharp` n'applique un `delay` scalaire **qu'à la première
frame** et laisse les autres à 100 ms. Il faut un tableau de delays, un par
frame — et comme ce sont des entiers en millisecondes, on répartit l'arrondi
sur le cycle pour que leur somme rende la durée exacte de la timeline (67 ms ×
15 = 1005 ms, pas 1000).

### Coût

~40 s de CPU et ~1,5 Mo par boucle de 7 s à 30 fps en near-lossless (dont ~33 s
d'encodage : c'est lui qui domine, pas le rendu) ; **~100 Mo et ~50 min** pour le
jeu complet (28 espèces + 2 variantes). Le rendu Rive est du WASM **synchrone** : le faire dans le processus
de l'API bloquerait sa boucle d'événements tout ce temps. L'export tourne donc
dans un processus fils (`scripts/exportPetAnimations.js`, lancé par
`services/animationSync.js`), en priorité basse, et n'est pas attendu — les
boucles déjà sur disque restent servies pendant la regénération.

Il est **reprenable** : le sidecar retient l'URL du `.riv`, versionnée par hash,
donc une exécution interrompue reprend là où elle s'était arrêtée au lieu de
tout refaire. À l'inverse, un clip désactivé ou un pet retiré du jeu voit son
fichier supprimé — à ~470 Ko pièce, un orphelin ne se laisse pas traîner.

### Les espèces en avance sur le jeu

Le `.riv` est livré avec le client, donc il **précède les données du jeu**. À la
v824 il contient `Rooster` et `Hedgehog`, absents de `/data/pets`, et leurs
timelines complètes. Comme l'export rend tous les artboards sans se demander si
l'espèce existe, on avait déjà leurs PNG et leurs boucles sur disque : il ne
manquait que de les nommer.

`/data/pets` les expose donc, avec `released: false` et sans aucune statistique
— il n'en existe pas. Rien n'est deviné ni inventé : un nom d'artboard, une
image, des animations. Les variantes météo (`FireHorseActive`…) sont exclues de
cette liste : ce sont des états d'une espèce existante, reconnaissables au fait
que leur nom de rendu diffère de leur nom d'artboard.

Corollaire utile : le jour où le jeu sortira ces pets, ils basculeront tout seuls
du côté « données complètes » sans une ligne à changer.

### Le `.riv` comme ressource publiée

Chaque pet porte un bloc `rive` : l'URL du fichier (via `/assets/proxy`, seul
moyen pour un navigateur d'y accéder — `magicgarden.gg` n'envoie aucun en-tête
CORS), le nom de son artboard et celui de la state machine.

L'intérêt est un rapport de volume : **3 Mo pour les 28 espèces et leurs ~660
timelines**, contre ~100 Mo pour 4 clips par espèce en WebP. Un client capable
de faire tourner le runtime Rive a donc tout intérêt à jouer le fichier
directement — les WebP servent les clients qui ne savent qu'afficher une image
(embed Discord, README, mail, image Open Graph).

Ce qu'on publie, c'est surtout **ce qui ne se devine pas** : `Pet State Machine`,
les noms de timelines (repris dans chaque clip sous `timeline`), et le fait que
`sleep`/`fire`/`thunder` sont des booléens quand `walk`/`eat`/`petted` sont des
triggers. Un client qui coderait ça en dur casserait en silence à la prochaine
maj.

### Ce qui ne survit pas à une maj

Les mêmes cas qu'au § 5, plus un : les **noms de timelines** (`Pet_Idle`,
`Pet_Walk`…) sont en dur dans `PET_CLIPS`. Un renommage côté jeu ne casse rien
mais fait disparaître le clip en silence — `renderArtboardAnimation` retourne
`null` sur une timeline absente, ce qui est le comportement voulu pour une
espèce qui n'expose pas tous les états.


---

## 8. Les décors

Huit décors du jeu sont des artboards de `decor.riv` qui tournent en continu :
moulin, station météo, girouettes, chaudron, bain d'oiseaux, kiosque, fontaine.
Ils passent par le même moteur d'export que les pets
(`riveAnimationExport.js`) ; seule la fonction qui dresse la liste des rendus
change.

Sortie : `/assets/animations/decor/<Nom>_loop.webp`, rattachée à
`/data/decors`.

### Bien plus simples que les pets

Une seule timeline par artboard, et une state machine **sans aucune entrée** —
rien à piloter, pas de variantes, pas d'amorçage. Le rendu complet des huit
tient en **93 s pour 4,4 Mo**, contre ~50 min pour les pets.

### Trois pièges, tous liés au nommage

- **Les noms de timelines sont incohérents** : `WoodWindmill_On`,
  `WindSpinner_Spins`, `WindTurner`, `MarbleFountain_On`, `Caludron` (la faute
  de frappe est dans le fichier du jeu) et deux `Timeline 1`. Impossible d'en
  faire une table en dur : on lit ce que l'artboard déclare. Comme chacun n'en
  a qu'une, le clip est publié sous l'id `loop` plutôt qu'un slug illisible.
- **La casse ne concorde pas avec les données** : l'artboard s'appelle
  `StoneBirdBath`, la donnée du jeu `StoneBirdbath`. Le rapprochement se fait
  donc sans tenir compte de la casse — sinon ce décor perdrait son animation en
  silence, ce que rien n'aurait signalé.
- **Le nom de la state machine n'est pas garanti.** Elles s'appellent toutes
  `State Machine 1` aujourd'hui ; on lit celle que l'artboard porte, et
  `renderArtboardAnimation` accepte de rendre sans state machine du tout (un
  décor n'en a pas besoin, contrairement à un pet dont elle fixe l'échelle).

### Deux décors inédits

`WeatherStation` et `BoobooBooth` n'existent **que** dans le `.riv` : ni données
de jeu, ni sprite d'atlas. Comme `Rooster` et `Hedgehog` côté pets, ils sortent
dans `/data/decors` avec `released: false` et leur animation pour seule
représentation.
