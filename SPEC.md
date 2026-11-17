# SPEC — fixfirst

A repair-or-replace calculator for household appliances. It weighs repair cost and
embodied carbon against a new unit, then returns one verdict with a payback period.

## Problem

A failed appliance is a money and carbon decision. Most people replace by habit,
because pricing a repair takes three phone calls and the carbon sum is invisible.
No neutral tool joins cost, carbon and a repair guide in one answer.

## Users

1. A householder with a broken appliance and one repair quote.
2. A repair cafe volunteer who wants a fast second opinion.
3. A landlord or property manager comparing repair against replacement.

## Acceptance criteria

Each item is testable. `A1` to `A12` map to automated tests where possible.

| ID | Criterion |
|----|-----------|
| A1 | The catalog holds at least 30 appliance types. Each entry has a price band, a service life, an embodied-carbon band and an annual energy figure. |
| A2 | The catalog holds at least 8 fault classes. Each class has a repair-cost band per appliance group. |
| A3 | The calculator returns a verdict in one of three values: `repair`, `replace` or `borderline`. |
| A4 | Every verdict carries a low and a high value. If the range crosses the decision rule, the verdict is `borderline`. |
| A5 | The calculator returns the annualised cost of each path. Both values use the same unit and the same lifetime basis. |
| A6 | The calculator returns the carbon payback in months. The value is the embodied carbon of a new unit divided by the monthly emissions saved. |
| A7 | The calculator returns the expected 5-year cost of each path. The repair path includes the risk of a second failure. |
| A8 | The user can send a repair quote. If the quote is absent, the tool uses the catalog band and labels the value as an estimate. |
| A9 | The tool finds at least one iFixit guide for a supported appliance and returns its title, URL and difficulty. A failed lookup never blocks the verdict. |
| A10 | One page report mode exists. The report shows the verdict, the cost table, the carbon table and the source list. The report prints on one A4 page. |
| A11 | A share link encodes the full input in the URL fragment. Opening the link rebuilds the same result. |
| A12 | The server answers with no runtime dependency outside Node 22 or later. All state is local. |

## Non-goals

- No accounts, no cloud storage, no telemetry.
- No medical or safety advice.
- No live parts pricing. The catalog is curated and every value is a range.

## Method

### Cost path

```
repair_annualised  = repair_cost / extension_years + old_running_cost
replace_annualised = (new_price - scrap_value) / new_life + new_running_cost
```

`extension_years` is the smaller of the fault extension and the remaining nominal
life. The repair path keeps the old running cost, because the machine stays.

### Carbon path

```
embodied_new        = new unit embodied carbon, kg CO2e
energy_carbon_delta = (old_kWh - new_kWh) * grid_factor / 12   per month
carbon_payback      = embodied_new / energy_carbon_delta
```

A repair avoids the whole embodied block of a new unit. A replacement pays that
block back only through lower running emissions. When the old unit is already
efficient, the payback can exceed the new service life. The tool reports that
case as `no payback within service life`.

### Risk adjustment

Age raises the chance of a second failure. The 5-year expected cost of the repair
path is:

```
E[repair] = repair_cost + P(second failure) * repair_cost
          + old_running_cost * 5
```

`P(second failure)` grows with the age-to-life ratio. The catalog supplies the
base rate per fault class.

## Data sources

| Source | Use | Licence |
|--------|-----|---------|
| iFixit public guides API | Repair guide link, title and difficulty | CC BY-NC-SA |
| EU EPREL energy label database | New-unit efficiency classes and annual kWh | Free, open |
| Open Repair Alliance | Fault mix and repair success rates | Open data |
| Manufacturer energy labels and spare-part lists | Catalog price and energy bands | Public |

The catalog is a curated snapshot. Each field cites its basis in `src/catalog.ts`.

## Build plan

1. Cycle 1 — spec, catalog, calculator, tests.
2. Cycle 2 — HTTP API, single-page UI, print report.
3. Cycle 3 — iFixit client with cache, share link, README, logo, screenshots.
4. Cycle 4 — polish, accessibility pass, final verification.