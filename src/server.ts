/**
 * fixfirst HTTP server.
 *
 * Zero runtime dependencies. Static files come from `public/`, data from the
 * calculator, and guides from the iFixit cache.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { APPLIANCES, DEFAULT_ELECTRICITY_PRICE, DEFAULT_GRID_FACTOR, FAULTS } from "./catalog.ts";
import { calculate, CalcError } from "./calc.ts";
import { findAppliance, findFault } from "./catalog.ts";
import { findGuides } from "./ifixit.ts";
import { cacheSize } from "./db.ts";
import type { CalcInput } from "./types.ts";

const PUBLIC_DIR = resolve("public");
const MAX_BODY_BYTES = 64 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<string> {
  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function serveStatic(response: ServerResponse, urlPath: string): Promise<boolean> {
  const relative = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const target = normalize(join(PUBLIC_DIR, relative));
  if (!target.startsWith(PUBLIC_DIR + sep) && target !== PUBLIC_DIR) return false;
  try {
    const file = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, {
      "content-type": type,
      "content-length": file.byteLength,
      "cache-control": "no-cache",
    });
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

export function createApp(): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (path === "/api/health") {
        return sendJson(response, 200, {
          status: "ok",
          appliances: APPLIANCES.length,
          faults: FAULTS.length,
          cachedQueries: cacheSize(),
        });
      }

      if (path === "/api/catalog") {
        return sendJson(response, 200, {
          appliances: APPLIANCES,
          faults: FAULTS,
          defaults: {
            electricityPricePerKwh: DEFAULT_ELECTRICITY_PRICE,
            gridFactorKgPerKwh: DEFAULT_GRID_FACTOR,
          },
        });
      }

      if (path === "/api/calc" && request.method === "POST") {
        const raw = await readBody(request);
        let body: CalcInput;
        try {
          body = JSON.parse(raw) as CalcInput;
        } catch {
          return sendJson(response, 400, { error: "The request body is not valid JSON." });
        }
        try {
          return sendJson(response, 200, calculate(body));
        } catch (error) {
          if (error instanceof CalcError) return sendJson(response, 400, { error: error.message });
          throw error;
        }
      }

      if (path === "/api/guides" && request.method === "GET") {
        const appliance = findAppliance(url.searchParams.get("applianceId") ?? "");
        const fault = findFault(url.searchParams.get("faultId") ?? "");
        if (!appliance || !fault) {
          return sendJson(response, 400, { error: "Send a known applianceId and faultId." });
        }
        const result = await findGuides(appliance, fault);
        return sendJson(response, 200, { ...result, licence: "CC BY-NC-SA", publisher: "iFixit" });
      }

      if (path.startsWith("/api/")) {
        return sendJson(response, 404, { error: "No such endpoint." });
      }

      if (request.method === "GET" && (await serveStatic(response, path))) return;

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      sendJson(response, 500, { error: message });
    }
  });
}

export function startServer(port = Number(process.env.PORT ?? 3000)): Server {
  const server = createApp();
  server.listen(port, () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : port;
    console.log(`fixfirst listening on http://localhost:${actual}`);
  });
  return server;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) startServer();