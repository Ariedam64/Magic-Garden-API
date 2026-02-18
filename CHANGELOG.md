# Changelog

## v2.1.0 - CSV Export Endpoints

### Added

- **CSV export for all data endpoints** — Every `/data` and `/live` endpoint now supports a `.csv` variant for direct spreadsheet integration.

  | Endpoint | Description |
  |----------|-------------|
  | `GET /data.csv` | All game data combined into a single CSV (with `category` column) |
  | `GET /data/plants.csv` | Plants with flattened seed/plant/crop columns |
  | `GET /data/pets.csv` | Pets with all stats and ability weights |
  | `GET /data/items.csv` | Tools and consumables |
  | `GET /data/decors.csv` | Garden decorations |
  | `GET /data/eggs.csv` | Pet eggs |
  | `GET /data/abilities.csv` | Special abilities |
  | `GET /data/mutations.csv` | Plant mutations |
  | `GET /data/weathers.csv` | Weather definitions |
  | `GET /live.csv` | Current weather and shop inventories |
  | `GET /live/weather.csv` | Current weather snapshot |
  | `GET /live/shops.csv` | Current shop inventories |

- **Designed for Excel and Google Sheets users** who want their game data to stay constantly up to date. Simply point a Web data source or `IMPORTDATA()` to any `.csv` endpoint and the spreadsheet will auto-refresh with the latest game data.

- **Smart flattening** — Nested JSON objects are flattened using dot notation (e.g., `seed.name`, `plant.sprite`, `innateAbilityWeights.SeedFinderI`). Arrays are serialized as JSON strings within cells.

- **Same caching as JSON endpoints** — CSV responses benefit from the same ETag and Cache-Control headers, ensuring efficient caching and conditional requests.

### How to use

**Download a CSV file:**
```bash
curl https://mg-api.ariedam.fr/data/pets.csv -o pets.csv
```

**Excel — Power Query (auto-refresh):**
1. Go to **Data > From Web**
2. Enter the URL: `https://mg-api.ariedam.fr/data/plants.csv`
3. Excel will import and can refresh the data on demand or on a schedule

**Google Sheets:**
```
=IMPORTDATA("https://mg-api.ariedam.fr/data/pets.csv")
```

### Technical details

- New utility: `src/utils/csvConverter.js` handles JSON-to-CSV conversion with automatic object flattening
- CSV responses use `Content-Type: text/csv; charset=utf-8` and include a `Content-Disposition` header with a suggested filename
- All existing JSON endpoints remain unchanged — CSV is purely additive
