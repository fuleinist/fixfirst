/**
 * Capture README screenshots from the running app.
 *
 *   node scripts/screenshots.cjs [baseUrl] [outDir]
 *
 * Requires Playwright from the workspace node_modules.
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3311";
const outDir = path.resolve(process.argv[3] ?? "docs/screenshots");

const encode = (input) => Buffer.from(JSON.stringify(input), "utf8").toString("base64url");

const CASES = [
  {
    file: "verdict-repair.png",
    label: "Washing machine, pump repair, with a quote",
    input: {
      applianceId: "washing-machine",
      ageYears: 5,
      faultId: "pump",
      quoteAud: 300,
      electricityPricePerKwh: 0.33,
      newPriceOverride: null,
    },
    view: "report",
  },
  {
    file: "verdict-replace.png",
    label: "Old microwave, control board, no quote",
    input: {
      applianceId: "microwave",
      ageYears: 11,
      faultId: "control-board",
      quoteAud: null,
      electricityPricePerKwh: 0.33,
      newPriceOverride: null,
    },
    view: "report",
  },
  {
    file: "app-desktop.png",
    label: "Full page, form and verdict",
    input: {
      applianceId: "fridge-top-mount",
      ageYears: 8,
      faultId: "seal",
      quoteAud: null,
      electricityPricePerKwh: 0.33,
      newPriceOverride: null,
    },
    view: "app",
  },
];

const errors = [];

function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} [console] ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${label} [pageerror] ${String(error)}`));
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const launch = { args: ["--disable-gpu", "--no-sandbox"] };
  let browser;
  try {
    browser = await chromium.launch(launch);
  } catch {
    browser = await chromium.launch({ ...launch, channel: "chrome" });
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, "desktop");

  for (const testCase of CASES) {
    // A hash-only URL change is a same-document navigation. Load a blank page
    // first so the app boots fresh with the new state.
    await page.goto("about:blank");
    const query = testCase.view === "report" ? "?view=report" : "";
    const url = `${base}/${query}#d=${encode(testCase.input)}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(".verdict__word", { timeout: 20000 });
    await page.waitForFunction(
      () => {
        const slot = document.querySelector("#guides");
        return Boolean(slot) && !slot.textContent.includes("Looking for guides");
      },
      { timeout: 20000 },
    );
    const word = (await page.locator(".verdict__word").textContent())?.trim();
    const eyebrow = (await page.locator(".verdict__eyebrow").textContent())?.trim() ?? "";
    const expectedName = testCase.input.applianceId;
    const appliance = await page.locator("#appliance").inputValue();
    if (appliance !== expectedName) {
      throw new Error(`State was not applied: wanted ${expectedName}, got ${appliance}`);
    }
    const target = path.join(outDir, testCase.file);
    await page.screenshot({ path: target, fullPage: true });
    console.log(`${testCase.file}: "${word}" — ${eyebrow}`);
  }

  await browser.close();

  for (const file of fs.readdirSync(outDir).filter((name) => name.endsWith(".png"))) {
    const size = fs.statSync(path.join(outDir, file)).size;
    console.log(`${file}: ${Math.round(size / 1024)} KB`);
  }

  if (errors.length > 0) {
    console.error("CONSOLE_ERRORS");
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log("No console errors.");
})().catch((error) => {
  console.error(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});