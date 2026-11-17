import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../src/server.ts";

let server: Server;
let base: string;

before(async () => {
  process.env.FIXFIRST_DB = ":memory:";
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("No address");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("health reports the catalog size", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.ok(body.appliances >= 30);
  assert.ok(body.faults >= 8);
});

test("catalog returns appliances, faults and defaults", async () => {
  const response = await fetch(`${base}/api/catalog`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.appliances));
  assert.ok(body.appliances.length >= 30);
  assert.ok(body.defaults.electricityPricePerKwh > 0);
});

test("calc answers with a verdict and a cost table", async () => {
  const response = await fetch(`${base}/api/calc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      applianceId: "dishwasher",
      ageYears: 4,
      faultId: "pump",
      quoteAud: 260,
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.verdict, "repair");
  assert.equal(body.repair.upfrontMid, 260);
  assert.ok(body.replace.fiveYearExpected > 0);
  assert.ok(typeof body.advice === "string" && body.advice.length > 0);
});

test("calc rejects bad JSON", async () => {
  const response = await fetch(`${base}/api/calc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops",
  });
  assert.equal(response.status, 400);
});

test("calc rejects an unknown appliance", async () => {
  const response = await fetch(`${base}/api/calc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ applianceId: "spaceship", ageYears: 2, faultId: "pump" }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Unknown appliance/);
});

test("guides need both identifiers", async () => {
  const response = await fetch(`${base}/api/guides?applianceId=dishwasher`);
  assert.equal(response.status, 400);
});

test("an unknown api path answers 404 as JSON", async () => {
  const response = await fetch(`${base}/api/nope`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.ok(body.error);
});

test("the page and its assets are served", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.ok(html.includes("fixfirst"));

  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
});

test("a traversal attempt is refused", async () => {
  const response = await fetch(`${base}/..%2Fpackage.json`);
  assert.equal(response.status, 404);
});