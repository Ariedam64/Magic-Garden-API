#!/usr/bin/env python3
"""
Rebouche un trou de `weather_events` à partir d'un dump Discord.

Contexte : quand le poller s'arrête, la météo courante reste figée en base sous
la forme d'un seul évènement qui s'étale sur toute la panne (le 2026-09-20, un
`Clear Skies` de 14 h 30). Le bot `Magic Shopkeeper` poste, lui, toutes les
5 minutes dans le salon `ping`, et préfixe son message de la météo active :

    <@&1392543814530633839> | <@&role_item> 3 | <@&role_item> 1
    ^ mention SANS compteur = la météo          ^ avec compteur = un item

Une mention sans compteur est donc une météo, une mention avec compteur un item.
Ce script ne lit que la première ; les restocks sont volontairement ignorés (le
bot ne ping que les items qui ont un rôle, donc ses listes sont partielles et
les injecter fausserait les `drop_rate` de /stats/items).

Sûreté :
- `--dry-run` par défaut, `--apply` pour écrire ;
- sauvegarde automatique du fichier SQLite avant toute écriture ;
- idempotent (UNIQUE(started_at)), rejouable sans doublon ;
- n'écrit que dans la fenêtre demandée, et refuse de recouvrir un évènement
  déjà enregistré qui ne serait pas celui de la panne.

Usage
-----
    ./scripts/backfill-weather-from-discord.py                    # simulation
    ./scripts/backfill-weather-from-discord.py --apply            # écrit
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "history.sqlite"
DUMP_DIR = PROJECT_ROOT / "export" / "discord"

SLOT_MS = 5 * 60 * 1000  # le jeu change de météo sur une grille de 5 minutes

# Le trou du 2026-09-20 : bornes du `Clear Skies` fantôme laissé par le poller.
DEFAULT_FROM = "2026-09-20T06:35Z"
DEFAULT_TO = "2026-09-20T21:05Z"

# Libellés côté rôles Discord -> libellés déjà utilisés dans weather_events.
# Ils coïncident aujourd'hui ; la table existe pour que la divergence se voie.
WEATHER_LABELS = {
    "Rain": "Rain",
    "Snow": "Snow",
    "Thunderstorm": "Thunderstorm",
    "Dawn": "Dawn",
    "Amber Moon": "Amber Moon",
}
CLEAR = "Clear Skies"


def iso(ms: int | None) -> str:
    if ms is None:
        return "—"
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
        raise SystemExit(
            f"aucun dump `{pattern}` dans {DUMP_DIR}.\n"
            f"Lance d'abord : ./scripts/discord-scrape.py"
        )
    return found[-1]


def load_slots(messages: list[dict], roles: dict[str, str]) -> dict[int, str]:
    """
    Météo par créneau de 5 minutes, telle que le bot l'a annoncée.

    Un message sans mention de tête veut dire « aucun évènement météo », ce que
    notre historique enregistre sous `Clear Skies`.
    """
    slots: dict[int, str] = {}
    unknown: set[str] = set()

    for msg in messages:
        content = (msg.get("content") or "").strip()
        if not content:
            continue

        head = content.split("|", 1)[0].strip()
        match = re.fullmatch(r"<@&(\d+)>", head)  # sans compteur = météo

        if match:
            name = roles.get(match.group(1))
            label = WEATHER_LABELS.get(name)
            if label is None:
                unknown.add(f"{name} ({match.group(1)})")
                continue
        else:
            label = CLEAR

        posted = int(datetime.fromisoformat(msg["timestamp"]).timestamp() * 1000)
        slots[posted // SLOT_MS * SLOT_MS] = label

    if unknown:
        print(f"  ! rôles de tête non reconnus, créneaux ignorés : {sorted(unknown)}", file=sys.stderr)

    return slots


def build_intervals(slots: dict[int, str], lo: int, hi: int) -> list[tuple[str, int, int]]:
    """
    Agrège les créneaux consécutifs de même météo en `(weather, start, end)`.

    Un créneau manquant coupe l'intervalle : on préfère deux évènements bornés à
    un seul qui affirmerait une continuité qu'on n'a pas observée.
    """
    keys = [t for t in sorted(slots) if lo <= t < hi]
    intervals: list[tuple[str, int, int]] = []

    for slot in keys:
        label = slots[slot]
        if intervals and intervals[-1][0] == label and intervals[-1][2] == slot:
            weather, start, _ = intervals[-1]
            intervals[-1] = (weather, start, slot + SLOT_MS)
        else:
            intervals.append((label, slot, slot + SLOT_MS))

    if intervals:
        weather, start, end = intervals[-1]
        intervals[-1] = (weather, start, min(end, hi))

    return intervals


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="since", default=DEFAULT_FROM)
    parser.add_argument("--to", dest="until", default=DEFAULT_TO)
    parser.add_argument("--messages", type=Path, help="dump précis (défaut : le plus récent)")
    parser.add_argument("--roles", type=Path, help="table des rôles (défaut : la plus récente)")
    parser.add_argument("--apply", action="store_true", help="écrit réellement (sinon simulation)")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="base à modifier (défaut : celle de prod)")
    args = parser.parse_args()

    db_path: Path = args.db

    lo, hi = parse_when(args.since), parse_when(args.until)
    if lo >= hi:
        raise SystemExit("--from doit être avant --to")

    msg_path = args.messages or newest("messages-*.json")
    role_path = args.roles or newest("roles-by-id-*.json")
    print(f"messages : {msg_path.name}")
    print(f"rôles    : {role_path.name}")
    print(f"fenêtre  : {iso(lo)}  →  {iso(hi)}\n")

    messages = json.loads(msg_path.read_text(encoding="utf-8"))
    roles = json.loads(role_path.read_text(encoding="utf-8"))

    slots = load_slots(messages, roles)
    covered = [t for t in slots if lo <= t < hi]
    expected = (hi - lo) // SLOT_MS
    print(f"créneaux couverts : {len(covered)}/{expected}")
    if len(covered) < expected:
        missing = expected - len(covered)
        print(f"  ! {missing} créneau(x) sans message — ils resteront des trous, pas des suppositions")

    intervals = build_intervals(slots, lo, hi)
    print(f"évènements reconstruits : {len(intervals)}\n")
    for weather, start, end in intervals:
        print(f"  {weather:<14} {iso(start)} -> {iso(end)}  ({(end - start) // 60000} min)")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")

    # Ce qui existe déjà dans la fenêtre. Le seul chevauchement attendu est
    # l'évènement fantôme de la panne ; tout le reste demande un arbitrage
    # humain, donc on s'arrête.
    existing = list(conn.execute(
        "SELECT id, weather, started_at, ended_at FROM weather_events "
        "WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at",
        (hi, lo),
    ))
    print(f"\nlignes existantes chevauchant la fenêtre : {len(existing)}")
    for row in existing:
        print(f"  id={row[0]} {row[1]:<14} {iso(row[2])} -> {iso(row[3])}")

    spanning = [r for r in existing if r[2] <= lo and (r[3] is None or r[3] >= hi)]
    if len(existing) > 1 or (existing and not spanning):
        raise SystemExit(
            "\nla fenêtre contient des évènements déjà enregistrés qui ne sont pas "
            "l'évènement unique de la panne : rien n'a été écrit, à arbitrer à la main."
        )

    if not args.apply:
        print("\n[simulation] rien n'a été écrit. Relance avec --apply.")
        conn.close()
        return

    backup = db_path.with_name(f"{db_path.name}.bak-avant-backfill-meteo-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}")
    shutil.copy2(db_path, backup)
    print(f"\nsauvegarde : {backup.name}")

    inserted = 0
    with conn:
        if spanning:
            ghost_id, _, ghost_start, ghost_end = spanning[0]
            first_start = intervals[0][1]
            if ghost_start < first_start:
                # L'évènement fantôme commençait avant le trou : on le raccourcit
                # au premier instant réellement observé au lieu de le supprimer,
                # sa portion antérieure ayant bien été constatée par le poller.
                conn.execute("UPDATE weather_events SET ended_at = ? WHERE id = ?", (first_start, ghost_id))
                print(f"  fantôme id={ghost_id} raccourci à {iso(first_start)}")
            else:
                conn.execute("DELETE FROM weather_events WHERE id = ?", (ghost_id,))
                print(f"  fantôme id={ghost_id} supprimé")

        # Tous les intervalles sont insérés, sans exception : quand le fantôme
        # est raccourci il s'arrête pile au début du premier (aucun recouvrement),
        # et quand il est supprimé il ne couvre plus rien. Sauter le premier dans
        # ce second cas laissait un trou entre le début de la fenêtre et le
        # premier changement de météo.
        for weather, start, end in intervals:
            cur = conn.execute(
                "INSERT OR IGNORE INTO weather_events (weather, started_at, ended_at) VALUES (?, ?, ?)",
                (weather, start, end),
            )
            inserted += cur.rowcount

        # Le fantôme s'arrêtait à `hi`, où reprend l'historique réel : on raccorde
        # le dernier évènement reconstruit sur cette borne plutôt que de laisser
        # un blanc de quelques minutes.
        conn.execute(
            "UPDATE weather_events SET ended_at = ? WHERE started_at = ? AND ended_at < ?",
            (hi, intervals[-1][1], hi),
        )

    print(f"\ninsérés : {inserted} | ignorés (déjà présents) : {len(intervals) - inserted}")
    conn.close()


if __name__ == "__main__":
    main()
