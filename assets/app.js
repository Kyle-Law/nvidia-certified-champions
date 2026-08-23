(function () {
  "use strict";

  const CREDLY = "https://www.credly.com";
  const PAGE_SIZE = 40;

  // Groups each NVIDIA cert abbreviation into the same four tracks NVIDIA
  // itself uses at nvidia.com/en-us/learn/certification/. Retired certs
  // (NCP-IB, NCA-AIDC) are bucketed into the track they're closest to.
  const CERT_CATEGORY = {
    "NCA-AIIO": "AI Infra",
    "NCP-AII": "AI Infra",
    "NCP-AIO": "AI Infra",
    "NCP-AIN": "AI Infra",
    "NCP-ARI": "AI Infra",
    "NCP-IB": "AI Infra",
    "NCA-AIDC": "AI Infra",
    "NCA-ADS": "Data Science",
    "NCP-ADS": "Data Science",
    "NCA-GENL": "Gen AI",
    "NCA-GENM": "Gen AI",
    "NCP-GENL": "Gen AI",
    "NCP-AAI": "Gen AI",
    "NCP-OUSD": "Physical AI",
  };
  // CSS class carries the per-category underline color shown on each
  // person's cert chips.
  const CATEGORY_META = {
    "AI Infra": { cls: "cat-infra" },
    "Data Science": { cls: "cat-ds" },
    "Gen AI": { cls: "cat-genai" },
    "Physical AI": { cls: "cat-physai" },
  };
  // Every filterable abbreviation, ordered by category (AI Infra, Data
  // Science, Gen AI, Physical AI) so adjacent chips read as grouped even
  // without a label — mirrors CERT_CATEGORY above.
  const CERT_ORDER = Object.keys(CERT_CATEGORY);

  // Flag emoji shown on each country chip instead of the name (name moves
  // to the title/aria-label). Keyed by manifest.json's country `name`.
  const COUNTRY_FLAG = {
    Malaysia: "🇲🇾",
    Singapore: "🇸🇬",
    Indonesia: "🇮🇩",
    Thailand: "🇹🇭",
    Vietnam: "🇻🇳",
    Philippines: "🇵🇭",
    India: "🇮🇳",
    China: "🇨🇳",
    Japan: "🇯🇵",
    "South Korea": "🇰🇷",
    Australia: "🇦🇺",
  };

  /** @type {{countries: any[]}} */
  let manifest = null;
  /** @type {Map<string, any[]>} country slug -> array of person records (with .country/.region attached) */
  const dataCache = new Map();

  /** @type {Set<string>} country names selected; empty = All */
  const selectedCountries = new Set();
  /** @type {Set<string>} cert abbreviations selected (OR'd); empty = no filter */
  const selectedCerts = new Set();
  let searchTerm = "";
  let sortMode = "badges-desc";
  let k8sOnly = false;
  let visibleCount = PAGE_SIZE;

  const els = {
    countryDropdown: document.getElementById("countryDropdown"),
    countryDropdownToggle: document.getElementById("countryDropdownToggle"),
    countryDropdownBadge: document.getElementById("countryDropdownBadge"),
    countryDropdownPanel: document.getElementById("countryDropdownPanel"),
    certChips: document.getElementById("certChips"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    k8sFilter: document.getElementById("k8sFilter"),
    peopleList: document.getElementById("peopleList"),
    emptyState: document.getElementById("emptyState"),
    notLoadedState: document.getElementById("notLoadedState"),
    notLoadedBody: document.getElementById("notLoadedBody"),
    loadMoreWrap: document.getElementById("loadMoreWrap"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    statVisible: document.getElementById("statVisible"),
    statRegion: document.getElementById("statRegion"),
  };

  init();

  async function init() {
    manifest = await fetchJSON("data/manifest.json");
    renderCountryDropdown();
    bindControls();
    bindCountryDropdownToggle();
    await loadPopulatedCountries();
    renderCertChips(); // needs data loaded to compute per-cert counts
    render();
  }

  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    return res.json();
  }

  async function loadPopulatedCountries() {
    const populated = manifest.countries.filter((c) => c.populated);
    await Promise.all(
      populated.map(async (c) => {
        if (dataCache.has(c.slug)) return;
        try {
          const raw = await fetchJSON(`data/countries/${c.slug}.json`);
          const withMeta = raw.map((p) => ({ ...p, country: c.name, region: c.region }));
          dataCache.set(c.slug, withMeta);
        } catch (e) {
          console.error(e);
          dataCache.set(c.slug, []);
        }
      })
    );
  }

  // Multi-select dropdown: a checkbox row per country (flag + count), plus
  // an "All countries" row that clears the selection. Panel content is
  // static once built (just checked state changes), so no full re-render is
  // needed per toggle — only the badge and checked attributes update.
  function renderCountryDropdown() {
    const panel = els.countryDropdownPanel;
    panel.innerHTML = "";

    const allRow = document.createElement("label");
    allRow.className = "countryDropdown__row countryDropdown__row--all";
    const allCount = manifest.countries.reduce((sum, c) => sum + c.count, 0);
    allRow.innerHTML = `<input type="checkbox"><span>All countries</span><span class="countryDropdown__count">${allCount.toLocaleString()}</span>`;
    const allInput = allRow.querySelector("input");
    allInput.checked = selectedCountries.size === 0;
    allInput.addEventListener("change", () => {
      selectedCountries.clear();
      visibleCount = PAGE_SIZE;
      syncCountryDropdown();
      renderCertChips();
      render();
    });
    panel.appendChild(allRow);
    panel.appendChild(document.createElement("hr")).className = "countryDropdown__divider";

    for (const c of manifest.countries) {
      const row = document.createElement("label");
      row.className = "countryDropdown__row" + (!c.populated ? " is-unpopulated" : "");
      row.title = c.name;
      row.innerHTML = `<input type="checkbox"><span class="countryDropdown__flag">${COUNTRY_FLAG[c.name] || ""}</span><span class="countryDropdown__count">${c.count.toLocaleString()}</span>`;
      const input = row.querySelector("input");
      input.checked = selectedCountries.has(c.name);
      input.addEventListener("change", (e) => {
        if (e.target.checked) selectedCountries.add(c.name);
        else selectedCountries.delete(c.name);
        visibleCount = PAGE_SIZE;
        syncCountryDropdown();
        renderCertChips();
        render();
      });
      panel.appendChild(row);
    }

    updateCountryDropdownBadge();
  }

  // Re-checks each row's checkbox to match `selectedCountries` without
  // rebuilding the panel (avoids losing focus/scroll while it's open).
  function syncCountryDropdown() {
    const rows = els.countryDropdownPanel.querySelectorAll(".countryDropdown__row");
    rows[0].querySelector("input").checked = selectedCountries.size === 0;
    for (let i = 1; i < rows.length; i++) {
      const c = manifest.countries[i - 1];
      rows[i].querySelector("input").checked = selectedCountries.has(c.name);
    }
    updateCountryDropdownBadge();
  }

  function updateCountryDropdownBadge() {
    els.countryDropdownBadge.textContent = selectedCountries.size === 0 ? "All" : String(selectedCountries.size);
  }

  function bindCountryDropdownToggle() {
    els.countryDropdownToggle.addEventListener("click", () => {
      const willOpen = els.countryDropdownPanel.hidden;
      els.countryDropdownPanel.hidden = !willOpen;
      els.countryDropdownToggle.setAttribute("aria-expanded", String(willOpen));
    });
    document.addEventListener("click", (e) => {
      if (!els.countryDropdown.contains(e.target)) closeCountryDropdown();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCountryDropdown();
    });
  }

  function closeCountryDropdown() {
    els.countryDropdownPanel.hidden = true;
    els.countryDropdownToggle.setAttribute("aria-expanded", "false");
  }

  function makeChip(label, count, isActive) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filterchip" + (isActive ? " is-active" : "");
    chip.innerHTML = `${escapeHTML(label)} <span class="filterchip__count">${count.toLocaleString()}</span>`;
    return chip;
  }

  // Minimal filter chips, all in one flowing row (wraps on narrow screens).
  // Just the abbreviations — no category labels or per-category colors here;
  // that grouping is still visible via the underline on each person's row
  // chips. CERT_ORDER keeps related certs adjacent for a sensible reading
  // order even without labels. Counts reflect the current country selection
  // only.
  function renderCertChips() {
    if (!manifest) return; // called once before init's first data load
    const pool = collectRecords().records || [];
    const counts = new Map(CERT_ORDER.map((a) => [a, 0]));
    for (const p of pool) {
      if (!p.certs) continue;
      for (const c of p.certs) if (counts.has(c.a)) counts.set(c.a, counts.get(c.a) + 1);
    }

    els.certChips.innerHTML = "";

    const allChip = makeChip("All", pool.length, selectedCerts.size === 0);
    allChip.addEventListener("click", () => {
      selectedCerts.clear();
      visibleCount = PAGE_SIZE;
      renderCertChips();
      render();
    });
    els.certChips.appendChild(allChip);

    for (const abbr of CERT_ORDER) {
      const chip = makeChip(abbr, counts.get(abbr) || 0, selectedCerts.has(abbr));
      chip.addEventListener("click", () => {
        if (selectedCerts.has(abbr)) selectedCerts.delete(abbr);
        else selectedCerts.add(abbr);
        visibleCount = PAGE_SIZE;
        renderCertChips();
        render();
      });
      els.certChips.appendChild(chip);
    }
  }

  function bindControls() {
    els.searchInput.addEventListener("input", (e) => {
      searchTerm = e.target.value.trim().toLowerCase();
      visibleCount = PAGE_SIZE;
      render();
    });
    els.sortSelect.addEventListener("change", (e) => {
      sortMode = e.target.value;
      render();
    });
    els.k8sFilter.addEventListener("change", (e) => {
      k8sOnly = e.target.checked;
      visibleCount = PAGE_SIZE;
      render();
    });
    els.loadMoreBtn.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      render();
    });
  }

  function collectRecords() {
    // Empty selection = every country.
    const chosen =
      selectedCountries.size === 0
        ? manifest.countries
        : manifest.countries.filter((c) => selectedCountries.has(c.name));

    // Selection is entirely countries whose per-person data hasn't been
    // fetched yet — show the "not fetched" state instead of an empty list.
    if (chosen.every((c) => !c.populated)) return { records: null, notLoaded: chosen };

    let pool = [];
    for (const c of chosen) {
      if (c.populated) pool = pool.concat(dataCache.get(c.slug) || []);
    }
    return { records: pool, notLoaded: null };
  }

  function applySearch(records) {
    if (!searchTerm) return records;
    return records.filter((p) => {
      const hay = `${p.name || ""} ${p.role || ""} ${p.location || ""} ${p.bn || ""} ${p.country || ""}`.toLowerCase();
      return hay.includes(searchTerm);
    });
  }

  function applyK8sFilter(records) {
    if (!k8sOnly) return records;
    return records.filter((p) => p.k8s && p.k8s.length);
  }

  // AND semantics (unlike country, which is OR): selecting multiple certs
  // narrows to people who hold ALL of them — e.g. NCP-AIO + NCP-AIN finds
  // people holding that specific combination, not either one alone.
  function applyCertFilter(records) {
    if (selectedCerts.size === 0) return records;
    return records.filter((p) => {
      if (!p.certs) return false;
      const held = new Set(p.certs.map((c) => c.a));
      return [...selectedCerts].every((a) => held.has(a));
    });
  }

  function applySort(records) {
    const arr = records.slice();
    switch (sortMode) {
      case "date-asc":
        arr.sort((a, b) => new Date(a.bd || 0) - new Date(b.bd || 0));
        break;
      case "name-asc":
        arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "badges-desc":
        arr.sort((a, b) => (certCount(b) || 0) - (certCount(a) || 0));
        break;
      case "date-desc":
      default:
        arr.sort((a, b) => new Date(b.bd || 0) - new Date(a.bd || 0));
    }
    return arr;
  }

  function render() {
    const { records, notLoaded } = collectRecords();

    if (notLoaded) {
      els.peopleList.innerHTML = "";
      els.emptyState.hidden = true;
      els.loadMoreWrap.hidden = true;
      els.notLoadedState.hidden = false;
      const names = notLoaded.map((c) => c.name).join(", ");
      const totalCount = notLoaded.reduce((sum, c) => sum + c.count, 0);
      const verb = notLoaded.length > 1 ? "have" : "has";
      els.notLoadedBody.textContent =
        `${names} ${verb} ${totalCount.toLocaleString()} known NVIDIA badge holders on Credly, ` +
        `but the per-person list hasn't been fetched into this repo yet. Run the fetch script to pull it in:`;
      els.statVisible.textContent = "0";
      els.statRegion.textContent = apacKnownTotal().toLocaleString();
      return;
    }

    els.notLoadedState.hidden = true;

    const filtered = applySort(applyCertFilter(applyK8sFilter(applySearch(records))));
    const slice = filtered.slice(0, visibleCount);

    els.peopleList.innerHTML = "";
    for (const p of slice) {
      els.peopleList.appendChild(renderPerson(p));
    }

    els.emptyState.hidden = filtered.length !== 0;
    els.loadMoreWrap.hidden = filtered.length <= visibleCount;

    els.statVisible.textContent = filtered.length.toLocaleString();
    els.statRegion.textContent = apacKnownTotal().toLocaleString();
  }

  function apacKnownTotal() {
    return manifest.countries.reduce((sum, c) => sum + c.count, 0);
  }

  function renderPerson(p) {
    const li = document.createElement("li");
    li.className = "person";

    const profileUrl = p.p ? CREDLY + p.p : null;
    const badgeUrl = p.bp ? CREDLY + p.bp : null;
    const metaParts = [p.role, p.location, p.country].filter(Boolean);

    li.innerHTML = `
      <div class="person__id">
        <div class="person__name">${
          profileUrl
            ? `<a href="${escapeAttr(profileUrl)}" target="_blank" rel="noopener">${escapeHTML(p.name || "—")}</a>`
            : escapeHTML(p.name || "—")
        }</div>
        <div class="person__meta">${escapeHTML(metaParts.join(" · ") || "\u00A0")}</div>
      </div>
      <div class="person__badge">${renderCerts(p, badgeUrl)}${renderK8sChips(p)}</div>
      <div class="person__count" title="${certCountTitle(p)}">${certCount(p)}</div>
    `;
    return li;
  }

  // Once enriched, count = number of formal certifications (matches the
  // chips shown). Un-enriched countries fall back to bc (NVIDIA badges of
  // any kind, per the directory API), same as before enrichment existed.
  function certCount(p) {
    return p.certs ? p.certs.length : p.bc ?? "—";
  }
  function certCountTitle(p) {
    return p.certs ? "NVIDIA certifications earned" : "NVIDIA badges earned";
  }

  // p.certs is the list of NVIDIA *certification* badges (added by
  // scripts/enrich-certs.mjs), each reduced to its abbreviation (NCA-AIIO,
  // NCP-AIO, ...). Countries that haven't been enriched yet, and people whose
  // only NVIDIA badge is a non-certification one (e.g. "AI Ignite"), fall back
  // to showing that badge's name + date the way this used to always work.
  function renderCerts(p, badgeUrl) {
    if (p.certs && p.certs.length) {
      const extra = (c) => CATEGORY_META[CERT_CATEGORY[c.a]]?.cls || "";
      const extraTitle = (c) => CERT_CATEGORY[c.a] || "";
      return `<div class="chiprow">${chipList(p.certs, "certchip", extra, extraTitle)}</div>`;
    }
    const dateStr = p.bd ? p.bd.slice(0, 10) : "";
    return `
      <div class="person__badge-name">${
        badgeUrl
          ? `<a href="${escapeAttr(badgeUrl)}" target="_blank" rel="noopener">${escapeHTML(p.bn || "—")}</a>`
          : escapeHTML(p.bn || "—")
      }</div>
      <div class="person__badge-date">${dateStr}</div>
    `;
  }

  // p.k8s is the list of Kubernetes certifications (CKA/CKAD/CKS, spotted
  // alongside NVIDIA certs by scripts/enrich-certs.mjs) — shown as a second,
  // differently-colored row of chips. Purely additive: absent/empty renders
  // nothing.
  function renderK8sChips(p) {
    if (!p.k8s || !p.k8s.length) return "";
    return `<div class="chiprow">${chipList(p.k8s, "k8schip")}</div>`;
  }

  function chipList(certs, className, extraClassFn, extraTitleFn) {
    return certs
      .map((c) => {
        const url = c.u ? CREDLY + c.u : null;
        const dateStr = c.d ? c.d.slice(0, 10) : "";
        const cls = className + (extraClassFn ? " " + extraClassFn(c) : "");
        const title = extraTitleFn ? [extraTitleFn(c), dateStr].filter(Boolean).join(" · ") : dateStr;
        return url
          ? `<a class="${cls}" href="${escapeAttr(url)}" target="_blank" rel="noopener" title="${escapeAttr(title)}">${escapeHTML(c.a)}</a>`
          : `<span class="${cls}" title="${escapeAttr(title)}">${escapeHTML(c.a)}</span>`;
      })
      .join("");
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(str) {
    return escapeHTML(str);
  }
})();
