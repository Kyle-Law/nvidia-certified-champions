#!/usr/bin/env node
/**
 * fetch-data.mjs
 * ---------------------------------------------------------------
 * Pulls NVIDIA's public Credly earner directory, filtered per
 * country, and writes compact JSON files into data/countries/.
 * Then refreshes data/manifest.json (counts + populated flags).
 *
 * Requires Node.js 18+ (uses the built-in fetch).
 *
 * Usage:
 *   node scripts/fetch-data.mjs                 # fetch every country in the manifest
 *   node scripts/fetch-data.mjs india china      # fetch only these countries (by slug or name)
 *   node scripts/fetch-data.mjs --list           # show configured countries and exit
 *
 * Credly's directory is public and unauthenticated, but be a good
 * citizen: this script paginates at 50 records/page (Credly's max)
 * and waits briefly between requests.
 * ---------------------------------------------------------------
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "data", "manifest.json");
const COUNTRIES_DIR = path.join(ROOT, "data", "countries");

const ORG_ID = "be046724-f99a-4626-922e-425eca1efa2e"; // NVIDIA's organization_id on Credly
const PER_PAGE = 50; // Credly's observed max page size
const REQUEST_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCountryPage(filterValue, page) {
  const url =
    `https://www.credly.com/api/v1/directory` +
    `?organization_id=${ORG_ID}` +
    `&per=${PER_PAGE}` +
    `&page=${page}` +
    `&filter%5Blocation_name%5D=${encodeURIComponent(filterValue)}`;

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; apac-nvidia-directory-fetcher/1.0; +https://github.com)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${filterValue} page ${page}`);
  }
  return res.json();
}

function toCompactRecord(r) {
  // most_recently_accepted_credential is the person's most recent badge from
  // ANY issuer on Credly — not necessarily NVIDIA. highlighted_badges is
  // already scoped to this request's organization_id, so it's the NVIDIA
  // badge to show. Fall back to most_recently_accepted_credential only if
  // highlighted_badges is ever empty (shouldn't happen given the org filter).
  const nvidiaBadge = (r.highlighted_badges && r.highlighted_badges[0]) || r.most_recently_accepted_credential || {};
  const name = [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ");
  return {
    id: r.id,
    name,
    role: r.role || "",
    location: r.location || "",
    bc: r.badge_count,
    tbc: r.total_badge_count,
    bn: nvidiaBadge.name || "",
    bd: nvidiaBadge.date || "",
    p: r.vanity_url || "",
    bp: nvidiaBadge.url || "",
  };
}

async function fetchCountry(country) {
  const { name, filter_value } = country;
  console.log(`\n→ ${name} (filter: "${filter_value}")`);

  let page = 1;
  let totalPages = 1;
  let totalCount = 0;
  const records = [];

  do {
    const json = await fetchCountryPage(filter_value, page);
    totalPages = json.metadata?.total_pages ?? 1;
    totalCount = json.metadata?.total_count ?? json.data.length;

    for (const r of json.data) records.push(toCompactRecord(r));

    process.stdout.write(`  page ${page}/${totalPages} (${records.length}/${totalCount})\r`);
    page += 1;
    if (page <= totalPages) await sleep(REQUEST_DELAY_MS);
  } while (page <= totalPages);

  console.log(`  done — ${records.length} records`);
  return { records, totalCount };
}

async function main() {
  const args = process.argv.slice(2);

  const manifestRaw = await readFile(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(manifestRaw);

  if (args.includes("--list")) {
    for (const c of manifest.countries) {
      console.log(`${c.slug.padEnd(14)} ${c.name.padEnd(16)} region=${c.region.padEnd(14)} known_count=${c.count}`);
    }
    return;
  }

  const wanted = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());
  const targets = manifest.countries.filter(
    (c) => wanted.length === 0 || wanted.includes(c.slug) || wanted.includes(c.name.toLowerCase())
  );

  if (targets.length === 0) {
    console.error("No matching countries. Use --list to see valid slugs/names.");
    process.exitCode = 1;
    return;
  }

  for (const country of targets) {
    try {
      const { records, totalCount } = await fetchCountry(country);
      const outPath = path.join(COUNTRIES_DIR, `${country.slug}.json`);
      await writeFile(outPath, JSON.stringify(records), "utf-8");

      // Update this country's entry in-memory; write manifest once at the end.
      country.count = totalCount;
      country.populated = true;
    } catch (err) {
      console.error(`  ! failed to fetch ${country.name}:`, err.message);
    }
  }

  manifest.generated_at = new Date().toISOString().slice(0, 10);
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`\nUpdated ${path.relative(ROOT, MANIFEST_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
