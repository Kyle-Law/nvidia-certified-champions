# NVIDIA Certified — APAC Directory

A searchable, filterable directory of NVIDIA-certified professionals across
Asia-Pacific, built from Credly's public earner directory. Pure static
frontend (HTML/CSS/JS, no build step, no framework) reading flat JSON files
as its "backend."

**[Live demo →](#)** _(update once deployed to GitHub Pages)_

## Why this exists

NVIDIA publishes its Credly badge directory publicly, but it's one long
un-filterable page per organization with no cross-country view and no way to
search by name or role. This repo re-packages that same public data as a
fast, filterable directory scoped to APAC, with a data pipeline you can
re-run to keep it current.

## Current coverage

| Region | Country | Status |
|---|---|---|
| Southeast Asia | Malaysia | ✅ 107 people loaded |
| Southeast Asia | Indonesia | ✅ 77 people loaded |
| Southeast Asia | Thailand | ✅ 43 people loaded |
| Southeast Asia | Vietnam | ✅ 149 people loaded |
| Southeast Asia | Philippines | ✅ 43 people loaded |
| Southeast Asia | Singapore | ⏳ 396 known, not fetched |
| South Asia | India | ⏳ 2,869 known, not fetched |
| East Asia | China | ⏳ 1,065 known, not fetched |
| East Asia | Japan | ⏳ 386 known, not fetched |
| East Asia | South Korea | ⏳ 457 known, not fetched |
| Oceania | Australia | ⏳ 249 known, not fetched |

"Known" counts come from Credly's own directory metadata at the time
`data/manifest.json` was last generated. Countries marked ⏳ show up in the
UI (as a greyed-out, count-only chip) but don't have per-person records
checked in yet — see [Fetching data](#fetching-data) to pull them in. India
and China alone account for ~3,900 of the ~5,800 known people in this list,
which is why they're left to the fetch script rather than committed as a
one-time dump: this directory changes daily, and a live-fetched JSON stays
correct in a way a stale snapshot can't.

## Project structure

```
.
├── index.html              # the whole app shell
├── assets/
│   ├── style.css
│   └── app.js               # loads manifest + country JSON, does all filtering client-side
├── data/
│   ├── manifest.json         # region/country list, counts, populated flags
│   └── countries/
│       ├── malaysia.json     # [{ id, name, role, location, bc, tbc, bn, bd, p, bp }, ...]
│       ├── singapore.json    # [] until fetched
│       └── ...
└── scripts/
    └── fetch-data.mjs        # Node 18+ script that (re)pulls data from Credly
```

### Record schema

Each entry in `data/countries/<slug>.json`:

| Field | Meaning |
|---|---|
| `id` | Credly earner id |
| `name` | Full name as shown on Credly |
| `role` | Job title, if the earner set one (often blank) |
| `location` | Free-text city/region the earner entered (often blank) |
| `bc` | Badge count *from NVIDIA specifically* |
| `tbc` | Total badge count across *all* issuers on their profile |
| `bn` | Name of their most recently earned NVIDIA badge |
| `bd` | ISO date that badge was accepted |
| `p` | Their Credly profile path (append to `https://www.credly.com`) |
| `bp` | That badge's path (append to `https://www.credly.com`) |

Keys are kept short because these files are committed to git and some
countries run into the thousands of rows.

## Running locally

No build step. Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

## Fetching data

The frontend never talks to Credly directly — all fetching happens ahead of
time via the script, and the site just reads the resulting JSON.

```bash
node scripts/fetch-data.mjs                 # refresh every country in the manifest
node scripts/fetch-data.mjs india china      # refresh just these
node scripts/fetch-data.mjs --list           # see all configured slugs
```

This rewrites `data/countries/<slug>.json` for each target and updates
`count`/`populated` in `data/manifest.json`. Commit the result.

Be reasonable with how often you run this against Credly's public API —
the script paginates at 50 records/page with a small delay between
requests, but it's still their infrastructure.

## Adding a new country or region

1. Add an entry to `data/manifest.json`:
   ```json
   { "name": "Taiwan", "slug": "taiwan", "region": "East Asia", "filter_value": "Taiwan", "count": 0, "populated": false }
   ```
   `filter_value` is what Credly's API expects for `filter[location_name]`.
   It's usually the plain English country name, but not always — Credly
   stores South Korea as `"Korea, Republic of"`, discovered by trial and
   error. If a new country returns 0 results, try variants (ISO name, capital
   city, etc.) against the API directly before assuming there's no data.
2. Run `node scripts/fetch-data.mjs taiwan`.
3. Commit the new `data/countries/taiwan.json` and the updated manifest.

The frontend needs no code changes — it reads the manifest at load time and
renders whatever regions/countries are listed.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Repo Settings → Pages → Deploy from branch → `main`, folder `/ (root)`.
3. Done — it's a static site, nothing else to configure.

## Keeping data fresh (optional)

A sample GitHub Actions workflow is included at
`.github/workflows/update-data.yml`, scheduled weekly. It runs the fetch
script and opens a commit with any changes. Adjust the schedule or countries
list as you like, or remove it if you'd rather refresh manually.

## Disclaimer

This project is not affiliated with, endorsed by, or built by NVIDIA or
Credly. All data comes from Credly's own public, unauthenticated directory
API — nothing here required a login or bypassed access controls. If you're
listed here and would rather not be, your recourse is your Credly privacy
settings (this directory only ever shows what an earner has already made
public on Credly).

## License

MIT — see [LICENSE](LICENSE).
