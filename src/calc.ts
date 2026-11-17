/**
 * The repair-or-replace decision engine.
 *
 * The model compares two five-year paths:
 *
 *   repair  = one repair now, plus a second-failure risk, plus old running cost
 *   replace = a new unit, minus scrap credit, plus new running cost
 *
 * Every path carries a low and a high value. When the range crosses zero the
 * verdict is `borderline`, because the honest answer depends on the quote.
 */

import {
  DEFAULT_ELECTRICITY_PRICE,
  DEFAULT_GRID_FACTOR,
  findAppliance,
  findFault,
} from "./catalog.ts";
import type {
  Appliance,
  CalcInput,
  CalcResult,
  CarbonResult,
  Fault,
  PathCost,
  Verdict,
} from "./types.ts";

export const HORIZON_YEARS = 5;
/** Share of a new unit's price above which a repair is treated as uneconomic. */
const REPAIR_PRICE_CEILING = 0.55;
/** Share of the new unit's embodied carbon that a repair spends on parts. */
const REPAIR_PARTS_CARBON_SHARE = 0.1;

export class CalcError extends Error {}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number): number => Math.round(value);

const mid = (low: number, high: number): number => (low + high) / 2;

export interface RepairEstimate {
  low: number;
  mid: number;
  high: number;
  fromQuote: boolean;
}

/** Estimate the repair bill from the catalog, or use the user's quote. */
export function estimateRepairCost(
  appliance: Appliance,
  fault: Fault,
  quoteAud?: number | null,
): RepairEstimate {
  if (typeof quoteAud === "number" && Number.isFinite(quoteAud) && quoteAud > 0) {
    return { low: quoteAud, mid: quoteAud, high: quoteAud, fromQuote: true };
  }
  const low = fault.costBand[0] * appliance.costFactor;
  const high = fault.costBand[1] * appliance.costFactor;
  return { low, mid: mid(low, high), high, fromQuote: false };
}

interface ScenarioInput {
  appliance: Appliance;
  fault: Fault;
  ageYears: number;
  electricityPrice: number;
  repair: RepairEstimate;
  newPriceLow: number;
  newPriceMid: number;
  newPriceHigh: number;
}

interface Scenario {
  extensionYears: number;
  secondFailureRisk: number;
  repair: PathCost;
  replace: PathCost;
  savingBest: number;
  savingWorst: number;
}

function buildScenario(s: ScenarioInput): Scenario {
  const { appliance, fault, ageYears, electricityPrice, repair } = s;
  const remainingLife = Math.max(0, appliance.lifeYears - ageYears);
  const extensionYears = Math.max(0.5, Math.min(fault.extensionYears, Math.max(1, remainingLife)));

  const ageRatio = clamp(ageYears / appliance.lifeYears, 0, 2);
  const secondFailureRisk = clamp(fault.secondFailureBase * (1 + 1.5 * ageRatio), 0, 0.75);

  const energyOld = appliance.oldKwhPerYear * electricityPrice;
  const energyNew = appliance.newKwhPerYear * electricityPrice;

  // If the repair buys fewer than five years, allow for a later replacement.
  const provision = Math.max(0, HORIZON_YEARS - extensionYears) / appliance.lifeYears;

  const repairFive = (upfront: number, risk: number): number =>
    upfront * (1 + risk) + provision * s.newPriceMid + energyOld * HORIZON_YEARS;

  const replaceFive = (price: number): number =>
    price - appliance.scrapValue + energyNew * HORIZON_YEARS;

  const repairLow = repairFive(repair.low, secondFailureRisk * 0.55);
  const repairMid = repairFive(repair.mid, secondFailureRisk);
  const repairHigh = repairFive(repair.high, Math.min(0.75, secondFailureRisk * 1.6));

  // The range test varies the repair bill and keeps the new price at its midpoint.
  // A quote and a catalog band are the only inputs with a real spread.
  const replaceMid = replaceFive(s.newPriceMid);

  const repairPath: PathCost = {
    upfrontLow: round(repair.low),
    upfrontMid: round(repair.mid),
    upfrontHigh: round(repair.high),
    annualisedLow: round(repair.low / extensionYears + energyOld),
    annualisedMid: round(repair.mid / extensionYears + energyOld),
    annualisedHigh: round(repair.high / extensionYears + energyOld),
    fiveYearExpected: round(repairMid),
    annualEnergyCost: round(energyOld),
  };

  const replacePath: PathCost = {
    upfrontLow: round(s.newPriceLow - appliance.scrapValue),
    upfrontMid: round(s.newPriceMid - appliance.scrapValue),
    upfrontHigh: round(s.newPriceHigh - appliance.scrapValue),
    annualisedLow: round((s.newPriceLow - appliance.scrapValue) / appliance.lifeYears + energyNew),
    annualisedMid: round((s.newPriceMid - appliance.scrapValue) / appliance.lifeYears + energyNew),
    annualisedHigh: round((s.newPriceHigh - appliance.scrapValue) / appliance.lifeYears + energyNew),
    fiveYearExpected: round(replaceMid),
    annualEnergyCost: round(energyNew),
  };

  return {
    extensionYears,
    secondFailureRisk,
    repair: repairPath,
    replace: replacePath,
    savingBest: replaceMid - repairLow,
    savingWorst: replaceMid - repairHigh,
  };
}

function buildCarbon(s: ScenarioInput): CarbonResult {
  const embodiedMid = mid(s.appliance.embodiedKg[0], s.appliance.embodiedKg[1]);
  const repairPartsKg = embodiedMid * REPAIR_PARTS_CARBON_SHARE;
  const annualSavedKg = Math.max(
    0,
    (s.appliance.oldKwhPerYear - s.appliance.newKwhPerYear) * DEFAULT_GRID_FACTOR,
  );
  const paybackMonthsRaw = annualSavedKg > 0 ? (embodiedMid * 12) / annualSavedKg : Number.POSITIVE_INFINITY;
  const paybackMonths = paybackMonthsRaw <= s.appliance.lifeYears * 12 ? round(paybackMonthsRaw) : null;

  let paybackNote: string;
  if (annualSavedKg <= 0) {
    paybackNote = "A new unit does not save energy. Replacement adds carbon.";
  } else if (paybackMonths === null) {
    paybackNote = "A new unit never pays back its carbon inside its service life.";
  } else if (paybackMonths <= 24) {
    paybackNote = "A new unit pays back its carbon in under two years.";
  } else {
    paybackNote = "A new unit pays back its carbon slowly, over several years.";
  }

  return {
    avoidedKg: round(embodiedMid),
    repairPartsKg: round(repairPartsKg),
    netSavedKg: round(embodiedMid - repairPartsKg),
    annualSavedKg: round(annualSavedKg),
    paybackMonths,
    paybackNote,
  };
}

function decide(
  s: ScenarioInput,
  scenario: Scenario,
  newPriceMid: number,
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  const repairMid = scenario.repair.upfrontMid;
  const { fault, ageYears, appliance } = s;

  const tooExpensive = repairMid >= newPriceMid * REPAIR_PRICE_CEILING;
  const tooOld = ageYears >= appliance.lifeYears * 1.25 && repairMid > newPriceMid * 0.3;
  const noLifeLeft = scenario.extensionYears < 1.5 && ageYears >= appliance.lifeYears;

  if (tooExpensive || tooOld || noLifeLeft) {
    if (tooExpensive) {
      reasons.push(
        `The repair costs ${Math.round((repairMid / newPriceMid) * 100)} percent of a new unit.`,
      );
    }
    if (tooOld) reasons.push("The unit is past its typical service life.");
    if (noLifeLeft) reasons.push("The repair buys almost no extra life.");
    reasons.push("Replacement is the cheaper path over five years.");
    return { verdict: "replace", reasons };
  }

  if (scenario.savingWorst > 0) {
    reasons.push("Repair is cheaper even when the repair bill is high.");
    return { verdict: "repair", reasons };
  }
  if (scenario.savingBest < 0) {
    reasons.push("Replacement is cheaper even when the repair bill is low.");
    return { verdict: "replace", reasons };
  }

  reasons.push("The two paths cost about the same. The quote decides.");
  if (fault.lowRisk) reasons.push("This is a low-risk repair with a known fix.");
  return { verdict: "borderline", reasons };
}

export function calculate(rawInput: CalcInput): CalcResult {
  const result = evaluate(rawInput);
  const newPriceMid =
    result.input.newPriceOverride ?? mid(result.appliance.newPrice[0], result.appliance.newPrice[1]);
  const ceiling = Math.round(newPriceMid * REPAIR_PRICE_CEILING);
  const breakEvenQuote = findBreakEven(rawInput, newPriceMid);

  let advice: string;
  if (result.verdict === "replace") {
    advice = breakEvenQuote
      ? `Keep the old unit only if the repair bill stays under A$${breakEvenQuote}.`
      : `No repair bill makes this unit worth fixing.`;
  } else if (result.verdict === "borderline") {
    advice = breakEvenQuote
      ? `Ask for a fixed quote. Repair wins below about A$${breakEvenQuote}.`
      : `Ask for a fixed quote. The paths are close.`;
  } else {
    advice = `Repair stays the cheaper path up to a bill of about A$${ceiling}.`;
  }

  return { ...result, breakEvenQuote, advice };
}

/** The highest repair quote that still avoids a `replace` verdict. */
function findBreakEven(input: CalcInput, newPriceMid: number): number | null {
  const ceiling = Math.round(newPriceMid * REPAIR_PRICE_CEILING);
  if (ceiling <= 0) return null;
  if (evaluate({ ...input, quoteAud: 0 }).verdict === "replace") return null;
  if (evaluate({ ...input, quoteAud: ceiling }).verdict !== "replace") return null;

  let low = 0;
  let high = ceiling;
  for (let step = 0; step < 30; step += 1) {
    const probe = (low + high) / 2;
    if (evaluate({ ...input, quoteAud: probe }).verdict === "replace") high = probe;
    else low = probe;
  }
  return Math.round(low);
}

function evaluate(rawInput: CalcInput): CalcResult {
  const appliance = findAppliance(rawInput.applianceId);
  if (!appliance) throw new CalcError(`Unknown appliance: ${rawInput.applianceId}`);
  const fault = findFault(rawInput.faultId);
  if (!fault) throw new CalcError(`Unknown fault: ${rawInput.faultId}`);

  const ageYears = Number.isFinite(rawInput.ageYears) ? clamp(rawInput.ageYears, 0, 40) : 0;
  const electricityPrice = clamp(
    Number.isFinite(rawInput.electricityPricePerKwh ?? NaN)
      ? (rawInput.electricityPricePerKwh as number)
      : DEFAULT_ELECTRICITY_PRICE,
    0.05,
    1.5,
  );
  const newPriceOverride =
    typeof rawInput.newPriceOverride === "number" &&
    Number.isFinite(rawInput.newPriceOverride) &&
    rawInput.newPriceOverride > 0
      ? rawInput.newPriceOverride
      : null;

  const newPriceLow = newPriceOverride ?? appliance.newPrice[0];
  const newPriceHigh = newPriceOverride ?? appliance.newPrice[1];
  const newPriceMid = mid(newPriceLow, newPriceHigh);

  const repair = estimateRepairCost(appliance, fault, rawInput.quoteAud);

  const scenarioInput: ScenarioInput = {
    appliance,
    fault,
    ageYears,
    electricityPrice,
    repair,
    newPriceLow,
    newPriceMid,
    newPriceHigh,
  };

  const scenario = buildScenario(scenarioInput);
  const { verdict, reasons } = decide(scenarioInput, scenario, newPriceMid);
  const carbon = buildCarbon(scenarioInput);

  const fiveYearSaving = round(scenario.replace.fiveYearExpected - scenario.repair.fiveYearExpected);
  const energyDelta = round(scenario.repair.annualEnergyCost - scenario.replace.annualEnergyCost);

  if (energyDelta > 0) {
    reasons.push(`A new unit saves about A$${energyDelta} a year in energy.`);
  } else if (energyDelta < 0) {
    reasons.push("The old unit is not costing more to run.");
  }

  const spread = Math.abs(scenario.savingBest - scenario.savingWorst);
  const scale = Math.max(1, Math.abs(scenario.savingBest), Math.abs(scenario.savingWorst));
  const baseConfidence = repair.fromQuote ? 0.9 : 0.66;
  const confidence = clamp(
    baseConfidence * (1 - 0.35 * Math.min(1, spread / scale)) * (verdict === "borderline" ? 0.82 : 1),
    0.35,
    0.95,
  );

  const warnings: string[] = [];
  if (!repair.fromQuote) {
    warnings.push("The repair cost is a catalog estimate. Ask for a fixed quote.");
  }
  if (fault.id === "compressor") {
    warnings.push("A sealed-system repair needs a licensed technician.");
  }
  if (ageYears >= appliance.lifeYears) {
    warnings.push("The unit is older than its typical service life. A second fault is likely.");
  }
  if (newPriceOverride !== null) {
    warnings.push("The new-unit price is your own figure. The catalog band is overridden.");
  }
  if (electricityPrice !== DEFAULT_ELECTRICITY_PRICE) {
    warnings.push("Energy cost uses your tariff, not the default.");
  }

  return {
    appliance,
    fault,
    input: {
      applianceId: appliance.id,
      ageYears,
      faultId: fault.id,
      quoteAud: repair.fromQuote ? Math.round(repair.mid) : null,
      electricityPricePerKwh: electricityPrice,
      gridFactorKgPerKwh: DEFAULT_GRID_FACTOR,
      newPriceOverride,
    },
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    repair: scenario.repair,
    replace: scenario.replace,
    carbon,
    fiveYearSaving,
    extensionYears: Math.round(scenario.extensionYears * 10) / 10,
    secondFailureRisk: Math.round(scenario.secondFailureRisk * 100) / 100,
    breakEvenQuote: null,
    advice: "",
    reasons,
    warnings,
  };
}