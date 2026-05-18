#!/usr/bin/env python3
"""
Targeted fixes on data/history.sqlite as agreed with user.

Starweaver (per user: export is ground truth, remove these from DB):
  - Delete restocks 207846, 207867, 208187, 208413, 1811 (each Starweaver-only)
  - From restock 1927 (Mushroom + Starweaver), remove only Starweaver item

HorseEgg (add to existing restocks):
  - Add HorseEgg(1) to restock_id 85408 (2026-02-26 03:00)
  - Add HorseEgg(1) + RareEgg(1) to restock_id 85633 (2026-02-28 11:30)

MythicalEgg (add to existing restocks):
  - Add MythicalEgg(1) to restock_id 286711 (2025-08-22 00:45)
  - Add MythicalEgg(1) + RareEgg(1) to restock_id 92373 (2026-05-11 04:00)
  - Add MythicalEgg(1) to restock_id 92383 (2026-05-11 06:30)

The script prints what it changed and is wrapped in a single transaction.
Re-running is safe (deletes ignored if rows already gone, inserts use INSERT OR IGNORE).
"""

import sqlite3
from pathlib import Path

DB = Path("/srv/Magic-Garden-API/data/history.sqlite")

STARWEAVER_FULL_DELETE = [207846, 207867, 208187, 208413, 1811]
STARWEAVER_ITEM_ONLY = 1927  # remove only the Starweaver item, keep restock + Mushroom

ITEM_ADDS = [
    # (restock_id, item_id, stock, sanity-check label)
    (85408,  "HorseEgg",    1, "2026-02-26 03:00 egg"),
    (85633,  "HorseEgg",    1, "2026-02-28 11:30 egg"),
    (85633,  "RareEgg",     1, "2026-02-28 11:30 egg (full sync)"),
    (286711, "MythicalEgg", 1, "2025-08-22 00:45 egg"),
    (92373,  "MythicalEgg", 1, "2026-05-11 04:00 egg"),
    (92373,  "RareEgg",     1, "2026-05-11 04:00 egg (full sync)"),
    (92383,  "MythicalEgg", 1, "2026-05-11 06:30 egg"),
]


def main():
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:
            cur = conn.cursor()

            print("=== Starweaver full restock deletes ===")
            for rid in STARWEAVER_FULL_DELETE:
                row = cur.execute(
                    "SELECT shop_type, restocked_at FROM shop_restocks WHERE id=?",
                    (rid,),
                ).fetchone()
                if row is None:
                    print(f"  id={rid}: already absent, skip")
                    continue
                items = cur.execute(
                    "SELECT item_id, stock FROM shop_restock_items WHERE restock_id=?",
                    (rid,),
                ).fetchall()
                print(f"  id={rid} {row[0]}@{row[1]}  items_before={items}")
                cur.execute("DELETE FROM shop_restocks WHERE id=?", (rid,))
                # ON DELETE CASCADE handles items
                print(f"    deleted (rowcount={cur.rowcount})")

            print("\n=== Starweaver item-only delete (keep restock + Mushroom) ===")
            row = cur.execute(
                "SELECT shop_type, restocked_at FROM shop_restocks WHERE id=?",
                (STARWEAVER_ITEM_ONLY,),
            ).fetchone()
            if row is None:
                print(f"  id={STARWEAVER_ITEM_ONLY}: restock missing, skip")
            else:
                before = cur.execute(
                    "SELECT item_id, stock FROM shop_restock_items WHERE restock_id=?",
                    (STARWEAVER_ITEM_ONLY,),
                ).fetchall()
                print(f"  id={STARWEAVER_ITEM_ONLY} {row[0]}@{row[1]} items_before={before}")
                cur.execute(
                    "DELETE FROM shop_restock_items WHERE restock_id=? AND item_id='Starweaver'",
                    (STARWEAVER_ITEM_ONLY,),
                )
                after = cur.execute(
                    "SELECT item_id, stock FROM shop_restock_items WHERE restock_id=?",
                    (STARWEAVER_ITEM_ONLY,),
                ).fetchall()
                print(f"  items_after={after}  (rowcount={cur.rowcount})")

            print("\n=== Item additions ===")
            for rid, item, stock, label in ITEM_ADDS:
                exists = cur.execute(
                    "SELECT 1 FROM shop_restocks WHERE id=?", (rid,)
                ).fetchone()
                if not exists:
                    print(f"  restock_id={rid} MISSING — skipping {item} for {label}")
                    continue
                before = dict(cur.execute(
                    "SELECT item_id, stock FROM shop_restock_items WHERE restock_id=?",
                    (rid,),
                ).fetchall())
                if item in before:
                    print(f"  restock_id={rid} {label}: {item} already present (stock={before[item]}), skip")
                    continue
                cur.execute(
                    "INSERT OR IGNORE INTO shop_restock_items (restock_id, item_id, stock) VALUES (?, ?, ?)",
                    (rid, item, stock),
                )
                after = dict(cur.execute(
                    "SELECT item_id, stock FROM shop_restock_items WHERE restock_id=?",
                    (rid,),
                ).fetchall())
                print(f"  restock_id={rid} {label}: +{item}×{stock}  before={list(before)}  after={list(after)}")
    finally:
        conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
