#!/usr/bin/env node
/**
 * Command-line report.
 *
 *   node src/cli.ts --appliance dishwasher --age 5 --fault pump --quote 280
 *   node src/cli.ts --list
 *   node src/cli.ts --appliance fridge-top-mount --age 8 --fault seal --json
 */

import { APPLIANCES, FAULTS } from "./catalog.ts";
import { calculate, CalcError } from "./calc.ts";

interface Args {
  appliance?: string;
  age?: string;
  fault?: string;
  quote?: string;
  tariff?: string;
  newPrice?: string;
  json: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--appliance":
        args.appliance = argv[++index];
        break;
      case "--age":
        args.age = argv[++index];
        break;
      case "--fault":
        args.fault = argv[++index];
        break;
      case "--quote":
        args.quote = argv[++index];
        break;
      case "--tariff":
        args.tariff = argv[++index];
        break;
      case "--new-price":
        args.newPrice = argv[++index];
        break;
      case "--json":
        args.json = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (token.startsWith("--")) {
          console.error(`Unknown option: ${token}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`fixfirst — repair or replace?

Usage:
  node src/cli.ts --appliance <id> --age <years> --fault <id> [options]

Options:
  --quote <aud>       A real repair quote. Omit it to use the catalog estimate.
  --tariff <aud/kwh>  Your electricity price. Default 0.33.
  --new-price <aud>   Your own new-unit price.
  --json              Print the full result as JSON.
  --list              List the appliance and fault ids.

Examples:
  node src/cli.ts --appliance dishwasher --age 5 --fault pump --quote 280
  node src/cli.ts --appliance fridge-top-mount --age 9 --fault seal`);
}

function printList(): void {
  console.log("Appliances:");
  for (const appliance of APPLIANCES) {
    console.log(`  ${appliance.id.padEnd(22)} ${appliance.name}`);
  }
  console.log("\nFaults:");
  for (const fault of FAULTS) {
    console.log(`  ${fault.id.padEnd(22)} ${fault.name}`);
  }
}

const money = (value: number): string => `A$${Math.round(value).toLocaleString("en-AU")}`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) return printList();
  if (!args.appliance || !args.fault || args.age === undefined) {
    printHelp();
    process.exit(2);
  }

  let result;
  try {
    result = calculate({
      applianceId: args.appliance,
      ageYears: Number(args.age),
      faultId: args.fault,
      quoteAud: args.quote ? Number(args.quote) : null,
      electricityPricePerKwh: args.tariff ? Number(args.tariff) : undefined,
      newPriceOverride: args.newPrice ? Number(args.newPrice) : null,
    });
  } catch (error) {
    if (error instanceof CalcError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const verdict = { repair: "REPAIR", replace: "REPLACE", borderline: "TOO CLOSE TO CALL" }[result.verdict];
  const payback =
    result.carbon.paybackMonths === null ? "no payback" : `${result.carbon.paybackMonths} months`;

  console.log(`${verdict} — ${result.appliance.name}, ${result.fault.name}`);
  console.log(result.advice);
  console.log("");
  console.log(`Confidence           ${Math.round(result.confidence * 100)}%`);
  console.log(`Repair upfront       ${money(result.repair.upfrontLow)} to ${money(result.repair.upfrontHigh)}`);
  console.log(`Replace upfront      ${money(result.replace.upfrontLow)} to ${money(result.replace.upfrontHigh)}`);
  console.log(`Five-year repair     ${money(result.repair.fiveYearExpected)}`);
  console.log(`Five-year replace    ${money(result.replace.fiveYearExpected)}`);
  console.log(`Repair buys          ${result.extensionYears} years`);
  console.log(`Second-fault risk    ${Math.round(result.secondFailureRisk * 100)}%`);
  console.log("");
  console.log(`Carbon avoided       ${result.carbon.netSavedKg} kg CO2e`);
  console.log(`Carbon payback       ${payback}`);
  console.log("");
  for (const reason of result.reasons) console.log(`- ${reason}`);
  for (const warning of result.warnings) console.log(`! ${warning}`);
}

main();