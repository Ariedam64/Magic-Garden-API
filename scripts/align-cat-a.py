#!/usr/bin/env python3
"""
Category A fix: align non-5min-aligned restocks to their preceding 5-min slot.

For each restock at ts where ts % 5min != 0 (with 5s tolerance):
  - Compute ts_floor = ts rounded DOWN to the previous 5-min boundary
  - If a restock already exists at ts_floor (±5s) for the same shop:
      - If items identical: DELETE the misaligned restock (it's a duplicate)
      - If items differ: SKIP and FLAG for manual review
  - Otherwise: UPDATE the misaligned restock's restocked_at to ts_floor

Runs as a single transaction. Pass --dry-run to print actions without applying.
"""

import argparse
import sqlite3
import sys
import datetime as dt
from collections import Counter
from pathlib import Path

DB = Path("/srv/Magic-Garden-API/data/history.sqlite")
FIVE_MIN_MS = 5 * 60_000
TOLERANCE_MS = 5_000  # ms; anything within ±5s of a 5-min slot is considered aligned


def is_aligned(ts: int) -> bool:
    offset = ts % FIVE_MIN_MS
    return offset <= TOLERANCE_MS or offset >= FIVE_MIN_MS - TOLERANCE_MS


def floor_to_5min(ts: int) -> int:
    """Round DOWN to the nearest 5-min boundary."""
    return (ts // FIVE_MIN_MS) * FIVE_MIN_MS


def items_of(cur, rid: int) -> frozenset:
    return frozenset(
        (i, s) for (i, s) in cur.execute(
            "SELECT item_id, stock FROM shop_restock_items WHERE restock_id=?",
            (rid,),
        ).fetchall()
    )


def run(dry_run: bool) -> None:
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys=ON")

    all_rows = conn.execute(
        "SELECT id, shop_type, restocked_at FROM shop_restocks ORDER BY restocked_at"
    ).fetchall()
    misaligned = [(rid, shop, ts) for (rid, shop, ts) in all_rows if not is_aligned(ts)]
    print(f"Total misaligned restocks: {len(misaligned)}")

    counts = Counter()
    flagged = []

    try:
        cur = conn.cursor()
        with conn:
            for rid, shop, ts in misaligned:
                ts_floor = floor_to_5min(ts)
                existing = cur.execute(
                    "SELECT id FROM shop_restocks "
                    "WHERE shop_type=? AND restocked_at BETWEEN ? AND ? AND id != ?",
                    (shop, ts_floor - TOLERANCE_MS, ts_floor + TOLERANCE_MS, rid),
                ).fetchone()

                items_self = items_of(cur, rid)

                if existing is not None:
                    other_rid = existing[0]
                    items_other = items_of(cur, other_rid)
                    if items_self == items_other:
                        # Duplicate -> DELETE the misaligned entry, keep aligned one
                        counts["DELETE_DUP"] += 1
                        if not dry_run:
                            cur.execute("DELETE FROM shop_restocks WHERE id=?", (rid,))
                    else:
                        # Different items at the floor slot — conflict, skip
                        counts["SKIP_CONFLICT"] += 1
                        when = dt.datetime.fromtimestamp(ts/1000, tz=dt.timezone.utc)
                        when_floor = dt.datetime.fromtimestamp(ts_floor/1000, tz=dt.timezone.utc)
                        flagged.append({
                            "shop": shop,
                            "misaligned_id": rid,
                            "misaligned_ts": str(when),
                            "items_self": sorted(items_self),
                            "existing_id": other_rid,
                            "floor_ts": str(when_floor),
                            "items_other": sorted(items_other),
                        })
                else:
                    # No conflict — just shift the timestamp to the floor slot
                    counts["UPDATE_ALIGN"] += 1
                    if not dry_run:
                        cur.execute(
                            "UPDATE shop_restocks SET restocked_at=? WHERE id=?",
                            (ts_floor, rid),
                        )

            mode = "DRY-RUN — no changes committed" if dry_run else "COMMITTED"
            print(f"\n=== Action summary ({mode}) ===")
            for action, n in counts.most_common():
                print(f"  {action}: {n}")

            if flagged:
                print(f"\n=== Flagged conflicts (kept as-is) — {len(flagged)} ===")
                for f in flagged[:30]:
                    print(f"  [{f['shop']}] id={f['misaligned_id']} {f['misaligned_ts']}")
                    print(f"     items_self : {f['items_self']}")
                    print(f"     vs existing id={f['existing_id']} @ {f['floor_ts']}")
                    print(f"     items_other: {f['items_other']}")
                if len(flagged) > 30:
                    print(f"  ... and {len(flagged)-30} more")

            if dry_run:
                # Rollback explicitly by raising to abort the `with conn:` transaction
                raise RuntimeError("dry-run abort")
    except RuntimeError as e:
        if str(e) == "dry-run abort":
            pass
        else:
            raise
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(args.dry_run)


if __name__ == "__main__":
    main()
