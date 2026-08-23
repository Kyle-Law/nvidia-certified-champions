#!/usr/bin/env python3
"""
fetch_data.py
------------------------------------------------------------------
Pulls NVIDIA's public Credly earner directory, filtered per country,
and writes compact JSON files into data/countries/. Then refreshes
data/manifest.json (counts + populated flags).

Standard library only — no pip install needed. Works with Python 3.8+.

Usage:
    python3 scripts/fetch_data.py                 # fetch every country in the manifest
    python3 scripts/fetch_data.py india china      # fetch only these (by slug or name)
    python3 scripts/fetch_data.py --list           # show configured countries and exit

Credly's directory is public and unauthenticated, but be a good citizen:
this script paginates at 50 records/page (Credly's observed max) and
waits briefly between requests.
------------------------------------------------------------------
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ORG_ID = "be046724-f99a-4626-922e-425eca1efa2e"  # NVIDIA's organization_id on Credly
PER_PAGE = 50  # Credly's observed max page size
REQUEST_DELAY_SECONDS = 0.25

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "data" / "manifest.json"
COUNTRIES_DIR = ROOT / "data" / "countries"

# Used only if data/manifest.json doesn't exist yet, so this script also
# works if you just grabbed this one file rather than the whole repo.
DEFAULT_COUNTRIES = [
    {"name": "Malaysia", "slug": "malaysia", "region": "Southeast Asia", "filter_value": "Malaysia", "count": 0, "populated": False},
    {"name": "Singapore", "slug": "singapore", "region": "Southeast Asia", "filter_value": "Singapore", "count": 0, "populated": False},
    {"name": "Indonesia", "slug": "indonesia", "region": "Southeast Asia", "filter_value": "Indonesia", "count": 0, "populated": False},
    {"name": "Thailand", "slug": "thailand", "region": "Southeast Asia", "filter_value": "Thailand", "count": 0, "populated": False},
    {"name": "Vietnam", "slug": "vietnam", "region": "Southeast Asia", "filter_value": "Vietnam", "count": 0, "populated": False},
    {"name": "Philippines", "slug": "philippines", "region": "Southeast Asia", "filter_value": "Philippines", "count": 0, "populated": False},
    {"name": "India", "slug": "india", "region": "South Asia", "filter_value": "India", "count": 0, "populated": False},
    {"name": "China", "slug": "china", "region": "East Asia", "filter_value": "China", "count": 0, "populated": False},
    {"name": "Japan", "slug": "japan", "region": "East Asia", "filter_value": "Japan", "count": 0, "populated": False},
    {"name": "South Korea", "slug": "south-korea", "region": "East Asia", "filter_value": "Korea, Republic of", "count": 0, "populated": False},
    {"name": "Australia", "slug": "australia", "region": "Oceania", "filter_value": "Australia", "count": 0, "populated": False},
]

USER_AGENT = "Mozilla/5.0 (compatible; apac-nvidia-directory-fetcher/1.0; +https://github.com)"


def fetch_country_page(filter_value: str, page: int) -> dict:
    query = urllib.parse.urlencode(
        {
            "organization_id": ORG_ID,
            "per": PER_PAGE,
            "page": page,
            "filter[location_name]": filter_value,
        }
    )
    url = f"https://www.credly.com/api/v1/directory?{query}"
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} fetching {filter_value!r} page {page}") from e


def to_compact_record(r: dict) -> dict:
    # most_recently_accepted_credential is the person's most recent badge from
    # ANY issuer on Credly — not necessarily NVIDIA. highlighted_badges is
    # already scoped to this request's organization_id, so it's the NVIDIA
    # badge to show. Fall back to most_recently_accepted_credential only if
    # highlighted_badges is ever empty (shouldn't happen given the org filter).
    highlighted = r.get("highlighted_badges") or []
    nvidia_badge = highlighted[0] if highlighted else (r.get("most_recently_accepted_credential") or {})
    name = " ".join(
        part for part in (r.get("first_name"), r.get("middle_name"), r.get("last_name")) if part
    )
    return {
        "id": r.get("id"),
        "name": name,
        "role": r.get("role") or "",
        "location": r.get("location") or "",
        "bc": r.get("badge_count"),
        "tbc": r.get("total_badge_count"),
        "bn": nvidia_badge.get("name") or "",
        "bd": nvidia_badge.get("date") or "",
        "p": r.get("vanity_url") or "",
        "bp": nvidia_badge.get("url") or "",
    }


def fetch_country(country: dict) -> tuple[list, int]:
    name = country["name"]
    filter_value = country["filter_value"]
    print(f"\n→ {name} (filter: {filter_value!r})")

    page = 1
    total_pages = 1
    total_count = 0
    records: list = []

    while page <= total_pages:
        data = fetch_country_page(filter_value, page)
        metadata = data.get("metadata", {})
        total_pages = metadata.get("total_pages", 1)
        total_count = metadata.get("total_count", len(data.get("data", [])))

        for r in data.get("data", []):
            records.append(to_compact_record(r))

        print(f"  page {page}/{total_pages} ({len(records)}/{total_count})", end="\r")
        page += 1
        if page <= total_pages:
            time.sleep(REQUEST_DELAY_SECONDS)

    print(f"  done — {len(records)} records" + " " * 10)
    return records, total_count


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {
        "region_name": "Asia-Pacific",
        "generated_at": date.today().isoformat(),
        "source": "Credly NVIDIA Earner Directory (public API, filtered by location)",
        "organization_id": ORG_ID,
        "countries": DEFAULT_COUNTRIES,
    }


def save_manifest(manifest: dict) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    manifest["generated_at"] = date.today().isoformat()
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch NVIDIA's Credly directory, split by country.")
    parser.add_argument("countries", nargs="*", help="Slugs or names to fetch (default: all)")
    parser.add_argument("--list", action="store_true", help="List configured countries and exit")
    args = parser.parse_args()

    manifest = load_manifest()

    if args.list:
        for c in manifest["countries"]:
            print(f"{c['slug']:<14} {c['name']:<16} region={c['region']:<14} known_count={c['count']}")
        return 0

    wanted = {w.lower() for w in args.countries}
    targets = [
        c
        for c in manifest["countries"]
        if not wanted or c["slug"] in wanted or c["name"].lower() in wanted
    ]

    if not targets:
        print("No matching countries. Use --list to see valid slugs/names.", file=sys.stderr)
        return 1

    COUNTRIES_DIR.mkdir(parents=True, exist_ok=True)

    for country in targets:
        try:
            records, total_count = fetch_country(country)
            out_path = COUNTRIES_DIR / f"{country['slug']}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(records, f, ensure_ascii=False)
            country["count"] = total_count
            country["populated"] = True
        except Exception as e:
            print(f"  ! failed to fetch {country['name']}: {e}", file=sys.stderr)

    save_manifest(manifest)
    print(f"\nUpdated {MANIFEST_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
