#!/usr/bin/env node
/**
 * enrich-certs.mjs
 * ---------------------------------------------------------------
 * Adds two fields to each person record in data/countries/*.json:
 *   - `certs`: NVIDIA-issued *certification* badges they hold (not just
 *     the single "most recent" one that fetch-data.mjs captures), each
 *     reduced to its official abbreviation (NCA-AIIO, NCP-AIO, etc.).
 *   - `k8s`: Kubernetes certifications (CKA/CKAD/CKS, issued by The Linux
 *     Foundation) — same shape, spotted in the same per-person badge fetch
 *     since it already returns every issuer, not just NVIDIA.
 *
 * Why a separate script: fetch-data.mjs's directory endpoint only ever
 * returns one badge per person (`highlighted_badges[0]`). Getting the
 * full list requires one extra request PER PERSON against their
 * individual profile (`/users/{vanity}/badges.json`), which is a much
 * bigger, slower operation — worth keeping as an opt-in second pass
 * rather than folding into the main fetch.
 *
 * Usage:
 *   node scripts/enrich-certs.mjs                  # enrich every populated country
 *   node scripts/enrich-certs.mjs malaysia singapore # just these
 *   node scripts/enrich-certs.mjs --force           # re-fetch even if certs[]/k8s[] already present
 *
 * Requires Node.js 18+.
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
const CONCURRENCY = 8; // simultaneous per-person requests
const USER_AGENT = "Mozilla/5.0 (compatible; apac-nvidia-directory-fetcher/1.0; +https://github.com)";

// Credly's display name for each NVIDIA certification -> official abbreviation
// (from https://www.nvidia.com/en-us/learn/certification/). Names are
// normalized before lookup (see normalizeCertName) to absorb the "NVIDIA-Certified"
// vs "NVIDIA Certified" and "Gen AI" vs "Generative AI" inconsistencies Credly
// itself has across badge templates.
const CERT_ABBR = {
  "nvidia certified associate ai infrastructure and operations": "NCA-AIIO",
  "nvidia certified associate generative ai llms": "NCA-GENL",
  "nvidia certified associate generative ai multimodal": "NCA-GENM",
  "nvidia certified associate accelerated data science": "NCA-ADS",
  "nvidia certified professional ai infrastructure": "NCP-AII",
  "nvidia certified professional ai operations": "NCP-AIO",
  "nvidia certified professional ai networking": "NCP-AIN",
  "nvidia certified professional ai rack and interconnect": "NCP-ARI",
  "nvidia certified professional accelerated data science": "NCP-ADS",
  "nvidia certified professional generative ai llms": "NCP-GENL",
  "nvidia certified professional agentic ai": "NCP-AAI",
  "nvidia certified professional openusd development": "NCP-OUSD",
  // Retired/legacy exams — still shown if someone holds one.
  "nvidia certified professional infiniband": "NCP-IB",
  "nvidia certified associate ai in the data center": "NCA-AIDC",
};

// The three official Linux Foundation Kubernetes certifications. Spotted
// as a side effect of fetching each person's full badge list for NVIDIA
// certs — no extra requests needed.
const K8S_ABBR = {
  "cka certified kubernetes administrator": "CKA",
  "ckad certified kubernetes application developer": "CKAD",
  "cks certified kubernetes security specialist": "CKS",
};

function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/:/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCertName(name) {
  return normalizeName(name).replace(/\bgen ai\b/, "generative ai");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs async `worker` over `items` with at most `limit` in flight at once. */
async function runPool(items, limit, worker) {
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function dedupeSorted(list) {
  // Dedupe by abbreviation, keeping the most recent instance of each.
  const byAbbr = new Map();
  for (const c of list) {
    const existing = byAbbr.get(c.a);
    if (!existing || new Date(c.d) > new Date(existing.d)) byAbbr.set(c.a, c);
  }
  return [...byAbbr.values()].sort((x, y) => new Date(y.d) - new Date(x.d));
}

/** Fetches all badges for one person; returns { certs, k8s, unmapped }. */
async function fetchUserCerts(vanityPath) {
  const certs = [];
  const k8s = [];
  const unmapped = [];
  let url = `https://www.credly.com${vanityPath}/badges.json?per=48`;

  while (url) {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const json = await res.json();

    for (const b of json.data || []) {
      const name = b.badge_template?.name || "";
      const issuerId = b.issuer?.entities?.[0]?.entity?.id;
      const date = b.issued_at || b.accepted_at || b.issued_at_date || "";
      const entry = { d: date, u: `/badges/${b.id}` };

      if (issuerId === ORG_ID) {
        const abbr = CERT_ABBR[normalizeCertName(name)];
        if (abbr) certs.push({ ...entry, a: abbr });
        else unmapped.push(name); // NVIDIA badge, but not a formal cert (e.g. "AI Ignite") — skip
        continue;
      }

      const k8sAbbr = K8S_ABBR[normalizeName(name)];
      if (k8sAbbr) k8s.push({ ...entry, a: k8sAbbr });
    }

    const next = json.metadata?.next_page_url;
    url = next ? (next.startsWith("http") ? next : `https://www.credly.com${next}`) : null;
  }

  return { certs: dedupeSorted(certs), k8s: dedupeSorted(k8s), unmapped };
}

async function enrichCountry(country, force) {
  const filePath = path.join(COUNTRIES_DIR, `${country.slug}.json`);
  let records;
  try {
    records = JSON.parse(await readFile(filePath, "utf-8"));
  } catch (e) {
    console.error(`  ! skipping ${country.name}: ${e.message}`);
    return;
  }

  const targets = force ? records : records.filter((r) => !r.certs || !("k8s" in r));
  if (targets.length === 0) {
    console.log(`\n→ ${country.name}: all ${records.length} already enriched, skipping (use --force to redo)`);
    return;
  }

  console.log(`\n→ ${country.name}: enriching ${targets.length}/${records.length} people`);

  let done = 0;
  let failed = 0;
  const unmappedSeen = new Set();

  await runPool(targets, CONCURRENCY, async (record) => {
    try {
      const { certs, k8s, unmapped } = await fetchUserCerts(record.p);
      record.certs = certs;
      record.k8s = k8s;
      for (const n of unmapped) unmappedSeen.add(n);
    } catch (e) {
      failed += 1;
      console.error(`\n  ! failed for ${record.name} (${record.p}): ${e.message}`);
    }
    done += 1;
    process.stdout.write(`  ${done}/${targets.length} (${failed} failed)\r`);
  });

  console.log(`\n  done — ${done}/${targets.length}, ${failed} failed`);
  if (unmappedSeen.size) {
    console.log(`  NVIDIA badges seen but not mapped to a cert abbreviation (not counted in certs[]):`);
    for (const n of unmappedSeen) console.log(`    - ${n}`);
  }

  await writeFile(filePath, JSON.stringify(records), "utf-8");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const wanted = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf-8"));
  const targets = manifest.countries.filter(
    (c) => c.populated && (wanted.length === 0 || wanted.includes(c.slug) || wanted.includes(c.name.toLowerCase()))
  );

  if (targets.length === 0) {
    console.error("No matching populated countries. Check spelling or run fetch-data.mjs first.");
    process.exitCode = 1;
    return;
  }

  const start = Date.now();
  for (const country of targets) {
    await enrichCountry(country, force);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nAll done in ${elapsed}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
