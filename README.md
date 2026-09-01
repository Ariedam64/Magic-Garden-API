# Magic Garden API

> **Unofficial API** for [Magic Garden](https://magicgarden.gg) that fetches game data **dynamically** and **future-proof**.

## Concept

This API automatically extracts game data from **two sources**:

### **Minified bundle** → Static game data
Automatic extraction from the game's minified JavaScript file (`main-*.js`):
- Plants, seeds, crops
- Pets and eggs
- Items and decorations
- Mutations
- Special abilities
- Weathers

### **Official platform API** → Live data
Polling of the game's own `/platform/v1` endpoints for dynamic data:
- Current shops (inventory, exact restock date, countdown)
- Current weather

## Advantages

- **Future-proof**: Automatically adapts to game updates
- **No maintenance**: No need to manually update data
- **Live data**: Shops and weather from the game's official API, restock dates included
- **Sprites included**: URLs and direct sprite downloads
- **Smart cache**: Optimal performance

## Hosted API

Production base URL: `https://mg-api.ariedam.fr`  
Documentation: `https://mg-api.ariedam.fr/docs`

## Quick Start

### Requirements

- Node.js >= 18

### Installation

```bash
npm install
```

### Launch

```bash
# Development mode (with watch)
npm run dev

# Production mode
npm start
```

The server starts on `http://localhost:3000`

## Main Endpoints

### Game data (bundle)

| Endpoint | Description |
|----------|-------------|
| `GET /data` | All game data (plants, pets, items, decor, eggs, mutations, abilities) |
| `GET /data/plants` | Complete plants (seed/plant/crop + sprites) |
| `GET /data/pets` | Companion pets with sprites |
| `GET /data/items` | Items and equipment with sprites |
| `GET /data/decors` | Decorations with sprites |
| `GET /data/mutations` | Plant mutations with sprites |
| `GET /data/eggs` | Animal eggs with sprites |
| `GET /data/abilities` | Special abilities |
| `GET /data/weathers` | Weather definitions with sprites |
| `GET /data/weather-groups` | Weather scheduling engine: duration, time slots and weighted drop table per group (Hydro, Lunar) |
| `GET /data/enums` | Canonical game enums (rarity, currency, eligibleShops, itemType, weather, mutationTierOrder) |

### CSV / TSV Export

Every data and live endpoint is also available in **CSV** (`.csv`) and **TSV** (`.tsv`) format by appending the extension to the URL. For example: `/data/plants.csv`, `/data/pets.tsv`, `/live/shops.csv`. Ideal for Excel, Google Sheets (`=IMPORTDATA(...)`), or any spreadsheet tool.

### Assets

| Endpoint | Description |
|----------|-------------|
| `GET /assets/sprite-data` | Sprite metadata (with search) |
| `GET /assets/cosmetics` | Cosmetic data |
| `GET /assets/audios` | Audio data |
| `GET /assets/sprites` | List available sprite categories |
| `GET /assets/sprites/:category/:name` | Download individual sprite PNG |
| `GET /assets/sprites/composed?key=…&mutations=…` | Pre-composed PNG with mutations applied |
| `GET /assets/animations` | Catalog of animated loops (pets + decor) |
| `GET /assets/animations/:category/:name_:clip.webp` | Download one looping animation |
| `GET /assets/rive` | The game's Rive (vector) files and what they contain |

**Available sprite categories**: `seeds`, `plants`, `tallPlants`, `mutations`, `pets`, `decor`, `items`, `objects`, `ui`, `animations`, `weather`, `tiles`, `winter`

Note: `/assets/sprite-data`, `/assets/cosmetics`, and `/assets/audios` return URLs pointing to the game's versioned asset base. `/assets/sprites` serves PNGs from this API (controlled by `SPRITES_BASE_URL`).

Pets are the only creatures the game renders as vectors (`rive/pets.riv`) rather than sprites, so on top of the still PNG the API serves them **animated**: one looping WebP per species and per state (`idle`, `walk`, `eat`, `sleep`). Each pet also carries a `rive` block - the vector source itself, for clients that can render it live: 3 MB covers every species and all their timelines. And because that file ships ahead of the game data, `/data/pets` lists species the game has not released yet, flagged `released: false`.

The eight animated decorations (windmill, fountain, cauldron, …) get the same treatment from `rive/decor.riv`, attached to `/data/decors` - including `WeatherStation` and `BoobooBooth`, which exist only in the Rive file. The loops are pre-rendered when the game ships a new pet file and served as plain files - drop the URL in an `<img>` tag and it plays, no runtime needed. They are also attached to each species in `/data/pets` under `animations`. See `doc-rive.md` §7.

The composed endpoint accepts a full atlas key (e.g. `sprite/tallplant/Cactus`) and an optional comma-separated list of mutations. It returns a single PNG with all layers merged (color filters, icons, overlays). See `doc-sprite.md` for the full spec.

### Live data (Real-time via SSE)

| Endpoint | Description |
|----------|-------------|
| `GET /live` | All live data snapshot (weather + shops) |
| `GET /live/weather` | Current weather snapshot |
| `GET /live/shops` | Current shops snapshot |
| `GET /live/health` | Poller freshness + SSE connection stats |
| `GET /live/stream` | Weather + shops updates via Server-Sent Events |
| `GET /live/weather/stream` | Weather updates via Server-Sent Events |
| `GET /live/shops/stream` | Shop updates via Server-Sent Events |

### Stats (Aggregated history)

Backed by a local SQLite history of every shop restock and weather transition observed since the recorder was first enabled. Useful for drop-rate dashboards, weather distributions, and intra-bucket timelines.

| Endpoint | Description |
|----------|-------------|
| `GET /stats/items` | Per-item rarity stats for a shop (appearances, drop rate, stock distribution, last seen) |
| `GET /stats/items/timeseries` | Drop rate / appearances / avg stock per time bucket for one or more items |
| `GET /stats/weather` | Weather distribution over a window (total duration, share, occurrences, avg duration) |
| `GET /stats/weather/timeseries` | Weather durations per time bucket (stacked-area-friendly) |
| `GET /stats/weather/events` | Raw weather event timeline clamped to the window |
| `GET /stats/shops/restocks` | Raw shop restock timeline with embedded items (supports `ids` filter) |

**Common query parameters:**
- `shop` (required for `/stats/items*` and `/stats/shops/restocks`): any shop id listed by `/data/enums` -> `eligibleShops` (`seed`, `tool`, `egg`, `decor`, `rain`, `dawn`, `amber`, `snow`, `thunder`, ...)
- `from` / `to`: epoch ms or ISO 8601 (default: last 30 days)
- `bucket` (timeseries only): `hour`, `day`, `week` (UTC-aligned, hard cap 10 000 buckets per response)
- `ids` (optional, comma-separated): restrict `/stats/items/timeseries` and `/stats/shops/restocks` to specific item ids
- `limit` / `order`: paging on raw event endpoints

### Health & Information

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server and connection status |
| `GET /health/ready` | Readiness probe (checks if bundle is cached) |
| `GET /health/live` | Liveness probe |
| `GET /docs` | Swagger UI documentation |
| `GET /docs/openapi.json` | OpenAPI specification (JSON) |

## Usage Examples

### Get all game data

```bash
curl http://localhost:3000/data | jq
```

**Response structure:**
```json
{
  "plants": { ... },
  "pets": { ... },
  "items": { ... },
  "decor": { ... },
  "eggs": { ... },
  "mutations": { ... },
  "abilities": { ... },
  "weathers": { ... },
  "weatherGroups": { ... },
  "enums": { ... }
}
```

### Get plant data

```bash
curl http://localhost:3000/data/plants | jq '.Carrot'
```

**Response:**
```json
{
  "seed": {
    "name": "Carrot Seed",
    "coinPrice": 10,
    "sprite": "http://localhost:3000/assets/sprites/seeds/Carrot.png"
  },
  "plant": {
    "name": "Carrot Plant",
    "harvestType": "Single",
    "sprite": "http://localhost:3000/assets/sprites/plants/BabyCarrot.png"
  },
  "crop": {
    "name": "Carrot",
    "baseSellPrice": 20,
    "sprite": "http://localhost:3000/assets/sprites/plants/Carrot.png"
  }
}
```

### Search for a sprite

```bash
curl "http://localhost:3000/assets/sprite-data?search=Carrot&cat=seeds"
```

### List sprite categories

```bash
curl http://localhost:3000/assets/sprites
```

### Download a sprite

```bash
curl http://localhost:3000/assets/sprites/seeds/Carrot.png -o carrot.png
```

### Get live shop data

```bash
curl http://localhost:3000/live/shops | jq
```

### Stream live updates (SSE)

```bash
curl -N http://localhost:3000/live/stream
```

SSE events are named `weather` and `shops`. Use `addEventListener` to subscribe.

### Live health (SSE stats)

```bash
curl http://localhost:3000/live/health | jq
```

```javascript
const liveStream = new EventSource('http://localhost:3000/live/stream');
liveStream.addEventListener('weather', (event) => {
  const data = JSON.parse(event.data);
  console.log('Weather:', data.weather);
});

liveStream.addEventListener('shops', (event) => {
  const shops = JSON.parse(event.data);
  console.log('Seed shop:', shops.seed);
});
```

You can also subscribe to specific streams with `/live/weather/stream` or `/live/shops/stream`.

### Get canonical enums

```bash
curl http://localhost:3000/data/enums | jq
```

**Response:**
```json
{
  "rarity": ["Common", "Uncommon", "Rare", "Legendary", "Mythical", "Divine", "Celestial"],
  "currency": ["coins", "credits", "magicDust"],
  "eligibleShops": ["seed", "egg", "tool", "decor", "dawn"],
  "itemType": ["Seed", "Produce", "Plant", "Tool", "Pet", "Egg", "Decor"],
  "weather": ["Rain", "Frost", "Thunderstorm", "Dawn", "AmberMoon"],
  "mutationTierOrder": ["Wet", "Chilled", "Frozen", "Thunderstruck", "Dawnlit", "Ambershine", "Dawncharged", "Ambercharged"]
}
```

### Query aggregated stats

```bash
# Top rare seeds over the last 30 days (sorted rarest first by default)
curl "http://localhost:3000/stats/items?shop=seed" | jq

# Daily drop rate of Carrot vs Strawberry over a custom window
curl "http://localhost:3000/stats/items/timeseries?shop=seed&ids=Carrot,Strawberry&bucket=day&from=2026-04-01&to=2026-05-01" | jq

# Weather distribution over the last week
curl "http://localhost:3000/stats/weather?from=2026-05-12&to=2026-05-19" | jq

# Find every restock containing a specific Celestial seed
curl "http://localhost:3000/stats/shops/restocks?shop=seed&ids=Starweaver&limit=20" | jq
```

### Export data as CSV / TSV

Append `.csv` or `.tsv` to any data or live endpoint (e.g. `/data/plants.csv`, `/live/shops.tsv`).

```bash
curl https://mg-api.ariedam.fr/data/pets.csv -o pets.csv
```

In Google Sheets: `=IMPORTDATA("https://mg-api.ariedam.fr/data/pets.csv")`

## Technical Architecture

```
┌─────────────────────────────────────────────┐
│           Magic Garden Game                 │
│  ┌──────────────┐      ┌───────────────┐   │
│  │ Bundle JS    │      │  Platform API │   │
│  │ (minified)   │      │ /platform/v1  │   │
│  └──────┬───────┘      └───────┬───────┘   │
└─────────┼──────────────────────┼───────────┘
          │                      │
          ▼                      ▼
┌─────────────────────────────────────────────┐
│              MG API Server                  │
│                                             │
│  ┌─────────────┐      ┌─────────────────┐  │
│  │   Bundle    │      │  Live Poller    │  │
│  │ Extraction  │      │                 │  │
│  │             │      │ • Shops+weather │  │
│  │ • Resolver  │      │ • Restock-aware │  │
│  │ • Extractor │      │ • Normalizing   │  │
│  │ • Sandbox   │      │ • Event stream  │  │
│  └──────┬──────┘      └────────┬────────┘  │
│         │                      │           │
│         ▼                      ▼           │
│  ┌─────────────────────────────────────┐   │
│  │         Cache & Services            │   │
│  │  • Game data (5min TTL)             │   │
│  │  • Sprite resolution                │   │
│  │  • Live data normalizing            │   │
│  └──────────────┬──────────────────────┘   │
│                 │                          │
│                 ▼                          │
│  ┌─────────────────────────────────────┐   │
│  │         REST API + SSE              │   │
│  │  • /data/*     (bundle data)        │   │
│  │  • /assets/*   (sprites, cosmetics) │   │
│  │  • /live       (real-time via SSE)  │   │
│  │  • /stats/*    (history aggregates) │   │
│  │  • /health     (monitoring)         │   │
│  │  • /docs       (OpenAPI/Swagger)    │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Key Components

- **Bundle Resolver**: Detects and downloads the game's JS bundle
- **Extractors**: Parse data from the minified bundle (regex + VM sandbox)
- **Live Poller**: Polls the game's official `/platform/v1/{shops,weather}` endpoints, and wakes up right on each `nextRestockAt` the game announces
- **Normalizers**: Map the official payloads onto our public shape
- **Version Watcher**: Polls `/platform/v1/version` and resyncs sprites on a game update
- **SSE Streams**: Real-time data streaming via Server-Sent Events
- **Sprite Sync**: Automatic sprite synchronization
- **Cache**: Smart caching with automatic invalidation
- **API Routes**: RESTful endpoints for static data + SSE for live data

## Configuration

Environment variables (create a `.env` file):

```env
# Server
HOST=0.0.0.0
PORT=3000
NODE_ENV=development

# Cache (in milliseconds)
CACHE_BUNDLE_TTL=300000
CACHE_MANIFEST_TTL=600000

# Live polling of the game's official API
PLATFORM_POLL_INTERVAL=15000
PLATFORM_FAST_POLL_INTERVAL=5000
PLATFORM_MAX_BACKOFF=60000
PLATFORM_TIMEOUT=8000

# Game update detection (sprite resync)
VERSION_WATCH_ENABLED=true
VERSION_WATCH_INTERVAL=60000
VERSION_WATCH_RESTART=true

# CORS
CORS_ENABLED=true
CORS_ORIGIN=*

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Game origin
GAME_ORIGIN=https://magicgarden.gg
GAME_PAGE_URL=https://magicgarden.gg/r/test

# Logging
LOG_LEVEL=info

# Sprites
SPRITES_EXPORT_DIR=./sprites_dump
SPRITES_BASE_URL=http://localhost:3000

# Pet animations (looping WebP/GIF rendered from the game's Rive file)
PET_ANIMATIONS_ENABLED=true
PET_ANIMATIONS_FORMATS=webp        # add ",gif" to also generate GIFs (doubles disk usage)
PET_ANIMATIONS_HEIGHT=256          # rendered subject height, in pixels
PET_ANIMATIONS_QUALITY=20          # WebP near-lossless level (lower = smaller)
PET_ANIMATIONS_CLIPS=idle,walk,eat,sleep
```

Animations are rendered at 30 fps, near-lossless, in a background child process when the game's pet file changes (~100 MB and ~50 minutes for the full set). `PET_ANIMATIONS_QUALITY` is a near-lossless level, not a lossy quality - lossy is a poor fit for this flat vector art, see `doc-rive.md` §7. Run it by hand with `npm run export:animations -- --force`.

Set `CORS_ENABLED=false` or `RATE_LIMIT_ENABLED=false` to disable those features. SSE streams use a separate limiter (defaults to `RATE_LIMIT_MAX / 10` per window).

## Limitations & Warnings

- **Unofficial API** - Not affiliated with the game developers
- **Personal use only** - Do not use commercially
- **Respect ToS** - Follow the game's terms of service
- **Dynamic data** - The API adapts automatically but may break during major changes

## Statistics

- Counts vary by game version and bundle updates
- Use `/data` and `/assets/sprite-data` to inspect current totals

## License

ISC

---

**Developed by:** [@Ariedam64](https://github.com/Ariedam64)
**Game:** [Magic Garden](https://magicgarden.gg) / [Magic Circle](https://magiccircle.gg)
