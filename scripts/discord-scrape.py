#!/usr/bin/env python3
"""
Aspire un salon Discord et la table des rôles d'un serveur, en JSON brut.

Sert à reconstruire l'historique quand notre propre poller a laissé un trou :
un autre bot poste les restocks et la météo dans un salon, et il ping des rôles
dont les noms correspondent aux items. Les messages seuls ne suffisent donc pas
— une mention arrive sous la forme `<@&1392...>`, il faut la table des rôles
pour la relire.

Ce script ne fait que **récupérer et déposer du JSON**. Il ne parse rien et
n'écrit pas en base : le format des messages du bot n'est pas connu d'avance,
donc on regarde le dump avant d'écrire un parseur (voir `--summary`, affiché à
la fin de chaque run).

Exemples
--------
    # le trou du 2026-09-20 (valeurs par défaut) + la table des rôles
    ./scripts/discord-scrape.py

    # une autre fenêtre
    ./scripts/discord-scrape.py --since 2026-09-18T00:00Z --until 2026-09-19T00:00Z

    # juste les rôles
    ./scripts/discord-scrape.py --skip-messages
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

# =====================
# Constantes
# =====================

API = "https://discord.com/api/v9"

# Origine des snowflakes Discord (2015-01-01T00:00:00Z). Les 42 bits de poids
# fort d'un id sont un timestamp ms relatif à cette date : on peut donc traduire
# une date en curseur de pagination sans connaître le moindre id.
DISCORD_EPOCH_MS = 1420070400000

GUILD_ID = "808935495543160852"
CHANNEL_ID = "1392142706964303933"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_OUT_DIR = PROJECT_ROOT / "export" / "discord"

# Clé du .env qui porte le token. Volontairement pas un défaut « standard » :
# c'est le nom déjà utilisé dans ce dépôt.
DEFAULT_ENV_KEY = "discord_token_for_scrap"

# Fenêtre par défaut = la panne du poller du 2026-09-20 (07:05 → 20:55 UTC pour
# les shops, 06:35 → 21:05 pour la météo), avec de la marge des deux côtés.
DEFAULT_SINCE = "2026-09-20T06:00Z"
DEFAULT_UNTIL = "2026-09-20T21:30Z"

# L'API tolère 50 req/s tous endpoints confondus, et bien moins par route. On
# reste très en dessous : le but est de finir le run, pas de finir vite.
PAGE_PAUSE_S = 0.6
MAX_RETRIES = 5

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


# =====================
# Snowflakes & temps
# =====================


def snowflake_to_ms(snowflake: int | str) -> int:
    return (int(snowflake) >> 22) + DISCORD_EPOCH_MS


def ms_to_snowflake(ms: int, *, end_of_ms: bool = False) -> int:
    """
    Curseur de pagination pour une date.

    `end_of_ms` met les 22 bits bas à 1 : le snowflake obtenu est le dernier
    possible pour cette milliseconde. C'est ce qu'il faut pour un `before`, qui
    est exclusif — sinon on perd les messages postés dans la même ms.
    """
    shifted = (int(ms) - DISCORD_EPOCH_MS) << 22
    return shifted | 0x3FFFFF if end_of_ms else shifted


def parse_when(raw: str) -> datetime:
    """Accepte `2026-09-20T06:00Z`, `2026-09-20 06:00:00+00:00`, `2026-09-20`."""
    text = raw.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise SystemExit(f"date illisible : {raw!r} (attendu ISO, ex. 2026-09-20T06:00Z)")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def to_ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


# =====================
# Token
# =====================


def read_env_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return None


def load_token(env_key: str) -> str:
    token = read_env_value(ENV_PATH, env_key)
    if not token:
        raise SystemExit(
            f"aucun token dans {ENV_PATH} sous la clé `{env_key}`.\n"
            f"Ajoute la ligne `{env_key}=...` ou passe --env-key."
        )
    return token


def auth_header(token: str, *, is_bot: bool) -> str:
    # Un token de bot se préfixe `Bot `, un token de compte non. Se tromper
    # donne un 401 qui n'explique rien.
    if token.startswith(("Bot ", "Bearer ")):
        return token
    return f"Bot {token}" if is_bot else token


# =====================
# HTTP
# =====================


class Discord:
    def __init__(self, token: str, *, is_bot: bool) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": auth_header(token, is_bot=is_bot),
                "User-Agent": UA,
                "Accept": "application/json",
            }
        )

    def get(self, path: str, params: dict | None = None) -> list | dict:
        """
        GET avec respect des quotas.

        Les 429 sont rejoués en suivant `retry_after` renvoyé par Discord — on
        ne devine jamais le délai. Les 5xx et les coupures réseau passent par un
        backoff exponentiel borné.
        """
        url = f"{API}{path}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                res = self.session.get(url, params=params, timeout=30)
            except requests.RequestException as err:
                if attempt == MAX_RETRIES:
                    raise SystemExit(f"réseau HS après {MAX_RETRIES} essais : {err}")
                wait = min(2**attempt, 30) + random.random()
                print(f"  ! réseau ({err.__class__.__name__}), retry dans {wait:.1f}s", file=sys.stderr)
                time.sleep(wait)
                continue

            if res.status_code == 429:
                body = {}
                try:
                    body = res.json()
                except ValueError:
                    pass
                wait = float(body.get("retry_after", res.headers.get("Retry-After", 5))) + 0.5
                scope = res.headers.get("X-RateLimit-Scope", "?")
                print(f"  · 429 (scope={scope}), pause {wait:.1f}s", file=sys.stderr)
                time.sleep(wait)
                continue

            if res.status_code == 401:
                raise SystemExit(
                    "401 : token refusé. Vérifie la clé du .env, et --bot selon "
                    "qu'il s'agit d'un token de bot ou de compte."
                )
            if res.status_code == 403:
                raise SystemExit(f"403 : pas accès à {path} avec ce token.")
            if res.status_code == 404:
                raise SystemExit(f"404 : {path} introuvable (mauvais id de salon/serveur ?).")

            if res.status_code >= 500:
                if attempt == MAX_RETRIES:
                    raise SystemExit(f"{res.status_code} persistant sur {path}")
                wait = min(2**attempt, 30) + random.random()
                print(f"  ! {res.status_code} côté Discord, retry dans {wait:.1f}s", file=sys.stderr)
                time.sleep(wait)
                continue

            if not res.ok:
                raise SystemExit(f"{res.status_code} sur {path} : {res.text[:300]}")

            # Quota de la route presque épuisé : on attend la fenêtre suivante
            # plutôt que de provoquer le 429.
            if res.headers.get("X-RateLimit-Remaining") == "0":
                reset = float(res.headers.get("X-RateLimit-Reset-After", 1)) + 0.2
                time.sleep(reset)

            return res.json()

        raise SystemExit(f"échec sur {path}")


# =====================
# Récupération
# =====================


def fetch_roles(api: Discord, guild_id: str) -> list[dict]:
    roles = api.get(f"/guilds/{guild_id}/roles")
    if not isinstance(roles, list):
        raise SystemExit("réponse inattendue pour les rôles")
    return roles


def fetch_messages(
    api: Discord,
    channel_id: str,
    *,
    since_ms: int | None,
    until_ms: int | None,
    max_pages: int,
) -> list[dict]:
    """
    Remonte le salon page par page, du plus récent vers le plus ancien.

    Discord ne sait filtrer que par `before`/`after`, jamais par date : on entre
    donc dans l'historique par le snowflake correspondant à `until`, puis on
    redescend jusqu'à dépasser `since`.
    """
    collected: list[dict] = []
    seen: set[str] = set()
    before = ms_to_snowflake(until_ms, end_of_ms=True) if until_ms else None

    for page in range(1, max_pages + 1):
        params: dict[str, object] = {"limit": 100}
        if before is not None:
            params["before"] = str(before)

        batch = api.get(f"/channels/{channel_id}/messages", params)
        if not isinstance(batch, list):
            raise SystemExit("réponse inattendue pour les messages")
        if not batch:
            print(f"  page {page}: vide, fin de l'historique")
            break

        # Discord rend du plus récent au plus ancien.
        oldest = batch[-1]
        oldest_ms = snowflake_to_ms(oldest["id"])

        kept = 0
        for msg in batch:
            msg_ms = snowflake_to_ms(msg["id"])
            if since_ms is not None and msg_ms < since_ms:
                continue
            if until_ms is not None and msg_ms > until_ms:
                continue
            if msg["id"] in seen:
                continue
            seen.add(msg["id"])
            collected.append(msg)
            kept += 1

        print(f"  page {page}: {len(batch)} reçus, {kept} dans la fenêtre — jusqu'à {iso(oldest_ms)}")

        if since_ms is not None and oldest_ms < since_ms:
            print("  fenêtre couverte")
            break
        if len(batch) < 100:
            print("  début du salon atteint")
            break

        before = int(oldest["id"])
        time.sleep(PAGE_PAUSE_S)
    else:
        print(f"  ! arrêt sur --max-pages ({max_pages}) : la fenêtre n'est peut-être pas entière")

    collected.sort(key=lambda m: int(m["id"]))
    return collected


# =====================
# Restitution
# =====================


def summarize(messages: list[dict], roles: list[dict]) -> None:
    """
    De quoi décider comment écrire le parseur : qui poste, sous quelle forme, et
    si le contenu utile est dans le texte ou dans des embeds.
    """
    print("\n=== résumé")
    if roles:
        print(f"rôles          : {len(roles)}")

    if not messages:
        print("messages       : 0 — rien à parser")
        return

    first = snowflake_to_ms(messages[0]["id"])
    last = snowflake_to_ms(messages[-1]["id"])
    print(f"messages       : {len(messages)}")
    print(f"fenêtre réelle : {iso(first)}  →  {iso(last)}")

    authors: dict[str, int] = {}
    with_content = with_embeds = with_role_ping = 0
    for msg in messages:
        author = msg.get("author") or {}
        label = f"{author.get('username', '?')} ({author.get('id', '?')})"
        authors[label] = authors.get(label, 0) + 1
        if (msg.get("content") or "").strip():
            with_content += 1
        if msg.get("embeds"):
            with_embeds += 1
        if "<@&" in (msg.get("content") or ""):
            with_role_ping += 1

    print(f"avec texte     : {with_content}")
    print(f"avec embeds    : {with_embeds}")
    print(f"pinguant 1 rôle: {with_role_ping}")
    print("auteurs        :")
    for label, count in sorted(authors.items(), key=lambda kv: -kv[1])[:10]:
        print(f"  {count:>6}  {label}")

    sample = messages[len(messages) // 2]
    print("\n--- message d'exemple (milieu de fenêtre)")
    print(json.dumps(sample, ensure_ascii=False, indent=2)[:1500])


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → {path}  ({path.stat().st_size / 1024:.1f} KiB)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dump JSON des rôles d'un serveur Discord et des messages d'un salon.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--guild", default=GUILD_ID, help=f"id du serveur (défaut {GUILD_ID})")
    parser.add_argument("--channel", default=CHANNEL_ID, help=f"id du salon (défaut {CHANNEL_ID})")
    parser.add_argument("--since", default=DEFAULT_SINCE, help=f"borne basse ISO (défaut {DEFAULT_SINCE})")
    parser.add_argument("--until", default=DEFAULT_UNTIL, help=f"borne haute ISO (défaut {DEFAULT_UNTIL})")
    parser.add_argument("--last", metavar="HEURES", type=float,
                        help="raccourci : les N dernières heures, ignore --since/--until")
    parser.add_argument("--max-pages", type=int, default=200, help="garde-fou de pagination (défaut 200)")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help=f"défaut {DEFAULT_OUT_DIR}")
    parser.add_argument("--env-key", default=DEFAULT_ENV_KEY, help=f"clé du .env (défaut {DEFAULT_ENV_KEY})")
    parser.add_argument("--bot", action="store_true", help="le token est un token de bot (préfixe `Bot `)")
    parser.add_argument("--skip-roles", action="store_true")
    parser.add_argument("--skip-messages", action="store_true")
    args = parser.parse_args()

    if args.last is not None:
        until = datetime.now(timezone.utc)
        since = until - timedelta(hours=args.last)
    else:
        since, until = parse_when(args.since), parse_when(args.until)

    if since >= until:
        raise SystemExit("--since doit être avant --until")

    since_ms, until_ms = to_ms(since), to_ms(until)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    api = Discord(load_token(args.env_key), is_bot=args.bot)

    roles: list[dict] = []
    if not args.skip_roles:
        print(f"rôles du serveur {args.guild}")
        roles = fetch_roles(api, args.guild)
        write_json(args.out_dir / f"roles-{args.guild}-{stamp}.json", roles)
        # Table plate id → nom : c'est elle qui relit les `<@&id>` des messages.
        write_json(
            args.out_dir / f"roles-by-id-{args.guild}-{stamp}.json",
            {r["id"]: r.get("name") for r in roles},
        )

    messages: list[dict] = []
    if not args.skip_messages:
        print(f"\nmessages du salon {args.channel}")
        print(f"  fenêtre demandée : {iso(since_ms)}  →  {iso(until_ms)}")
        messages = fetch_messages(
            api, args.channel,
            since_ms=since_ms, until_ms=until_ms, max_pages=args.max_pages,
        )
        write_json(args.out_dir / f"messages-{args.channel}-{stamp}.json", messages)

    summarize(messages, roles)


if __name__ == "__main__":
    main()
