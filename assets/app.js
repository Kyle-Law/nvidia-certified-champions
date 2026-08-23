(function () {
  "use strict";

  const CREDLY = "https://www.credly.com";
  const PAGE_SIZE = 40;

  /** @type {{countries: any[]}} */
  let manifest = null;
  /** @type {Map<string, any[]>} country slug -> array of person records (with .country/.region attached) */
  const dataCache = new Map();

  let activeRegion = "All";
  /** @type {Set<string>} country names selected; empty = All (within activeRegion) */
  const selectedCountries = new Set();
  let searchTerm = "";
  let sortMode = "badges-desc";
  let k8sOnly = false;
  let visibleCount = PAGE_SIZE;

  const els = {
    regionTabs: document.getElementById("regionTabs"),
    countryChips: document.getElementById("countryChips"),
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
    renderRegionTabs();
    renderCountryChips();
    bindControls();
    await loadPopulatedCountries();
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

  function renderRegionTabs() {
    const regions = ["All", ...new Set(manifest.countries.map((c) => c.region))];
    els.regionTabs.innerHTML = "";
    for (const region of regions) {
      const btn = document.createElement("button");
      btn.className = "regiontab" + (region === activeRegion ? " is-active" : "");
      btn.textContent = region;
      btn.addEventListener("click", () => {
        activeRegion = region;
        selectedCountries.clear();
        visibleCount = PAGE_SIZE;
        renderRegionTabs();
        renderCountryChips();
        render();
      });
      els.regionTabs.appendChild(btn);
    }
  }

  function renderCountryChips() {
    const inRegion =
      activeRegion === "All"
        ? manifest.countries
        : manifest.countries.filter((c) => c.region === activeRegion);

    els.countryChips.innerHTML = "";

    // "All" clears the multi-select back to the whole region.
    const allChip = makeChip("All", inRegion.reduce((sum, c) => sum + c.count, 0), true, selectedCountries.size === 0);
    allChip.addEventListener("click", () => {
      selectedCountries.clear();
      visibleCount = PAGE_SIZE;
      renderCountryChips();
      render();
    });
    els.countryChips.appendChild(allChip);

    // Individual chips toggle in/out of the selection (multi-select) rather
    // than replacing it — lets you pick e.g. Singapore + Malaysia + Vietnam.
    for (const c of inRegion) {
      const chip = makeChip(c.name, c.count, c.populated, selectedCountries.has(c.name));
      chip.addEventListener("click", () => {
        if (selectedCountries.has(c.name)) selectedCountries.delete(c.name);
        else selectedCountries.add(c.name);
        visibleCount = PAGE_SIZE;
        renderCountryChips();
        render();
      });
      els.countryChips.appendChild(chip);
    }
  }

  function makeChip(label, count, populated, isActive) {
    const chip = document.createElement("button");
    chip.className = "chip" + (isActive ? " is-active" : "") + (!populated ? " is-unpopulated" : "");
    chip.innerHTML = `<span class="chip__count">${count.toLocaleString()}</span><span>${label}</span>`;
    return chip;
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
    const scope =
      activeRegion === "All" ? manifest.countries : manifest.countries.filter((c) => c.region === activeRegion);
    // Empty selection = every country in the current region scope. A
    // selection that doesn't match anything in scope (e.g. left over from
    // switching regions) also falls back to the full scope rather than
    // showing zero results.
    const matched = selectedCountries.size === 0 ? [] : scope.filter((c) => selectedCountries.has(c.name));
    const chosen = matched.length > 0 ? matched : scope;

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
      els.statRegion.textContent = regionKnownTotal().toLocaleString();
      return;
    }

    els.notLoadedState.hidden = true;

    const filtered = applySort(applyK8sFilter(applySearch(records)));
    const slice = filtered.slice(0, visibleCount);

    els.peopleList.innerHTML = "";
    for (const p of slice) {
      els.peopleList.appendChild(renderPerson(p));
    }

    els.emptyState.hidden = filtered.length !== 0;
    els.loadMoreWrap.hidden = filtered.length <= visibleCount;

    els.statVisible.textContent = filtered.length.toLocaleString();
    els.statRegion.textContent = regionKnownTotal().toLocaleString();
  }

  function regionKnownTotal() {
    const scope =
      activeRegion === "All" ? manifest.countries : manifest.countries.filter((c) => c.region === activeRegion);
    return scope.reduce((sum, c) => sum + c.count, 0);
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
      return `<div class="chiprow">${chipList(p.certs, "certchip")}</div>`;
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

  function chipList(certs, className) {
    return certs
      .map((c) => {
        const url = c.u ? CREDLY + c.u : null;
        const dateStr = c.d ? c.d.slice(0, 10) : "";
        return url
          ? `<a class="${className}" href="${escapeAttr(url)}" target="_blank" rel="noopener" title="${escapeAttr(dateStr)}">${escapeHTML(c.a)}</a>`
          : `<span class="${className}" title="${escapeAttr(dateStr)}">${escapeHTML(c.a)}</span>`;
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
