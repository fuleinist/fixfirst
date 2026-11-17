const els = {
  form: document.getElementById("calcForm"),
  appliance: document.getElementById("appliance"),
  age: document.getElementById("age"),
  fault: document.getElementById("fault"),
  quote: document.getElementById("quote"),
  tariff: document.getElementById("tariff"),
  newPrice: document.getElementById("newPrice"),
  result: document.getElementById("result"),
  error: document.getElementById("error"),
  quoteHint: document.getElementById("quoteHint"),
  share: document.getElementById("shareBtn"),
  print: document.getElementById("printBtn"),
};

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});
const decimal = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-AU");

const GROUP_LABELS = {
  kitchen: "Kitchen",
  laundry: "Laundry",
  cooling: "Cooling",
  heating: "Heating",
  electronics: "Electronics",
  garden: "Garden",
  personal: "Personal care",
};

const VERDICT_WORDS = {
  repair: "Repair it",
  replace: "Replace it",
  borderline: "Too close to call",
};

let catalog = null;
let lastResult = null;
let runTimer = null;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

const moneyRange = (low, high) =>
  low === high ? money.format(low) : `${money.format(low)}–${money.format(high)}`;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function fillSelects() {
  const byGroup = new Map();
  for (const appliance of catalog.appliances) {
    if (!byGroup.has(appliance.group)) byGroup.set(appliance.group, []);
    byGroup.get(appliance.group).push(appliance);
  }
  for (const [group, list] of byGroup) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = GROUP_LABELS[group] ?? group;
    for (const appliance of list) {
      const option = document.createElement("option");
      option.value = appliance.id;
      option.textContent = appliance.name;
      optgroup.append(option);
    }
    els.appliance.append(optgroup);
  }

  for (const fault of catalog.faults) {
    const option = document.createElement("option");
    option.value = fault.id;
    option.textContent = fault.name;
    option.title = fault.note;
    els.fault.append(option);
  }

  els.tariff.value = String(catalog.defaults.electricityPricePerKwh);
}

function selectedAppliance() {
  return catalog.appliances.find((item) => item.id === els.appliance.value);
}

function selectedFault() {
  return catalog.faults.find((item) => item.id === els.fault.value);
}

function updateQuoteHint() {
  const appliance = selectedAppliance();
  const fault = selectedFault();
  if (!appliance || !fault) return;
  const low = Math.round(fault.costBand[0] * appliance.costFactor);
  const high = Math.round(fault.costBand[1] * appliance.costFactor);
  els.quoteHint.textContent = `Catalog estimate: ${money.format(low)} to ${money.format(high)}. A fixed quote gives a sharper answer.`;
}

function readInput() {
  const numberOrNull = (value) => {
    if (value === "" || value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    applianceId: els.appliance.value,
    ageYears: numberOrNull(els.age.value) ?? 0,
    faultId: els.fault.value,
    quoteAud: numberOrNull(els.quote.value),
    electricityPricePerKwh: numberOrNull(els.tariff.value) ?? catalog.defaults.electricityPricePerKwh,
    newPriceOverride: numberOrNull(els.newPrice.value),
  };
}

function encodeState(input) {
  const json = JSON.stringify(input);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(value) {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function writeHash(input) {
  const url = new URL(window.location.href);
  url.hash = `d=${encodeState(input)}`;
  history.replaceState(null, "", url);
}

function readHash() {
  if (!window.location.hash.startsWith("#d=")) return null;
  return decodeState(window.location.hash.slice(3));
}

function applyState(state) {
  if (!state) return;
  if (state.applianceId) els.appliance.value = state.applianceId;
  if (typeof state.ageYears === "number") els.age.value = String(state.ageYears);
  if (state.faultId) els.fault.value = state.faultId;
  els.quote.value = typeof state.quoteAud === "number" ? String(state.quoteAud) : "";
  if (typeof state.electricityPricePerKwh === "number") {
    els.tariff.value = String(state.electricityPricePerKwh);
  }
  els.newPrice.value = typeof state.newPriceOverride === "number" ? String(state.newPriceOverride) : "";
}

function render(result) {
  const verdict = result.verdict;
  const saving = result.fiveYearSaving;
  const savingLabel =
    saving > 0
      ? `${money.format(saving)} cheaper over five years`
      : saving < 0
        ? `${money.format(Math.abs(saving))} dearer over five years`
        : "Even over five years";

  const maxFive = Math.max(result.repair.fiveYearExpected, result.replace.fiveYearExpected, 1);
  const repairPct = Math.max(4, Math.round((result.repair.fiveYearExpected / maxFive) * 100));
  const replacePct = Math.max(4, Math.round((result.replace.fiveYearExpected / maxFive) * 100));

  const carbonPayback =
    result.carbon.paybackMonths === null ? "No payback" : `${integer.format(result.carbon.paybackMonths)} months`;

  const reasons = result.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");

  const warnings = result.warnings.length
    ? `<div class="warnings"><strong>Read this</strong><ul>${result.warnings
        .map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join("")}</ul></div>`
    : "";

  els.result.innerHTML = `
    <div class="verdict verdict--${verdict}">
      <p class="verdict__eyebrow">Verdict · ${escapeHtml(result.appliance.name)} · ${escapeHtml(result.fault.name)}</p>
      <p class="verdict__word">${VERDICT_WORDS[verdict]}</p>
      <p class="verdict__advice">${escapeHtml(result.advice)}</p>
      <div class="verdict__meta">
        <span class="chip">${Math.round(result.confidence * 100)}% confidence</span>
        <span class="chip">${savingLabel}</span>
        <span class="chip">Repair buys ${decimal.format(result.extensionYears)} years</span>
        <span class="chip">Second-fault risk ${Math.round(result.secondFailureRisk * 100)}%</span>
      </div>
    </div>

    <div class="grid-2">
      <section class="section-block">
        <h2>Five-year cost</h2>
        <div class="bars">
          <div class="bar-row">
            <span>Repair</span>
            <span class="bar bar--repair"><i style="width:${repairPct}%"></i></span>
            <b>${money.format(result.repair.fiveYearExpected)}</b>
          </div>
          <div class="bar-row">
            <span>Replace</span>
            <span class="bar bar--replace"><i style="width:${replacePct}%"></i></span>
            <b>${money.format(result.replace.fiveYearExpected)}</b>
          </div>
        </div>
        <table>
          <thead>
            <tr><th scope="col">Line</th><th scope="col">Repair</th><th scope="col">Replace</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Upfront</td>
              <td>${moneyRange(result.repair.upfrontLow, result.repair.upfrontHigh)}</td>
              <td>${moneyRange(result.replace.upfrontLow, result.replace.upfrontHigh)}</td>
            </tr>
            <tr>
              <td>Cost per year</td>
              <td>${moneyRange(result.repair.annualisedLow, result.repair.annualisedHigh)}</td>
              <td>${moneyRange(result.replace.annualisedLow, result.replace.annualisedHigh)}</td>
            </tr>
            <tr>
              <td>Energy per year</td>
              <td>${money.format(result.repair.annualEnergyCost)}</td>
              <td>${money.format(result.replace.annualEnergyCost)}</td>
            </tr>
            <tr>
              <td>Five years</td>
              <td><strong>${money.format(result.repair.fiveYearExpected)}</strong></td>
              <td><strong>${money.format(result.replace.fiveYearExpected)}</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="section-block">
        <h2>Carbon</h2>
        <div class="carbon">
          <div class="stat">
            <span class="stat__value">${integer.format(result.carbon.netSavedKg)} kg</span>
            <span class="stat__label">CO2e saved by repairing</span>
          </div>
          <div class="stat">
            <span class="stat__value">${integer.format(result.carbon.annualSavedKg)} kg</span>
            <span class="stat__label">CO2e saved per year by a new unit</span>
          </div>
          <div class="stat">
            <span class="stat__value">${carbonPayback}</span>
            <span class="stat__label">Carbon payback of a new unit</span>
          </div>
        </div>
        <p class="note">${escapeHtml(result.carbon.paybackNote)}</p>
      </section>
    </div>

    <section class="section-block">
      <h2>Why</h2>
      <ul class="plain">${reasons}</ul>
      ${warnings}
    </section>

    <section class="guides" id="guides">
      <h2>Repair guides</h2>
      <p class="guide-empty">Looking for guides…</p>
    </section>
  `;
}

async function loadGuides(applianceId, faultId) {
  const slot = document.getElementById("guides");
  if (!slot) return;
  try {
    const params = new URLSearchParams({ applianceId, faultId });
    const data = await fetchJson(`/api/guides?${params}`);
    if (!data.guides.length) {
      slot.innerHTML = `
        <h2>Repair guides</h2>
        <p class="guide-empty">No guide found for this appliance. The verdict stands without one.</p>
        <p class="guide-empty"><a href="https://www.ifixit.com/Search?query=${encodeURIComponent(data.query)}" target="_blank" rel="noreferrer noopener">Search iFixit for “${escapeHtml(data.query)}”</a></p>
      `;
      return;
    }
    const items = data.guides
      .map((guide) => {
        const bits = [guide.difficulty, guide.minutes ? `${guide.minutes} min` : null, "iFixit"]
          .filter(Boolean)
          .join(" · ");
        return `<li><a href="${escapeHtml(guide.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(guide.title)}<span class="guide-meta">${escapeHtml(bits)}</span></a></li>`;
      })
      .join("");
    const source = data.source === "cache" ? "Cached iFixit result" : "Live from iFixit";
    slot.innerHTML = `
      <h2>Repair guides</h2>
      <ul class="guide-list">${items}</ul>
      <p class="note">${source} · ${escapeHtml(data.licence)}</p>
    `;
  } catch {
    slot.innerHTML = `
      <h2>Repair guides</h2>
      <p class="guide-empty">The guide service did not answer. The verdict stands without it.</p>
    `;
  }
}

async function run({ push = true } = {}) {
  const input = readInput();
  els.result.setAttribute("aria-busy", "true");
  try {
    const result = await fetchJson("/api/calc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    lastResult = result;
    render(result);
    if (push) writeHash(result.input);
    els.error.hidden = true;
    document.title = `${VERDICT_WORDS[result.verdict]} — fixfirst`;
    loadGuides(result.appliance.id, result.fault.id);
  } catch (error) {
    els.error.textContent = error.message;
    els.error.hidden = false;
  } finally {
    els.result.setAttribute("aria-busy", "false");
  }
}

function scheduleRun() {
  clearTimeout(runTimer);
  runTimer = setTimeout(() => run(), 320);
}

async function copyShareLink() {
  const input = lastResult ? lastResult.input : readInput();
  const url = new URL(window.location.href);
  url.search = "?view=report";
  url.hash = `d=${encodeState(input)}`;
  const link = url.toString();
  try {
    await navigator.clipboard.writeText(link);
    els.share.textContent = "Link copied";
    setTimeout(() => (els.share.textContent = "Copy share link"), 1800);
  } catch {
    window.prompt("Copy this link", link);
  }
}

async function boot() {
  try {
    catalog = await fetchJson("/api/catalog");
  } catch {
    els.result.innerHTML = `<p class="empty">The local API did not answer. Start the server with <code>npm start</code>.</p>`;
    return;
  }
  fillSelects();

  const state = readHash();
  if (state) applyState(state);
  if (new URLSearchParams(window.location.search).get("view") === "report") {
    document.body.classList.add("report");
  }

  updateQuoteHint();
  await run({ push: false });
  if (state) writeHash(lastResult ? lastResult.input : readInput());
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  run();
});
els.appliance.addEventListener("change", () => {
  updateQuoteHint();
  scheduleRun();
});
els.fault.addEventListener("change", () => {
  updateQuoteHint();
  scheduleRun();
});
for (const input of [els.age, els.quote, els.tariff, els.newPrice]) {
  input.addEventListener("input", scheduleRun);
}
els.share.addEventListener("click", copyShareLink);
els.print.addEventListener("click", () => window.print());

boot();