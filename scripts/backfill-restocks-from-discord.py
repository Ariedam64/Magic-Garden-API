#!/usr/bin/env python3
"""
Rebouche `shop_restocks` / `shop_restock_items` après une panne du poller.

Le bot `Magic Shopkeeper` ne ping que ce qui mérite une alerte, c'est-à-dire les
items qui ne sont **pas** garantis. Les communs d'un shop — Carrot, Beet, Aloe,
Cabbage, Strawberry côté `seed` — n'ont aucun rôle Discord parce qu'ils sont là
à tous les restocks. Lire les messages seuls donne donc des restocks amputés.

La reconstruction complète tient en trois observations, toutes vérifiées sur
l'historique enregistré :

1. **Les cadences sont fixes.** `seed` toutes les 5 min, `tool` 10 min, `egg`
   15 min, sur la grille UTC (phase 0), sans une seule exception sur la semaine
   précédant la panne. On sait donc quels shops ont restocké à quelle seconde
   sans rien demander à Discord.
2. **Les garantis sont déductibles.** Un item présent dans 100 % des restocks
   d'un shop sur une longue fenêtre l'était aussi pendant la panne.
3. **Le reste est pingé.** Tout ce qui n'est pas garanti a un rôle et apparaît
   dans le message, avec son stock exact.

La somme des deux ensembles reconstitue le restock. Validé contre la journée
complète du 2026-09-19 : 288/288 restocks `seed`, 144/144 `tool`, 96/96 `egg`
avec un ensemble d'items **exactement** identique à la réalité.

Ce qui reste approximé
----------------------
Le **stock des items garantis** est irrécupérable : il est tiré uniformément
dans une plage fixe à chaque restock (Carrot 5→25, ~100 occurrences par valeur
sur 2018 restocks) et la somme d'un restock n'est pas contrainte. On insère donc
leur moyenne historique. Conséquence : `drop_rate` devient exact, `avg_stock`
reste juste en agrégat, mais le stock d'un restock reconstruit pris isolément
est une estimation. Les items pingés, eux, gardent leur stock exact.

`decor` est exclu : ses items (HayBale, MarbleArch, WoodBridge, StoneLampPost…)
n'ont ni rôle Discord ni présence garantie, donc rien ne permet de les retrouver.
Les inclure inventerait des restocks amputés — exactement ce qu'on cherche à
éviter.

Usage
-----
    ./scripts/backfill-restocks-from-discord.py               # simulation
    ./scripts/backfill-restocks-from-discord.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "history.sqlite"
DUMP_DIR = PROJECT_ROOT / "export" / "discord"
API = "http://127.0.0.1:3002"

# Cadences constatées sur l'historique (intervalle constant, phase 0 sur la
# grille UTC). Seuls ces shops sont reconstruits : ce sont ceux dont la
# reconstruction a été validée à 100 % sur une journée entière.
CADENCE_MS = {"seed": 300_000, "tool": 600_000, "egg": 900_000}

# Fenêtre de la panne du 2026-09-20 (dernier restock vu → premier restock revu).
DEFAULT_FROM = "2026-09-20T07:05Z"
DEFAULT_TO = "2026-09-20T20:55Z"

# Fenêtre de référence pour mesurer « qui est garanti » et le stock moyen.
# Volontairement antérieure à la panne, pour ne pas se référencer soi-même.
REF_FROM = "2026-09-13T00:00Z"
REF_TO = "2026-09-20T07:05Z"


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def parse_when(raw: str) -> int:
    text = raw.strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise SystemExit(f"date illisible : {raw!r}")
    if not moment.tzinfo:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def newest(pattern: str) -> Path:
    found = sorted(DUMP_DIR.glob(pattern))
    if not found:
        raise SystemExit(f"aucun dump `{pattern}` dans {DUMP_DIR} — lance discord-scrape.py")
    return found[-1]


def norm(text: str) -> str:
    """
    Radical comparable d'un nom d'item.

    Le bot nomme ses rôles au pluriel et avec des espaces là où le jeu garde un
    identifiant collé au singulier : « Uncommon Eggs » doit retomber sur
    `UncommonEgg`, sans quoi tout le shop `egg` paraît irrécupérable.
    """
    return re.sub(r"[^a-z0-9]", "", (text or "").lower()).rstrip("s")


def load_catalogue(conn: sqlite3.Connection) -> dict[str, str]:
    """Radical -> item_id interne, depuis l'API du jeu puis l'historique."""
    import urllib.request

    table: dict[str, str] = {}
    for path in ("/data/plants", "/data/eggs", "/data/items", "/data/decors"):
        try:
            data = json.load(urllib.request.urlopen(API + path, timeout=20))
        except Exception as err:  # l'API locale peut être coupée
            print(f"  ! {path} injoignable ({err}) — on se rabat sur l'historique", file=sys.stderr)
            continue
        for key, value in data.items():
            table.setdefault(norm(key), key)
            if isinstance(value, dict):
                for sub in value.values():
                    if isinstance(sub, dict) and sub.get("name"):
                        table.setdefault(norm(sub["name"]), key)

    for (item_id,) in conn.execute("SELECT DISTINCT item_id FROM shop_restock_items"):
        table.setdefault(norm(item_id), item_id)
    return table


def profile_shops(conn: sqlite3.Connection, ref_from: int, ref_to: int):
    """Par shop : items garantis, stock moyen par item, et shops possibles par item."""
    guaranteed: dict[str, set[str]] = {}
    mean_stock: dict[tuple[str, str], int] = {}
    item_shops: dict[str, set[str]] = defaultdict(set)

    for item_id, shop in conn.execute(
        "SELECT DISTINCT i.item_id, r.shop_type FROM shop_restock_items i "
        "JOIN shop_restocks r ON r.id = i.restock_id WHERE r.restocked_at BETWEEN ? AND ?",
        (ref_from, ref_to),
    ):
        item_shops[item_id].add(shop)

    for shop in CADENCE_MS:
        total = conn.execute(
            "SELECT COUNT(*) FROM shop_restocks WHERE shop_type = ? AND restocked_at BETWEEN ? AND ?",
            (shop, ref_from, ref_to),
        ).fetchone()[0]
        if not total:
            raise SystemExit(f"aucun restock `{shop}` dans la fenêtre de référence — élargis --ref-from")

        rows = list(conn.execute(
            "SELECT i.item_id, COUNT(*), AVG(i.stock) FROM shop_restock_items i "
            "JOIN shop_restocks r ON r.id = i.restock_id "
            "WHERE r.shop_type = ? AND r.restocked_at BETWEEN ? AND ? GROUP BY i.item_id",
            (shop, ref_from, ref_to),
        ))
        guaranteed[shop] = {item for item, seen, _ in rows if seen == total}
        for item, _, avg in rows:
            mean_stock[(shop, item)] = max(1, round(avg))

    return guaranteed, mean_stock, item_shops


def read_pings(messages: list[dict], roles: dict[str, str], catalogue: dict[str, str]):
    """Créneau de 5 min -> {item_id: stock} annoncés par le bot."""
    slots: dict[int, dict[str, int]] = {}
    unresolved: set[str] = set()

    for msg in messages:
        items: dict[str, int] = {}
        for token in (msg.get("content") or "").split("|"):
            match = re.fullmatch(r"<@&(\d+)>(?:\s+(\d+))?", token.strip())
            if not match or match.group(2) is None:
                continue  # mention sans compteur = météo, traitée par l'autre script
            name = roles.get(match.group(1), "")
            item_id = catalogue.get(norm(name))
            if item_id is None:
                unresolved.add(name or match.group(1))
                continue
            items[item_id] = int(match.group(2))

        posted = int(datetime.fromisoformat(msg["timestamp"]).timestamp() * 1000)
        slots[posted // 300_000 * 300_000] = items

    if unresolved:
        print(f"  ! rôles sans item correspondant, ignorés : {sorted(unresolved)}", file=sys.stderr)
    return slots


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="since", default=DEFAULT_FROM)
    parser.add_argument("--to", dest="until", default=DEFAULT_TO)
    parser.add_argument("--ref-from", default=REF_FROM)
    parser.add_argument("--ref-to", default=REF_TO)
    parser.add_argument("--messages", type=Path)
    parser.add_argument("--roles", type=Path)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--shops", default=",".join(CADENCE_MS))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    lo, hi = parse_when(args.since), parse_when(args.until)
    ref_lo, ref_hi = parse_when(args.ref_from), parse_when(args.ref_to)
    shops = [s.strip() for s in args.shops.split(",") if s.strip()]
    for shop in shops:
        if shop not in CADENCE_MS:
            raise SystemExit(f"shop `{shop}` sans cadence connue — reconstruction non validée, refus")

    msg_path = args.messages or newest("messages-*.json")
    role_path = args.roles or newest("roles-by-id-*.json")
    print(f"messages  : {msg_path.name}")
    print(f"rôles     : {role_path.name}")
    print(f"fenêtre   : {iso(lo)} → {iso(hi)}")
    print(f"référence : {iso(ref_lo)} → {iso(ref_hi)}\n")

    conn = sqlite3.connect(args.db)
    catalogue = load_catalogue(conn)
    guaranteed, mean_stock, _ = profile_shops(conn, ref_lo, ref_hi)
    pings = read_pings(json.loads(msg_path.read_text()), json.loads(role_path.read_text()), catalogue)

    for shop in shops:
        names = sorted(guaranteed[shop])
        print(f"  garantis {shop:<5} ({len(names)}) : {names}")
    print()

    # Un créneau sans message ne donne aucune info sur les items pingés : on ne
    # reconstruit pas ce restock plutôt que d'affirmer qu'il ne contenait que
    # les garantis.
    planned: list[tuple[str, int, dict[str, int]]] = []
    skipped = 0
    for shop in shops:
        step = CADENCE_MS[shop]
        slot = lo + (-lo) % step
        while slot <= hi:
            pinged = pings.get(slot // 300_000 * 300_000)
            if pinged is None:
                skipped += 1
                slot += step
                continue
            items = {i: n for i, n in pinged.items() if (shop, i) in mean_stock}
            for item in guaranteed[shop]:
                items.setdefault(item, mean_stock[(shop, item)])
            if items:
                planned.append((shop, slot, items))
            slot += step

    by_shop: dict[str, int] = defaultdict(int)
    approx = exact = 0
    for shop, _, items in planned:
        by_shop[shop] += 1
        for item in items:
            if item in guaranteed[shop]:
                approx += 1
            else:
                exact += 1

    print(f"restocks à insérer : {sum(by_shop.values())}  {dict(by_shop)}")
    if skipped:
        print(f"  créneaux sans message, non reconstruits : {skipped}")
    print(f"lignes d'items     : {exact + approx}  (stock exact : {exact} | stock estimé : {approx})\n")

    existing = [
        (shop, slot) for shop, slot, _ in planned
        if conn.execute("SELECT 1 FROM shop_restocks WHERE shop_type = ? AND restocked_at = ?", (shop, slot)).fetchone()
    ]
    if existing:
        print(f"déjà en base, seront ignorés : {len(existing)} (ex. {existing[:3]})\n")

    for shop, slot, items in planned[:3]:
        shown = {k: v for k, v in sorted(items.items())}
        print(f"  exemple {shop} {iso(slot)} : {shown}")

    if not args.apply:
        print("\n[simulation] rien n'a été écrit. Relance avec --apply.")
        conn.close()
        return

    backup = args.db.with_name(f"{args.db.name}.bak-avant-backfill-restocks-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}")
    shutil.copy2(args.db, backup)
    print(f"\nsauvegarde : {backup.name}")

    inserted = items_inserted = 0
    with conn:
        for shop, slot, items in planned:
            cur = conn.execute(
                "INSERT OR IGNORE INTO shop_restocks (shop_type, restocked_at, restock_interval_seconds) VALUES (?, ?, ?)",
                (shop, slot, CADENCE_MS[shop] // 1000),
            )
            if not cur.rowcount:
                continue  # UNIQUE(shop_type, restocked_at) : déjà reconstruit
            inserted += 1
            restock_id = cur.lastrowid
            for item, stock in items.items():
                conn.execute(
                    "INSERT OR IGNORE INTO shop_restock_items (restock_id, item_id, stock) VALUES (?, ?, ?)",
                    (restock_id, item, stock),
                )
                items_inserted += 1

    print(f"insérés : {inserted} restocks, {items_inserted} lignes d'items")
    conn.close()


if __name__ == "__main__":
    main()
