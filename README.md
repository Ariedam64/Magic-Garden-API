# MG API - Unofficial Magic Garden API

An unofficial API server that extracts and distributes game data from both the minified bundle and live WebSocket connection via REST endpoints, with automatic sprite resolution.

## 🎮 Features

### REST API - Game Data (Bundle)
Automatic extraction of raw data from the game's minified bundle:
- **Plants** (`/data/plants`) - Seeds, plants, and crops with sprites
- **Pets** (`/data/pets`) - Companion animals
- **Items** (`/data/items`) - Objects and equipment
- **Decor** (`/data/decor`) - Decoration elements
- **Mutations** (`/data/mutations`) - Plant mutations
- **Eggs** (`/data/eggs`) - Animal eggs
- **Abilities** (`/data/abilities`) - Special abilities

### Assets - Game Sprites
- **Sprites** (`/data/sprites`) - Sprite metadata with search functionality
- **Cosmetics** (`/data/cosmetics`) - Cosmetic data
- **Audios** (`/data/audios`) - Audio data

### Physical Sprites
- **GET `/sprites/:category/:name.png`** - Download individual sprites
  - Categories: `seeds`, `plants`, `tallPlants`, `mutations`, `pets`, `decor`, `items`, `objects`, `ui`, `animations`, `weather`, `tiles`, `winter`

### WebSocket - Live Data
- **`GET /live`** - WebSocket connection to game server
  - Real-time shop
  - Current weather
  - Plant states
  - Growth events

### Health Check
- **`GET /health`** - Server status and connection status
- **`GET /version`** - Current game bundle version

## 🛠️ Architecture

```
src/
├── api/              # Express routes and middleware
├── core/
│   ├── bundle/       # Minified bundle extraction (regex + VM sandbox)
│   ├── extractors/   # Specific extractors (plants, pets, items, etc.)
│   ├── parsers/      # WebSocket parsers (shop, weather)
│   └── websocket/    # WebSocket connection management
├── services/         # Business logic layer
│   ├── gameData.js          # Game data access (cached)
│   ├── plantTransformer.js  # Sprite resolution for plants
│   ├── dataTransformer.js   # Generic sprite resolution
│   ├── liveData.js          # WebSocket data parsing
│   └── spriteSync.js        # Automatic sprite synchronization
├── assets/           # Asset management (sprites, manifests)
├── utils/            # Utilities
│   ├── spriteNameMatcher.js # Fuzzy matching (Levenshtein)
│   └── spriteUrlBuilder.js  # Sprite URL construction
└── config/           # Configuration (environment overridable)
```

## 📦 Installation

```bash
npm install
```

## 🚀 Getting Started

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The server starts on `http://localhost:3000` by default.

## 📡 Usage Examples

### Get plant data with sprites
```bash
curl http://localhost:3000/data/plants | jq '.Carrot'
```

Response:
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
curl "http://localhost:3000/data/sprites?search=Carrot&cat=seeds&flat=1"
```

### Download a sprite
```bash
curl http://localhost:3000/sprites/seeds/Carrot.png -o carrot.png
```

### WebSocket connection (live data)
```bash
wscat -c ws://localhost:3000/live
```

## 🔍 Technical Details

### Bundle Extraction

1. **Resolution** - Fetches game HTML page and extracts minified bundle URL
2. **Download** - Retrieves `main-*.js` from game server
3. **Signature Search** - Uses regex patterns to locate data
   - Example: `seed:{tileRef`, `plant:{tileRef`, `crop:{tileRef`
4. **Extraction** - Extracts minified JSON with balanced braces
5. **VM Sandbox** - Executes code in a Node.js sandbox
   - Resolves minified enums (Rarity, HarvestType, TileRef, Weather)
   - Uses proxies to retrieve enum names

### Sprite Resolution

- **Seeds** → always in `seeds/`
- **Plants/Crops** → checks `tallPlants/` first, then fallback to `plants/`
- **Fuzzy Matching** - Levenshtein distance to handle name variations

### Caching

- Bundle: 5 minutes (automatically invalidated if version changes)
- Categories: 5 minutes
- Sprites: In-memory (manual refresh via `/api/sync-sprites`)

## 🔧 Configuration

Environment variables (`.env`):

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# Bundle
BUNDLE_TTL=300000

# Sprites
SPRITES_EXPORT_DIR=./sprites_dump
SPRITES_BASE_URL=http://localhost:3000

# CORS
CORS_ENABLED=true
CORS_ORIGIN=*

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# WebSocket
WS_AUTO_RECONNECT=true
WS_MAX_RETRIES=999
```

## 📊 Statistics

- **42+ plants** extractable
- **1000+ sprites** available
- **12 data categories**
- **API latency** < 100ms (cached)

## ⚠️ Important

- **Unofficial API** - Not affiliated with game developers
- **Personal Use** - Do not use commercially
- **Respect ToS** - Follow game terms of service
- **Dynamic Data** - Automatically updated with game versions

## 📝 License

MIT - See LICENSE

---

**Developed by:** [@Ariedam64](https://github.com/Ariedam64)
**Game:** [Magic Garden](https://magicgarden.gg) / [Magic Circle](https://magiccircle.gg)
