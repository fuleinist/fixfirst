/**
 * Shared types for fixfirst.
 *
 * All money values are AUD. All mass values are kg CO2e.
 * Every catalog value is a range, never a single number.
 */

export type Range = [low: number, high: number];

export type ApplianceGroup =
  | "kitchen"
  | "laundry"
  | "cooling"
  | "heating"
  | "electronics"
  | "garden"
  | "personal";

export interface Appliance {
  id: string;
  name: string;
  group: ApplianceGroup;
  /** Typical service life in years. */
  lifeYears: number;
  /** Replacement purchase price band, including delivery. */
  newPrice: Range;
  /** Manufacturing and shipping carbon of a new unit. */
  embodiedKg: Range;
  /** Typical annual energy use of a unit that is 8 to 12 years old. */
  oldKwhPerYear: number;
  /** Annual energy use of a mid-efficiency new unit. */
  newKwhPerYear: number;
  /** Scrap or trade-in credit at replacement. */
  scrapValue: number;
  /** Relative repair labour and parts cost. 1.0 is a mid-size appliance. */
  costFactor: number;
  /** Search term for the iFixit guide API. */
  ifixitQuery: string;
}

export interface Fault {
  id: string;
  name: string;
  /** Years of extra life a successful repair usually buys. */
  extensionYears: number;
  /** Parts plus labour band for a mid-size appliance. */
  costBand: Range;
  /** Chance of a second failure inside the extension period, at mid life. */
  secondFailureBase: number;
  /** Plain-language description of the work. */
  note: string;
  /** True when the fault is cheap to fix and rarely returns. */
  lowRisk: boolean;
}

export interface CalcInput {
  applianceId: string;
  ageYears: number;
  faultId: string;
  /** A real repair quote. Null means the catalog band is used. */
  quoteAud?: number | null;
  electricityPricePerKwh?: number;
  gridFactorKgPerKwh?: number;
  newPriceOverride?: number | null;
}

export type Verdict = "repair" | "replace" | "borderline";

export interface PathCost {
  /** Upfront cost band for this path. */
  upfrontLow: number;
  upfrontMid: number;
  upfrontHigh: number;
  /** Cost per year of service, including energy. */
  annualisedLow: number;
  annualisedMid: number;
  annualisedHigh: number;
  /** Expected total cost across the five-year horizon. */
  fiveYearExpected: number;
  /** Energy cost per year on this path. */
  annualEnergyCost: number;
}

export interface CarbonResult {
  /** Embodied carbon of the new unit that a repair avoids. */
  avoidedKg: number;
  /** Carbon cost of the repair itself, from parts and transport. */
  repairPartsKg: number;
  /** Net carbon saved by repairing, over the extension period. */
  netSavedKg: number;
  /** Emissions saved per year by a new, more efficient unit. */
  annualSavedKg: number;
  /** Months until the new unit pays back its embodied carbon. Null when it never does. */
  paybackMonths: number | null;
  paybackNote: string;
}

export interface CalcResult {
  appliance: Appliance;
  fault: Fault;
  input: Required<Omit<CalcInput, "newPriceOverride">> & { newPriceOverride: number | null };
  verdict: Verdict;
  confidence: number;
  repair: PathCost;
  replace: PathCost;
  carbon: CarbonResult;
  /** Positive means repair is cheaper across five years. */
  fiveYearSaving: number;
  extensionYears: number;
  secondFailureRisk: number;
  /** The repair bill at which the verdict flips. Null when no flip exists. */
  breakEvenQuote: number | null;
  advice: string;
  reasons: string[];
  warnings: string[];
}