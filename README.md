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

## Quick Start

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
| `GET /data/decor` | Decorations with sprites |
| `GET /data/mutations` | Plant mutations with sprites |
| `GET /data/eggs` | Animal eggs with sprites |
| `GET /data/abilities` | Special abilities |

### Assets

| Endpoint | Description |
|----------|-------------|
| `GET /assets/sprite-data` | Sprite metadata (with search) |
| `GET /assets/cosmetics` | Cosmetic data |
| `GET /assets/audios` | Audio data |
| `GET /assets/sprites` | List available sprite categories |
| `GET /assets/sprites/:category/:name` | Download individual sprite PNG |

**Available sprite categories**: `seeds`, `plants`, `tallPlants`, `mutations`, `pets`, `decor`, `items`, `objects`, `ui`, `animations`, `weather`, `tiles`, `winter`

### Live data (Real-time via SSE)

| Endpoint | Description |
|----------|-------------|
| `GET /live` | All live data snapshot (weather + shops) |
| `GET /live/weather` | Current weather snapshot |
| `GET /live/shops` | Current shops snapshot |
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
  "abilities": { ... }
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

### Stream weather updates (SSE)

```bash
curl -N http://localhost:3000/live/weather/stream
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
PORT=3000
NODE_ENV=development

# Bundle cache (in milliseconds)
BUNDLE_TTL=300000

# WebSocket
WS_AUTO_RECONNECT=true
WS_MAX_RETRIES=999

# CORS
CORS_ENABLED=true
CORS_ORIGIN=*

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# Sprites
SPRITES_EXPORT_DIR=./sprites_dump
```

## Limitations & Warnings

- **Unofficial API** - Not affiliated with the game developers
- **Personal use only** - Do not use commercially
- **Respect ToS** - Follow the game's terms of service
- **Dynamic data** - The API adapts automatically but may break during major changes

## Statistics

- 42+ extractable plants
- 1000+ available sprites
- 12 data categories
- API latency < 100ms (with cache)

## License

ISC

---

**Developed by:** [@Ariedam64](https://github.com/Ariedam64)
**Game:** [Magic Garden](https://magicgarden.gg) / [Magic Circle](https://magiccircle.gg)
