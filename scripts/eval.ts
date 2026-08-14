/**
 * End-to-end evaluation against the real Nominatim and Overpass APIs.
 *
 * This is the regression guard for the bugs that made the app return wrong
 * results: dietary needs that never reached the query, non-deterministic
 * scoring, fabricated provenance, and every failure looking like "no results".
 *
 * Run with `npm run eval`. Overpass is a free shared service and is regularly
 * saturated; a network failure here is not the same as a test failure, and the
 * script says which it saw.
 */

import fs from "node:fs";
import path from "node:path";
import { AgentPipeline } from "../src/agents/pipeline";
import { matchesAllNeeds, partitionNeeds } from "../src/lib/tools/diet-tags";
import type { DietaryRequest } from "../src/types";

// Minimal .env loader — the app relies on Next.js to do this at runtime.
function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`);
  }
}

function request(overrides: Partial<DietaryRequest>): DietaryRequest {
  return {
    query: "",
    location: "",
    dietaryPreferences: [],
    allergies: [],
    cuisinePreferences: [],
    ...overrides,
  };
}

async function run(req: DietaryRequest) {
  const pipeline = new AgentPipeline();
  const recommendations = await pipeline.run(req);
  return { pipeline, recommendations, state: pipeline.getState() };
}

/** Overpass being down is an environment problem, not a regression. */
function isUpstreamOutage(code: string | null): boolean {
  return (
    code === "overpass_unavailable" ||
    code === "overpass_timeout" ||
    code === "geocode_unavailable"
  );
}

async function main() {
  loadEnv();
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  console.log(
    `\nOPENAI_API_KEY ${hasKey ? "present — LLM paths active" : "absent — testing deterministic fallbacks"}\n`
  );

  // ---- 1. Dietary enforcement -------------------------------------------
  console.log("=== 1. Every result satisfies every enforceable need ===");
  const cases: Array<{ query: string; needs: string[] }> = [
    { query: "vegan restaurants in Seattle", needs: ["vegan"] },
    {
      query: "vegan and gluten-free food in Seattle",
      needs: ["vegan", "gluten-free"],
    },
    { query: "halal food near Los Angeles", needs: ["halal"] },
  ];

  for (const testCase of cases) {
    const { pipeline, recommendations, state } = await run(
      request({ query: testCase.query })
    );
    if (state.status === "error" && isUpstreamOutage(pipeline.getErrorCode())) {
      skipped++;
      console.log(`  SKIP  ${testCase.query} — upstream unavailable`);
      continue;
    }

    const { enforceable } = partitionNeeds(testCase.needs);
    const violations = recommendations.filter(
      (r) => !matchesAllNeeds(r.restaurant.dietTags, enforceable)
    );
    check(
      `"${testCase.query}" — no result violates the diet`,
      violations.length === 0,
      `${recommendations.length} results, ${violations.length} violations`
    );
  }

  // ---- 2. Determinism ----------------------------------------------------
  console.log("\n=== 2. The same query returns the same results ===");
  {
    const req = request({ query: "vegan restaurants in Seattle" });
    const first = await run(req);
    const second = await run(req);
    if (
      first.state.status === "error" &&
      isUpstreamOutage(first.pipeline.getErrorCode())
    ) {
      skipped++;
      console.log("  SKIP  determinism — upstream unavailable");
    } else {
      const idsA = first.recommendations.map((r) => r.restaurant.id);
      const idsB = second.recommendations.map((r) => r.restaurant.id);
      check(
        "identical ids in identical order",
        JSON.stringify(idsA) === JSON.stringify(idsB),
        `${idsA.length} vs ${idsB.length}`
      );
      const scoresA = first.state.confidenceScores.map((s) => s.overall);
      const scoresB = second.state.confidenceScores.map((s) => s.overall);
      check(
        "identical confidence scores (no Math.random)",
        JSON.stringify(scoresA) === JSON.stringify(scoresB)
      );
    }
  }

  // ---- 3. Geocoding ------------------------------------------------------
  console.log("\n=== 3. Locations resolve to the right place ===");
  {
    const { pipeline, state } = await run(
      request({ query: "vegan food within 5 miles of Seattle" })
    );
    const meta = pipeline.getMeta();
    if (state.status === "error" && isUpstreamOutage(pipeline.getErrorCode())) {
      skipped++;
      console.log("  SKIP  geocoding — upstream unavailable");
    } else {
      check(
        '"within 5 miles of Seattle" resolves to Seattle',
        Boolean(meta?.resolvedLocation?.toLowerCase().includes("seattle")),
        meta?.resolvedLocation ?? "(none)"
      );
    }
  }

  // ---- 4. No fabricated data --------------------------------------------
  console.log("\n=== 4. Nothing is fabricated ===");
  {
    const { pipeline, recommendations, state } = await run(
      request({ query: "vegan restaurants in Seattle" })
    );
    if (state.status === "error" && isUpstreamOutage(pipeline.getErrorCode())) {
      skipped++;
      console.log("  SKIP  fabrication — upstream unavailable");
    } else {
      const sample = recommendations[0]?.restaurant as unknown as
        | Record<string, unknown>
        | undefined;
      check(
        "no rating / reviewCount / priceLevel / source on results",
        !sample ||
          (!("rating" in sample) &&
            !("reviewCount" in sample) &&
            !("priceLevel" in sample) &&
            !("source" in sample))
      );
      check(
        "every id carries its OSM element type",
        recommendations.every((r) =>
          /^osm-(node|way|relation)-\d+$/.test(r.restaurant.id)
        )
      );
    }
  }

  // ---- 5. Honest failure -------------------------------------------------
  console.log("\n=== 5. A bad location is an error, not an empty result ===");
  {
    const { pipeline, state } = await run(
      request({ query: "vegan food in Zzzqqxthisplacedoesnotexist" })
    );
    const code = pipeline.getErrorCode();
    if (isUpstreamOutage(code)) {
      skipped++;
      console.log("  SKIP  honest failure — upstream unavailable");
    } else {
      check(
        'status is "error", not "complete" with zero results',
        state.status === "error",
        `status=${state.status} code=${code}`
      );
      check("error code identifies the cause", code === "geocode_failed", `${code}`);
    }
  }

  // ---- 6. Unenforceable needs are reported, not dropped ------------------
  console.log("\n=== 6. Needs OSM cannot express are surfaced ===");
  {
    const { pipeline, state } = await run(
      request({ query: "keto vegan food in Seattle" })
    );
    const meta = pipeline.getMeta();
    if (state.status === "error" && isUpstreamOutage(pipeline.getErrorCode())) {
      skipped++;
      console.log("  SKIP  unenforceable needs — upstream unavailable");
    } else {
      check(
        '"keto" is reported as unenforceable',
        Boolean(meta?.unenforceableNeeds.includes("keto")),
        JSON.stringify(meta?.unenforceableNeeds ?? [])
      );
      check(
        '"vegan" is still enforced',
        Boolean(meta?.enforceableNeeds.includes("vegan"))
      );
    }
  }

  console.log(
    `\n${passed} passed, ${failed} failed, ${skipped} skipped (upstream unavailable)\n`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nEval crashed:", error);
  process.exit(1);
});
