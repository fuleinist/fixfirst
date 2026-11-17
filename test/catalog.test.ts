import { test } from "node:test";
import assert from "node:assert/strict";
import { APPLIANCES, FAULTS, findAppliance, findFault, applianceGroups } from "../src/catalog.ts";

test("catalog holds at least 30 appliances", () => {
  assert.ok(APPLIANCES.length >= 30, `only ${APPLIANCES.length} appliances`);
});

test("catalog holds at least 8 fault classes", () => {
  assert.ok(FAULTS.length >= 8, `only ${FAULTS.length} faults`);
});

test("appliance ids are unique", () => {
  const ids = new Set(APPLIANCES.map((a) => a.id));
  assert.equal(ids.size, APPLIANCES.length);
});

test("every appliance has ordered ranges and positive figures", () => {
  for (const a of APPLIANCES) {
    assert.ok(a.newPrice[0] > 0 && a.newPrice[0] < a.newPrice[1], `${a.id} price band`);
    assert.ok(a.embodiedKg[0] > 0 && a.embodiedKg[0] < a.embodiedKg[1], `${a.id} carbon band`);
    assert.ok(a.lifeYears >= 3 && a.lifeYears <= 25, `${a.id} life`);
    assert.ok(a.oldKwhPerYear > 0 && a.newKwhPerYear > 0, `${a.id} energy`);
    assert.ok(a.newKwhPerYear <= a.oldKwhPerYear, `${a.id} new unit uses more energy`);
    assert.ok(a.costFactor > 0 && a.costFactor <= 2.5, `${a.id} cost factor`);
    assert.ok(a.scrapValue >= 0 && a.scrapValue < a.newPrice[0], `${a.id} scrap credit`);
    assert.ok(a.ifixitQuery.length > 0, `${a.id} ifixit query`);
  }
});

test("every fault has an ordered cost band and a plausible risk", () => {
  for (const f of FAULTS) {
    assert.ok(f.costBand[0] > 0 && f.costBand[0] < f.costBand[1], `${f.id} band`);
    assert.ok(f.extensionYears >= 0.5 && f.extensionYears <= 8, `${f.id} extension`);
    assert.ok(f.secondFailureBase > 0 && f.secondFailureBase < 0.6, `${f.id} risk`);
    assert.ok(f.note.length > 0, `${f.id} note`);
  }
});

test("lookups find a known entry and reject an unknown one", () => {
  assert.equal(findAppliance("dishwasher")?.name, "Dishwasher, 60 cm");
  assert.equal(findAppliance("toaster-9000"), undefined);
  assert.equal(findFault("pump")?.name, "Water or drain pump");
  assert.equal(findFault("gremlin"), undefined);
});

test("grouping covers every appliance once", () => {
  const groups = applianceGroups();
  const total = Object.values(groups).reduce((sum, list) => sum + list.length, 0);
  assert.equal(total, APPLIANCES.length);
  assert.ok(Object.keys(groups).length >= 5);
});