/**
 * iFixit guide client.
 *
 * The public API answers without a key. Guides are CC BY-NC-SA, so the UI
 * always links back to the source page.
 *
 * A lookup never blocks a verdict. Network errors return an empty list, and a
 * stale cache entry is served when a fresh fetch fails.
 */

import { readCache, writeCache } from "./db.ts";
import type { Appliance, Fault } from "./types.ts";

const API_ROOT = "https://www.ifixit.com/api/2.0";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4500;

export type GuideKind = "guide" | "wiki" | "question";

export interface GuideSummary {
  id: string;
  title: string;
  url: string;
  difficulty: string | null;
  summary: string;
  minutes: number | null;
  kind: GuideKind;
}

export interface GuideResult {
  guides: GuideSummary[];
  source: "live" | "cache" | "none";
  fetchedAt: number | null;
  query: string;
}

const FAULT_KEYWORDS: Record<string, string[]> = {
  pump: ["pump", "drain"],
  motor: ["motor", "brush"],
  "control-board": ["control", "board", "module"],
  seal: ["seal", "gasket", "door"],
  "heating-element": ["heating", "element", "thermostat"],
  compressor: ["compressor", "cool"],
  bearing: ["bearing", "drum", "noise"],
  "door-hinge": ["hinge", "latch", "handle"],
  sensor: ["sensor", "thermostat"],
  blockage: ["clog", "block", "drain", "filter"],
};

function sanitize(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toGuide(raw: Record<string, unknown>): GuideSummary | null {
  const url = sanitize(raw.url);
  const title = sanitize(raw.title);
  const kind = sanitize(raw.dataType, "guide") as GuideKind;
  if (!url.startsWith("https://www.ifixit.com/") || title.length === 0) return null;
  const idSource = raw.guideid ?? raw.wikiid ?? raw.questionid ?? url;
  const minutes =
    typeof raw.time_required_max === "number" && raw.time_required_max > 0
      ? Math.round(raw.time_required_max / 60)
      : null;
  return {
    id: String(idSource),
    title,
    url,
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : null,
    summary: sanitize(raw.summary).slice(0, 240),
    minutes,
    kind,
  };
}

/** Rank guides so the fault keywords and full guides come first. */
export function rankGuides(guides: GuideSummary[], fault: Fault, limit = 4): GuideSummary[] {
  const words = FAULT_KEYWORDS[fault.id] ?? [];
  const scored = guides.map((guide) => {
    const haystack = `${guide.title} ${guide.summary}`.toLowerCase();
    let score = 0;
    for (const word of words) if (haystack.includes(word)) score += 3;
    if (guide.kind === "guide") score += 2;
    if (guide.kind === "wiki") score += 1;
    return { guide, score };
  });
  scored.sort((a, b) => b.score - a.score || a.guide.title.localeCompare(b.guide.title));
  return scored.slice(0, limit).map((entry) => entry.guide);
}

async function fetchSearch(query: string): Promise<GuideSummary[]> {
  const url = `${API_ROOT}/search/${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`iFixit answered ${response.status}`);
  const body = (await response.json()) as { results?: Record<string, unknown>[] };
  const results = Array.isArray(body.results) ? body.results : [];
  return results.map(toGuide).filter((guide): guide is GuideSummary => guide !== null);
}

export async function findGuides(
  appliance: Appliance,
  fault: Fault,
  options: { now?: number; limit?: number } = {},
): Promise<GuideResult> {
  const query = appliance.ifixitQuery;
  const limit = options.limit ?? 4;
  const now = options.now ?? Date.now();
  const cacheKey = `${query}::${limit}`;
  const cached = readCache(cacheKey) as { payload: GuideSummary[]; fetchedAt: number } | null;

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { guides: rankGuides(cached.payload, fault, limit), source: "cache", fetchedAt: cached.fetchedAt, query };
  }

  try {
    const guides = await fetchSearch(query);
    if (guides.length > 0) {
      writeCache(cacheKey, guides, now);
      return { guides: rankGuides(guides, fault, limit), source: "live", fetchedAt: now, query };
    }
  } catch {
    if (cached) {
      return { guides: rankGuides(cached.payload, fault, limit), source: "cache", fetchedAt: cached.fetchedAt, query };
    }
    return { guides: [], source: "none", fetchedAt: null, query };
  }

  if (cached) {
    return { guides: rankGuides(cached.payload, fault, limit), source: "cache", fetchedAt: cached.fetchedAt, query };
  }
  return { guides: [], source: "none", fetchedAt: null, query };
}