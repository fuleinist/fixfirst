import { test } from "node:test";
import assert from "node:assert/strict";
import { rankGuides, type GuideSummary } from "../src/ifixit.ts";
import { findFault } from "../src/catalog.ts";

const guide = (overrides: Partial<GuideSummary>): GuideSummary => ({
  id: "1",
  title: "Guide",
  url: "https://www.ifixit.com/Guide/x/1",
  difficulty: "Moderate",
  summary: "",
  minutes: 30,
  kind: "guide",
  ...overrides,
});

test("a guide that names the fault comes first", () => {
  const guides = [
    guide({ id: "a", title: "Replace the door seal" }),
    guide({ id: "b", title: "Replace the drain pump" }),
    guide({ id: "c", title: "Replace the control board" }),
  ];
  const ranked = rankGuides(guides, findFault("pump")!, 4);
  assert.equal(ranked[0].id, "b");
});

test("a full guide outranks a wiki page on a tie", () => {
  const guides = [
    guide({ id: "wiki", title: "Pump noise", kind: "wiki" }),
    guide({ id: "full", title: "Pump noise repair", kind: "guide" }),
  ];
  const ranked = rankGuides(guides, findFault("pump")!, 4);
  assert.equal(ranked[0].id, "full");
});

test("the limit is respected", () => {
  const guides = Array.from({ length: 9 }, (_, index) => guide({ id: String(index), title: `Pump ${index}` }));
  assert.equal(rankGuides(guides, findFault("pump")!, 3).length, 3);
});