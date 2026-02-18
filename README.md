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

### **Live WebSocket** → Real-time data
Connection to the game server to retrieve dynamic data:
- Current shop
- Current weather

## Advantages

- **Future-proof**: Automatically adapts to game updates
- **No maintenance**: No need to manually update data
- **Real-time**: WebSocket for live data
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

### CSV Export

Every data and live endpoint is also available in CSV format by appending `.csv` to the URL. Ideal for Excel, Google Sheets, or any spreadsheet tool.

| Endpoint | Description |
|----------|-------------|
| `GET /data.csv` | All game data combined (with `category` column) |
| `GET /data/plants.csv` | Plants (seed/plant/crop flattened with dot notation) |
| `GET /data/pets.csv` | Pets with stats and ability weights |
| `GET /data/items.csv` | Items and equipment |
| `GET /data/decors.csv` | Decorations |
| `GET /data/eggs.csv` | Pet eggs |
| `GET /data/abilities.csv` | Special abilities |
| `GET /data/mutations.csv` | Plant mutations |
| `GET /data/weathers.csv` | Weather definitions |
| `GET /live.csv` | Current weather + shops combined |
| `GET /live/weather.csv` | Current weather |
| `GET /live/shops.csv` | Current shop inventories |

### Assets

| Endpoint | Description |
|----------|-------------|
| `GET /assets/sprite-data` | Sprite metadata (with search) |
| `GET /assets/cosmetics` | Cosmetic data |
| `GET /assets/audios` | Audio data |
| `GET /assets/sprites` | List available sprite categories |
| `GET /assets/sprites/:category/:name` | Download individual sprite PNG |

**Available sprite categories**: `seeds`, `plants`, `tallPlants`, `mutations`, `pets`, `decor`, `items`, `objects`, `ui`, `animations`, `weather`, `tiles`, `winter`

Note: `/assets/sprite-data`, `/assets/cosmetics`, and `/assets/audios` return URLs pointing to the game's versioned asset base. `/assets/sprites` serves PNGs from this API (controlled by `SPRITES_BASE_URL`).

### Live data (Real-time via SSE)

| Endpoint | Description |
|----------|-------------|
| `GET /live` | All live data snapshot (weather + shops) |
| `GET /live/weather` | Current weather snapshot |
| `GET /live/shops` | Current shops snapshot |
| `GET /live/health` | SSE connection stats |
| `GET /live/stream` | Weather + shops updates via Server-Sent Events |
| `GET /live/weather/stream` | Weather updates via Server-Sent Events |
| `GET /live/shops/stream` | Shop updates via Server-Sent Events |

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
  "weathers": { ... }
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

### Export data as CSV

```bash
# Download pets data as CSV
curl https://mg-api.ariedam.fr/data/pets.csv -o pets.csv

# Open plants data directly in Excel (Windows)
start https://mg-api.ariedam.fr/data/plants.csv
```

In Excel, use **Data > From Web** and paste the URL (e.g. `https://mg-api.ariedam.fr/data/pets.csv`) to create an auto-refreshing data connection.

In Google Sheets:
```
=IMPORTDATA("https://mg-api.ariedam.fr/data/pets.csv")
```

## Technical Architecture

```
┌─────────────────────────────────────────────┐
│           Magic Garden Game                 │
│  ┌──────────────┐      ┌───────────────┐   │
│  │ Bundle JS    │      │   WebSocket   │   │
│  │ (minified)   │      │   (live game) │   │
│  └──────┬───────┘      └───────┬───────┘   │
└─────────┼──────────────────────┼───────────┘
          │                      │
          ▼                      ▼
┌─────────────────────────────────────────────┐
│              MG API Server                  │
│                                             │
│  ┌─────────────┐      ┌─────────────────┐  │
│  │   Bundle    │      │   WebSocket     │  │
│  │ Extraction  │      │   Connection    │  │
│  │             │      │                 │  │
│  │ • Resolver  │      │ • Auto-reconnect│  │
│  │ • Extractor │      │ • Live parsing  │  │
│  │ • Sandbox   │      │ • Event stream  │  │
│  └──────┬──────┘      └────────┬────────┘  │
│         │                      │           │
│         ▼                      ▼           │
│  ┌─────────────────────────────────────┐   │
│  │         Cache & Services            │   │
│  │  • Game data (5min TTL)             │   │
│  │  • Sprite resolution                │   │
│  │  • Live data parsing                │   │
│  └──────────────┬──────────────────────┘   │
│                 │                          │
│                 ▼                          │
│  ┌─────────────────────────────────────┐   │
│  │         REST API + SSE              │   │
│  │  • /data/*     (bundle data)        │   │
│  │  • /assets/*   (sprites, cosmetics) │   │
│  │  • /live       (real-time via SSE)  │   │
│  │  • /health     (monitoring)         │   │
│  │  • /docs       (OpenAPI/Swagger)    │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Key Components

- **Bundle Resolver**: Detects and downloads the game's JS bundle
- **Extractors**: Parse data from the minified bundle (regex + VM sandbox)
- **WebSocket Connection**: Connection to game server with auto-reconnect
- **Parsers**: Interpret live WebSocket messages
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

# WebSocket reconnection
WS_AUTO_RECONNECT=true
WS_MAX_RETRIES=999
WS_MIN_DELAY=500
WS_MAX_DELAY=8000

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
```

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
