# Magic Garden API

> **Unofficial API** for [Magic Garden](https://magicgarden.gg) that fetches game data **dynamically** and **future-proof**.

## Concept

This API automatically extracts game data from **two sources**:

### **Minified bundle** → Static data (raw data)
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
- Plant states
- Growth events

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
| `GET /data/plants` | Complete plants (seed/plant/crop + sprites) |
| `GET /data/pets` | Companion pets |
| `GET /data/items` | Items and equipment |
| `GET /data/decor` | Decorations |
| `GET /data/mutations` | Plant mutations |
| `GET /data/eggs` | Animal eggs |
| `GET /data/abilities` | Special abilities |

### Assets

| Endpoint | Description |
|----------|-------------|
| `GET /data/sprites` | Sprite metadata (with search) |
| `GET /data/cosmetics` | Cosmetic data |
| `GET /data/audios` | Audio data |
| `GET /sprites/:category/:name.png` | Download individual sprite |

**Available sprite categories**: `seeds`, `plants`, `tallPlants`, `mutations`, `pets`, `decor`, `items`, `objects`, `ui`, `animations`, `weather`, `tiles`, `winter`

### Live (WebSocket)

| Endpoint | Description |
|----------|-------------|
| `GET /live` | WebSocket for real-time data (shop, weather) |

### Information

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server and connection status |
| `GET /version` | Current game bundle version |
| `GET /docs` | Swagger documentation |

## Usage Examples

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
    "sprite": "http://localhost:3000/sprites/seeds/Carrot.png"
  },
  "plant": {
    "name": "Carrot Plant",
    "harvestType": "Single",
    "sprite": "http://localhost:3000/sprites/plants/BabyCarrot.png"
  },
  "crop": {
    "name": "Carrot",
    "baseSellPrice": 20,
    "sprite": "http://localhost:3000/sprites/plants/Carrot.png"
  }
}
```

### Search for a sprite

```bash
curl "http://localhost:3000/data/sprites?search=Carrot&cat=seeds"
```

### Download a sprite

```bash
curl http://localhost:3000/sprites/seeds/Carrot.png -o carrot.png
```

### Connect to WebSocket

```bash
wscat -c ws://localhost:3000/live
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
│  │         REST API + WS               │   │
│  │  • /data/*     (bundle data)        │   │
│  │  • /sprites/*  (assets)             │   │
│  │  • /live       (websocket)          │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Key Components

- **Bundle Resolver**: Detects and downloads the game's JS bundle
- **Extractors**: Parse data from the minified bundle (regex + VM sandbox)
- **WebSocket Connection**: Connection to game server with auto-reconnect
- **Parsers**: Interpret live WebSocket messages
- **Sprite Sync**: Automatic sprite synchronization
- **Cache**: Smart caching with automatic invalidation

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
