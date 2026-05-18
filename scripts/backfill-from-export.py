#!/usr/bin/env python3
"""
Backfill data/history.sqlite from JSON exports in `new export/`.

Idempotent: relies on UNIQUE (shop_type, restocked_at) and UNIQUE (started_at)
constraints — re-running is safe.

After inserting weather events, we repair `ended_at` for any row whose
`ended_at` now overlaps a newly inserted row (i.e. the row's end should be
clipped to the next event's start).
"""

import json
import re
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path("/srv/Magic-Garden-API/data/history.sqlite")
EXPORT_DIR = Path("/srv/Magic-Garden-API/new export")

WEATHER_NAME_MAP = {
    "Sunny": "Clear Skies",
    "Frost": "Snow",
    "AmberMoon": "Amber Moon",
    # Pass-through (already match DB display names)
    "Rain": "Rain",
    "Snow": "Snow",
    "Thunderstorm": "Thunderstorm",
    "Dawn": "Dawn",
}


def parse_item(s: str) -> tuple[str, int]:
    m = re.match(r"^(.+?)\s+x(\d+)$", s.strip())
    if m:
        return m.group(1), int(m.group(2))
    return s.strip(), 1


def load_restocks() -> dict[str, list[dict]]:
    merged: dict[str, list[dict]] = {}
    for fname in ("export-restock-early (1).json", "export-restock-full (1).json"):
        with open(EXPORT_DIR / fname) as fp:
            d = json.load(fp)
        for shop, entries in d.items():
            merged.setdefault(shop, []).extend(entries)
    return merged


def load_weather() -> list[dict]:
    with open(EXPORT_DIR / "export-weather-events (1).json") as fp:
        return json.load(fp)


def backfill_restocks(conn: sqlite3.Connection) -> tuple[int, int]:
    """Returns (restocks_inserted, items_inserted)."""
    cur = conn.cursor()
    restocks_inserted = 0
    items_inserted = 0

    for shop, entries in load_restocks().items():
        for entry in entries:
            ts = entry["timestamp"]
            # Check if a restock already exists at that timestamp (allow some drift)
            row = cur.execute(
                "SELECT id FROM shop_restocks WHERE shop_type=? AND restocked_at BETWEEN ? AND ?",
                (shop, ts - 500, ts + 1000),
            ).fetchone()
            if row:
                continue  # already present (or close enough)
            # Insert
            cur.execute(
                "INSERT INTO shop_restocks (shop_type, restocked_at) VALUES (?, ?)",
                (shop, ts),
            )
            rid = cur.lastrowid
            restocks_inserted += 1
            for raw in entry["items"]:
                name, stock = parse_item(raw)
                # ON CONFLICT DO NOTHING via INSERT OR IGNORE — same primary key (restock_id, item_id)
                cur.execute(
                    "INSERT OR IGNORE INTO shop_restock_items (restock_id, item_id, stock) VALUES (?, ?, ?)",
                    (rid, name, stock),
                )
                items_inserted += cur.rowcount
    return restocks_inserted, items_inserted


def backfill_weather(conn: sqlite3.Connection) -> tuple[int, int]:
    """Returns (events_inserted, ended_at_repaired)."""
    cur = conn.cursor()
    events = load_weather()
    inserted_ts: list[int] = []

    for e in events:
        ts = e["timestamp"]
        raw = e["weather"]
        if raw not in WEATHER_NAME_MAP:
            print(f"  WARN: unknown weather name {raw!r}, skipping", file=sys.stderr)
            continue
        name = WEATHER_NAME_MAP[raw]
        # Skip if a DB event already exists within 60s of this timestamp — too close
        # to risk introducing a duplicate of an existing transition.
        nearby = cur.execute(
            "SELECT id FROM weather_events WHERE started_at BETWEEN ? AND ?",
            (ts - 60_000, ts + 60_000),
        ).fetchone()
        if nearby:
            continue
        try:
            cur.execute(
                "INSERT INTO weather_events (weather, started_at, ended_at) VALUES (?, ?, NULL)",
                (name, ts),
            )
            inserted_ts.append(ts)
        except sqlite3.IntegrityError:
            pass  # uniq_weather_started fired — already there

    # Repair `ended_at` so it never overlaps the next event.
    # For each inserted ts: set its ended_at to the next event's started_at (if any),
    # and clip the previous event's ended_at down to this ts if it overshoots.
    repaired = 0
    for ts in inserted_ts:
        nxt = cur.execute(
            "SELECT started_at FROM weather_events WHERE started_at > ? ORDER BY started_at LIMIT 1",
            (ts,),
        ).fetchone()
        if nxt:
            cur.execute(
                "UPDATE weather_events SET ended_at=? WHERE started_at=?",
                (nxt[0], ts),
            )
            repaired += cur.rowcount
        prev = cur.execute(
            "SELECT id, ended_at FROM weather_events WHERE started_at < ? ORDER BY started_at DESC LIMIT 1",
            (ts,),
        ).fetchone()
        if prev and prev[1] is not None and prev[1] > ts:
            cur.execute("UPDATE weather_events SET ended_at=? WHERE id=?", (ts, prev[0]))
            repaired += cur.rowcount

    return len(inserted_ts), repaired


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:  # transactional
            print("Backfilling shop restocks...")
            r_in, i_in = backfill_restocks(conn)
            print(f"  inserted {r_in} restocks, {i_in} item rows")

            print("Backfilling weather events...")
            w_in, w_rep = backfill_weather(conn)
            print(f"  inserted {w_in} events, repaired {w_rep} ended_at fields")
    finally:
        conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
