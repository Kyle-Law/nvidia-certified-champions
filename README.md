# NVIDIA Certified Directory

A searchable, filterable directory of NVIDIA-certified professionals, built
from Credly's public earner directory. Pure static frontend (HTML/CSS/JS, no
build step, no framework) reading flat JSON files as its "backend."

**Currently covers Asia-Pacific and Europe (8,000+ people, 31 countries).** The data
pipeline and schema aren't APAC-specific — adding another region is just
adding countries to `data/manifest.json` and running the fetch scripts (see
[Adding a new country](#adding-a-new-country) below). Nothing about the UI,
filtering, or enrichment logic assumes APAC; the scope is a starting point,
not a ceiling.

**[Live demo →](https://kyle-law.github.io/nvidia-certified-champions/)**

## Why this exists

NVIDIA publishes its Credly badge directory publicly, but it's one long
un-filterable page per organization with no cross-country view, no way to
search by name or role, and no breakdown of *which* certifications someone
holds. This repo re-packages that same public data as a fast, filterable
directory with a data pipeline you can re-run to keep it current.

## Features

- **Search** by name, role, location, or badge name.
- **Sort** by most NVIDIA certs, newest/oldest badge, or name.
- **Country filter** — multi-select dropdown (flag + name + count per
  country), OR logic: picking Singapore + Malaysia shows people from either.
- **NVIDIA cert filter** — one chip per certification abbreviation
  (NCA-AIIO, NCP-AIO, ...), AND logic: picking two certs narrows to people
  holding *both*, so you can find a specific combination. Each person's cert
  chips carry a small colored underline identifying which of NVIDIA's four
  certification tracks (AI Infrastructure, Data Science, Generative AI,
  Physical AI) it belongs to.
- **Kubernetes cert filter** — a toggle for people who also hold a CKA,
  CKAD, or CKS (spotted as a side effect of the NVIDIA-cert enrichment pass,
  see below).

## Current coverage

| Region | Country | Status |
|---|---|---|
| Southeast Asia | Malaysia | ✅ 108 people loaded |
| Southeast Asia | Singapore | ✅ 397 people loaded |
| Southeast Asia | Indonesia | ✅ 76 people loaded |
| Southeast Asia | Thailand | ✅ 43 people loaded |
| Southeast Asia | Vietnam | ✅ 149 people loaded |
| Southeast Asia | Philippines | ✅ 43 people loaded |
| South Asia | India | ✅ 2,871 people loaded |
| East Asia | China | ✅ 1,067 people loaded |
| East Asia | Japan | ✅ 388 people loaded |
| East Asia | South Korea | ✅ 457 people loaded |
| Oceania | Australia | ✅ 249 people loaded |
| Western Europe | United Kingdom | ✅ 467 people loaded |
| Western Europe | Germany | ✅ 390 people loaded |
| Western Europe | France | ✅ 281 people loaded |
| Western Europe | Netherlands | ✅ 104 people loaded |
| Western Europe | Belgium | ✅ 37 people loaded |
| Western Europe | Ireland | ✅ 55 people loaded |
| Western Europe | Austria | ✅ 16 people loaded |
| Western Europe | Switzerland | ✅ 59 people loaded |
| Northern Europe | Sweden | ✅ 57 people loaded |
| Northern Europe | Norway | ✅ 27 people loaded |
| Northern Europe | Finland | ✅ 21 people loaded |
| Northern Europe | Denmark | ✅ 18 people loaded |
| Southern Europe | Spain | ✅ 189 people loaded |
| Southern Europe | Italy | ✅ 134 people loaded |
| Southern Europe | Portugal | ✅ 39 people loaded |
| Southern Europe | Greece | ✅ 15 people loaded |
| Eastern Europe | Poland | ✅ 125 people loaded |
| Eastern Europe | Czech Republic | ✅ 32 people loaded |
| Eastern Europe | Romania | ✅ 35 people loaded |
| Eastern Europe | Ukraine | ✅ 72 people loaded |

"Region" here is just organizational metadata carried in
`data/manifest.json` — the UI doesn't currently group or filter by it, but
it's there and ready for when there's enough non-APAC data to make regional
grouping useful again.

Counts come from Credly's own directory metadata at the time
`data/manifest.json` was last generated; re-run `scripts/fetch-data.mjs` to
refresh them. A country can also be added with `populated: false` (count
only, no per-person data yet) — it shows up in the UI as a disabled option
until fetched. See [Fetching data](#fetching-data).

## Project structure

```
.
├── index.html                # the whole app shell
├── assets/
│   ├── style.css
│   └── app.js                 # loads manifest + country JSON, does all filtering client-side
├── data/
│   ├── manifest.json          # country list, counts, populated flags
│   └── countries/
│       ├── malaysia.json      # [{ id, name, role, location, bc, tbc, bn, bd, p, bp, certs, k8s }, ...]
│       ├── singapore.json
│       └── ...
└── scripts/
    ├── fetch-data.mjs         # Node 18+ script that (re)pulls the base data from Credly
    └── enrich-certs.mjs       # second-pass script: adds certs[] and k8s[] per person
```

`scripts/fetch_data.py` also exists (a Node-independent equivalent of
`fetch-data.mjs`) but isn't kept in sync with `enrich-certs.mjs` — treat
`fetch-data.mjs` as the canonical fetcher.

### Record schema

Each entry in `data/countries/<slug>.json`:

| Field | Meaning |
|---|---|
| `id` | Credly earner id |
| `name` | Full name as shown on Credly |
| `role` | Job title, if the earner set one (often blank) |
| `location` | Free-text city/region the earner entered (often blank) |
| `bc` | Badge count *from NVIDIA specifically* (certifications + non-cert badges like "AI Ignite") |
| `tbc` | Total badge count across *all* issuers on their profile — fetched but not shown in the UI |
| `bn` | Name of their most recently earned NVIDIA badge |
| `bd` | ISO date that badge was accepted |
| `p` | Their Credly profile path (append to `https://www.credly.com`) |
| `bp` | That badge's path (append to `https://www.credly.com`) |
| `certs` | Array of NVIDIA **certifications** they hold (excludes non-cert badges), each `{ a, d, u }` — `a` abbreviation (e.g. `"NCP-AIO"`), `d` ISO date, `u` badge path. Added by `enrich-certs.mjs`; absent until that script has run for the country. |
| `k8s` | Same shape as `certs`, for Kubernetes certifications (CKA/CKAD/CKS) held alongside their NVIDIA ones. Also added by `enrich-certs.mjs`. |

Keys are kept short because these files are committed to git and some
countries run into the thousands of rows.

## Running locally

No build step. Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`. Opening `index.html` directly (`file://`)
won't work — the app fetches its JSON over HTTP, which browsers block from
`file://` pages.

## Fetching data

The frontend never talks to Credly directly — all fetching happens ahead of
time via these scripts, and the site just reads the resulting JSON. There
are two passes:

**1. Base data** — one person per row, their most recent NVIDIA badge only:

```bash
node scripts/fetch-data.mjs                 # refresh every country in the manifest
node scripts/fetch-data.mjs india china      # refresh just these
node scripts/fetch-data.mjs --list           # see all configured slugs
```

This rewrites `data/countries/<slug>.json` for each target and updates
`count`/`populated` in `data/manifest.json`.

**2. Cert enrichment** — adds `certs[]` and `k8s[]` to each person by
fetching their *full* individual badge history (one extra request per
person, so this is slower — budget a few minutes per hundred people):

```bash
node scripts/enrich-certs.mjs                    # enrich every populated country
node scripts/enrich-certs.mjs malaysia singapore  # just these
node scripts/enrich-certs.mjs --force             # re-fetch even if certs[]/k8s[] already present
```

It skips anyone who already has both fields, so re-running after a base
refresh only fetches new/changed people. New NVIDIA badge names it doesn't
recognize (a new certification track, a renamed exam) get logged at the end
of the run rather than silently dropped — check the output and update the
`CERT_ABBR` map at the top of the script if you see one.

Commit the results of both passes. Be reasonable with how often you run
these against Credly's public API — `fetch-data.mjs` paginates at 50
records/page with a small delay between requests, and `enrich-certs.mjs`
caps concurrency at 8 simultaneous requests, but it's still their
infrastructure.

## Adding a new country

1. Add an entry to `data/manifest.json`:
   ```json
   { "name": "Taiwan", "slug": "taiwan", "region": "East Asia", "filter_value": "Taiwan", "count": 0, "populated": false }
   ```
   `filter_value` is what Credly's API expects for `filter[location_name]`.
   It's usually the plain English country name, but not always — Credly
   stores South Korea as `"Korea, Republic of"`, discovered by trial and
   error. If a new country returns 0 results, try variants (ISO name, capital
   city, etc.) against the API directly before assuming there's no data.
   `region` is free text — it doesn't need to match an existing one, and
   currently isn't used by the UI (see [Current coverage](#current-coverage)),
   but keep it accurate for whenever regional grouping comes back.
2. Run `node scripts/fetch-data.mjs taiwan`, then `node scripts/enrich-certs.mjs taiwan`.
3. Commit the new `data/countries/taiwan.json` and the updated manifest.

The frontend needs no code changes — it reads the manifest at load time and
renders whatever countries are listed, populated or not. This is also the
path for expanding beyond APAC entirely: there's nothing region-specific in
`index.html`, `app.js`, or the fetch scripts — just add countries from
wherever, and the directory grows with them.

## Deploying to GitHub Pages

Already deployed at the live demo link above. To do it again elsewhere:

1. Push this repo to GitHub.
2. Repo Settings → Pages → Deploy from branch → `main`, folder `/ (root)`.
3. Done — it's a static site, nothing else to configure.

## Keeping data fresh (optional)

A GitHub Actions workflow is included at
`.github/workflows/update-data.yml`, scheduled weekly. It runs both passes —
`fetch-data.mjs` then `enrich-certs.mjs` — so new people get `certs[]`/
`k8s[]` automatically, not just the base fields.

`fetch-data.mjs` merges by Credly id: it carries forward any existing
`certs[]`/`k8s[]` for a person it already knows about rather than
overwriting them with a bare base record, so a fetch-only re-run (run
manually, without the enrichment step) is safe — it won't erase prior
enrichment. It's still worth running `enrich-certs.mjs` afterward for
whoever's newly added, same as the workflow does.

## Disclaimer

This project is not affiliated with, endorsed by, or built by NVIDIA or
Credly. All data comes from Credly's own public, unauthenticated directory
API — nothing here required a login or bypassed access controls. If you're
listed here and would rather not be, your recourse is your Credly privacy
settings (this directory only ever shows what an earner has already made
public on Credly).

## License

MIT — see [LICENSE](LICENSE).
