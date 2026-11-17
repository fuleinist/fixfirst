import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, CalcError, estimateRepairCost } from "../src/calc.ts";
import { APPLIANCES, FAULTS, findAppliance, findFault } from "../src/catalog.ts";

test("a mid-life washing machine with a pump quote is a repair", () => {
  const result = calculate({
    applianceId: "washing-machine",
    ageYears: 4,
    faultId: "pump",
    quoteAud: 280,
  });
  assert.equal(result.verdict, "repair");
  assert.equal(result.repair.upfrontMid, 280);
  assert.ok(result.fiveYearSaving > 0);
  assert.ok(result.reasons.length > 0);
});

test("a repair that costs more than half a new unit is a replace", () => {
  const kettle = findAppliance("kettle")!;
  const quote = Math.round(((kettle.newPrice[0] + kettle.newPrice[1]) / 2) * 0.9);
  const result = calculate({
    applianceId: "kettle",
    ageYears: 3,
    faultId: "control-board",
    quoteAud: quote,
  });
  assert.equal(result.verdict, "replace");
  assert.ok(result.reasons.some((r) => r.includes("percent of a new unit")));
});

test("a quote collapses the repair band and removes the estimate warning", () => {
  const result = calculate({
    applianceId: "dishwasher",
    ageYears: 5,
    faultId: "pump",
    quoteAud: 320,
  });
  assert.equal(result.repair.upfrontLow, 320);
  assert.equal(result.repair.upfrontHigh, 320);
  assert.equal(result.input.quoteAud, 320);
  assert.ok(!result.warnings.some((w) => w.includes("catalog estimate")));
});

test("an absent quote uses the catalog band and warns", () => {
  const result = calculate({ applianceId: "dishwasher", ageYears: 5, faultId: "pump" });
  assert.ok(result.repair.upfrontLow < result.repair.upfrontHigh);
  assert.equal(result.input.quoteAud, null);
  assert.ok(result.warnings.some((w) => w.includes("catalog estimate")));
});

test("estimateRepairCost scales with the appliance cost factor", () => {
  const small = estimateRepairCost(findAppliance("kettle")!, findFault("pump")!);
  const large = estimateRepairCost(findAppliance("heat-pump-hot-water")!, findFault("pump")!);
  assert.ok(large.mid > small.mid * 5);
  assert.equal(small.fromQuote, false);
});

test("a heater that uses the same energy adds carbon and never pays it back", () => {
  const result = calculate({ applianceId: "heater-panel", ageYears: 6, faultId: "heating-element" });
  assert.equal(result.carbon.annualSavedKg, 0);
  assert.equal(result.carbon.paybackMonths, null);
  assert.ok(result.carbon.paybackNote.includes("does not save energy"));
});

test("a repair avoids most of the embodied carbon of a new unit", () => {
  const result = calculate({ applianceId: "fridge-top-mount", ageYears: 7, faultId: "seal", quoteAud: 140 });
  assert.ok(result.carbon.avoidedKg > 600);
  assert.ok(result.carbon.netSavedKg < result.carbon.avoidedKg);
  assert.ok(result.carbon.netSavedKg > result.carbon.avoidedKg * 0.85);
  assert.equal(result.verdict, "repair");
});

test("an old, expensive repair is a replace even with no quote", () => {
  const result = calculate({ applianceId: "fridge-french-door", ageYears: 18, faultId: "compressor" });
  assert.equal(result.verdict, "replace");
  assert.ok(result.warnings.some((w) => w.includes("typical service life")));
});

test("risk rises with age and stays bounded", () => {
  const young = calculate({ applianceId: "washing-machine", ageYears: 1, faultId: "bearing" });
  const old = calculate({ applianceId: "washing-machine", ageYears: 14, faultId: "bearing" });
  assert.ok(old.secondFailureRisk > young.secondFailureRisk);
  assert.ok(old.secondFailureRisk <= 0.75);
});

test("extension years fall as the unit approaches the end of life", () => {
  const young = calculate({ applianceId: "dishwasher", ageYears: 1, faultId: "pump" });
  const old = calculate({ applianceId: "dishwasher", ageYears: 9.5, faultId: "pump" });
  assert.ok(young.extensionYears > old.extensionYears);
  assert.ok(old.extensionYears >= 0.5);
});

test("unknown identifiers raise a clear error", () => {
  assert.throws(() => calculate({ applianceId: "nope", ageYears: 1, faultId: "pump" }), CalcError);
  assert.throws(() => calculate({ applianceId: "kettle", ageYears: 1, faultId: "nope" }), CalcError);
});

test("age and tariff are clamped to a sane band", () => {
  const result = calculate({
    applianceId: "tv-55",
    ageYears: 200,
    faultId: "control-board",
    electricityPricePerKwh: 99,
  });
  assert.equal(result.input.ageYears, 40);
  assert.equal(result.input.electricityPricePerKwh, 1.5);
});

test("the same input gives the same result", () => {
  const input = { applianceId: "laptop", ageYears: 3, faultId: "sensor", quoteAud: 260 } as const;
  assert.deepEqual(calculate(input), calculate(input));
});

test("money fields are whole dollars and ordered", () => {
  for (const a of APPLIANCES) {
    for (const f of FAULTS) {
      const r = calculate({ applianceId: a.id, ageYears: Math.min(6, a.lifeYears - 1), faultId: f.id });
      for (const path of [r.repair, r.replace]) {
        assert.ok(Number.isInteger(path.upfrontMid), `${a.id}/${f.id} upfront`);
        assert.ok(path.upfrontLow <= path.upfrontMid, `${a.id}/${f.id} upfront low`);
        assert.ok(path.upfrontMid <= path.upfrontHigh, `${a.id}/${f.id} upfront high`);
        assert.ok(path.annualisedLow <= path.annualisedMid, `${a.id}/${f.id} annualised low`);
        assert.ok(path.annualisedMid <= path.annualisedHigh, `${a.id}/${f.id} annualised high`);
        assert.ok(Number.isFinite(path.fiveYearExpected), `${a.id}/${f.id} five year`);
      }
      assert.ok(["repair", "replace", "borderline"].includes(r.verdict), `${a.id}/${f.id} verdict`);
      assert.ok(r.confidence >= 0.35 && r.confidence <= 0.95, `${a.id}/${f.id} confidence`);
      assert.ok(Number.isFinite(r.carbon.netSavedKg), `${a.id}/${f.id} carbon`);
    }
  }
});

test("verdict and saving agree for the range rule", () => {
  const repair = calculate({ applianceId: "washing-machine", ageYears: 5, faultId: "pump", quoteAud: 300 });
  assert.ok(repair.fiveYearSaving > 0);
  const replace = calculate({ applianceId: "microwave", ageYears: 12, faultId: "control-board" });
  assert.ok(replace.fiveYearSaving < 0);
});