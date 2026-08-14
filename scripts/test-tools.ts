/**
 * Unit tests for the pure functions that decide dietary safety and ranking.
 *
 * These are the functions worth testing above all others: everything else in
 * the pipeline is presentation or I/O, but a bug here shows someone a restaurant
 * that does not meet their dietary requirement. Deliberately dependency-free —
 * run with `npm run test:tools`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  cuisineFilter,
  cuisineMatches,
  dietTagStrength,
  isKnownNeed,
  matchesAllNeeds,
  partitionNeeds,
} from "../src/lib/tools/diet-tags";
import {
  buildOverpassQuery,
  dietFilterCombinations,
} from "../src/lib/tools/overpass";
import {
  completenessScore,
  recencyScore,
  scoreRestaurant,
} from "../src/lib/confidence-scorer";
import type { Restaurant } from "../src/types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL  ${name}\n        ${message.split("\n")[0]}`);
  }
}

function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "osm-node-1",
    name: "Test",
    address: "1 Test St",
    cuisine: ["vegan"],
    dietaryOptions: ["vegan"],
    dietTags: { "diet:vegan": "yes" },
    location: { lat: 0, lng: 0 },
    osmType: "node",
    osmId: 1,
    ...overrides,
  };
}

console.log("\n=== Dietary safety predicate ===");

test("a positive tag satisfies the need", () => {
  assert.equal(matchesAllNeeds({ "diet:vegan": "yes" }, ["vegan"]), true);
});

test("'only' also satisfies the need", () => {
  assert.equal(matchesAllNeeds({ "diet:vegan": "only" }, ["vegan"]), true);
});

test("a MISSING tag never passes — 'unknown' is not 'yes'", () => {
  assert.equal(matchesAllNeeds({}, ["vegan"]), false);
  assert.equal(matchesAllNeeds({ amenity: "restaurant" }, ["vegan"]), false);
});

test("diet:vegan=no is rejected, not treated as presence of the tag", () => {
  assert.equal(matchesAllNeeds({ "diet:vegan": "no" }, ["vegan"]), false);
});

test("diet:vegan=limited is rejected", () => {
  assert.equal(matchesAllNeeds({ "diet:vegan": "limited" }, ["vegan"]), false);
});

test("EVERY need must be satisfied, not any", () => {
  const tags = { "diet:vegan": "yes" };
  assert.equal(matchesAllNeeds(tags, ["vegan", "gluten-free"]), false);
  assert.equal(
    matchesAllNeeds({ ...tags, "diet:gluten_free": "yes" }, [
      "vegan",
      "gluten-free",
    ]),
    true
  );
});

test("vegan implies vegetarian", () => {
  assert.equal(matchesAllNeeds({ "diet:vegan": "yes" }, ["vegetarian"]), true);
});

test("vegan implies dairy-free", () => {
  assert.equal(matchesAllNeeds({ "diet:vegan": "yes" }, ["dairy-free"]), true);
});

test("vegetarian does NOT imply vegan", () => {
  assert.equal(matchesAllNeeds({ "diet:vegetarian": "yes" }, ["vegan"]), false);
});

test("an unenforceable need can never be satisfied by any tag", () => {
  assert.equal(matchesAllNeeds({ "diet:nut_free": "yes" }, ["nut-free"]), false);
});

console.log("\n=== Enforceable / unenforceable partition ===");

test("splits needs by whether OSM can express them", () => {
  const { enforceable, unenforceable } = partitionNeeds([
    "vegan",
    "keto",
    "gluten-free",
    "nut-free",
  ]);
  assert.deepEqual(enforceable, ["vegan", "gluten-free"]);
  assert.deepEqual(unenforceable, ["keto", "nut-free"]);
});

test("junk values are rejected by the vocabulary check", () => {
  for (const junk of ["high-protein", "asian", "jain", "open-now", "bogus"]) {
    assert.equal(isKnownNeed(junk), false, `${junk} should be unknown`);
  }
  assert.equal(isKnownNeed("vegan"), true);
});

console.log("\n=== Overpass query construction ===");

test("diet filter is present in the query", () => {
  const q = buildOverpassQuery({
    lat: 47.6,
    lng: -122.3,
    radiusM: 2000,
    dietNeeds: ["vegan"],
  });
  assert.match(q, /\["diet:vegan"~"\^\(yes\|only\)\$"\]/);
});

test("no 30-element cap — it returned oldest ids, not nearest", () => {
  const q = buildOverpassQuery({
    lat: 47.6,
    lng: -122.3,
    radiusM: 2000,
    dietNeeds: ["vegan"],
  });
  assert.match(q, /out tags center 200;/);
  assert.doesNotMatch(q, /out center 30;/);
});

test("fast_food is included, and node/way/relation via nwr", () => {
  const q = buildOverpassQuery({
    lat: 47.6,
    lng: -122.3,
    radiusM: 2000,
    dietNeeds: ["vegan"],
  });
  assert.match(q, /fast_food/);
  assert.match(q, /^\s*nwr/m);
});

test("alternatives become a union; needs AND on one statement", () => {
  const combos = dietFilterCombinations(["vegetarian", "gluten-free"]);
  assert.equal(combos.length, 2);
  for (const combo of combos) assert.equal(combo.length, 2);
});

test("cuisine is omitted from the query when a diet filter bounds it", () => {
  const q = buildOverpassQuery({
    lat: 47.6,
    lng: -122.3,
    radiusM: 2000,
    dietNeeds: ["vegan"],
    cuisineType: "japanese",
  });
  assert.doesNotMatch(q, /cuisine/);
});

test("cuisine IS used when there is no diet filter to bound the set", () => {
  const q = buildOverpassQuery({
    lat: 47.6,
    lng: -122.3,
    radiusM: 2000,
    dietNeeds: [],
    cuisineType: "japanese",
  });
  assert.match(q, /cuisine/);
});

console.log("\n=== Cuisine matching ===");

test("'middle eastern' maps to OSM's middle_eastern", () => {
  const filter = cuisineFilter("middle eastern");
  assert.ok(filter);
  assert.match(filter!, /middle_eastern/);
});

test("anchored so 'american' does not match latin_american", () => {
  assert.equal(cuisineMatches(["latin_american"], "american"), false);
  assert.equal(cuisineMatches(["american"], "american"), true);
  assert.equal(cuisineMatches(["new_american"], "american"), true);
});

test("synonyms widen the match (japanese -> sushi/ramen)", () => {
  assert.equal(cuisineMatches(["ramen"], "japanese"), true);
  assert.equal(cuisineMatches(["sushi"], "japanese"), true);
});

test("multi-value cuisine tags are handled", () => {
  assert.equal(cuisineMatches(["japanese", "ramen"], "japanese"), true);
});

console.log("\n=== Confidence scoring ===");

test("'only' outranks 'yes'", () => {
  assert.ok(
    dietTagStrength({ "diet:vegan": "only" }, ["vegan"]) >
      dietTagStrength({ "diet:vegan": "yes" }, ["vegan"])
  );
});

test("a missing check_date scores 0, not a middling default", () => {
  assert.equal(recencyScore(undefined), 0);
  assert.equal(recencyScore("not-a-date"), 0);
});

test("recency decays with age", () => {
  const recent = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 5 * 365 * 864e5).toISOString().slice(0, 10);
  assert.ok(recencyScore(recent) > recencyScore(old));
});

test("completeness counts real fields only", () => {
  assert.equal(completenessScore(restaurant({ cuisine: ["restaurant"] })), 1 / 5);
  assert.equal(
    completenessScore(
      restaurant({
        openingHours: "Mo-Su 09:00-17:00",
        website: "https://x.test",
        phone: "+1",
        cuisine: ["vegan"],
      })
    ),
    1
  );
});

test("scoring is deterministic — the same input scores identically", () => {
  const r = restaurant({ lastCheckedISO: "2025-06-01" });
  const a = scoreRestaurant(r, ["vegan"], ["vegan"]);
  const b = scoreRestaurant(r, ["vegan"], ["vegan"]);
  assert.deepEqual(a, b);
});

test("coverage reports the share of needs OSM can verify", () => {
  const score = scoreRestaurant(restaurant(), ["vegan"], ["vegan", "keto"]);
  assert.equal(score.coverage, 0.5);
});

test("scores stay within 0..1", () => {
  const score = scoreRestaurant(
    restaurant({
      dietTags: { "diet:vegan": "only" },
      lastCheckedISO: new Date().toISOString().slice(0, 10),
      openingHours: "x",
      website: "x",
      phone: "x",
    }),
    ["vegan"],
    ["vegan"]
  );
  assert.ok(score.overall > 0 && score.overall <= 1, `got ${score.overall}`);
});

console.log("\n=== Against a real-shaped Overpass fixture ===");

/**
 * Runs the deterministic part of discovery over the fixture: the same filter,
 * scoring and ordering the pipeline applies, without needing the network.
 * Overpass is a shared free service and is regularly saturated, so the
 * end-to-end eval skips when it is down — these assertions never skip.
 */
function fromFixture(needs: string[]) {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "fixtures", "overpass-seattle-vegan.json"),
      "utf8"
    )
  ) as { elements: Array<Record<string, any>> };

  return raw.elements
    .filter((el) => matchesAllNeeds(el.tags ?? {}, needs))
    .map((el) => {
      const r: Restaurant = restaurant({
        id: `osm-${el.type}-${el.id}`,
        name: el.tags.name,
        osmType: el.type,
        osmId: el.id,
        dietTags: Object.fromEntries(
          Object.entries(el.tags).filter(([k]) => k.startsWith("diet:"))
        ) as Record<string, string>,
        cuisine: String(el.tags.cuisine ?? "restaurant").split(";"),
        website: el.tags.website,
        phone: el.tags.phone,
        openingHours: el.tags.opening_hours,
        lastCheckedISO:
          el.tags["check_date:diet:vegan"] ?? el.tags.check_date,
        address: el.tags["addr:street"] ?? "Address not in OpenStreetMap",
      });
      return { r, score: scoreRestaurant(r, needs, needs) };
    })
    .sort((a, b) => b.score.overall - a.score.overall);
}

test("only positively-tagged places survive the vegan filter", () => {
  const names = fromFixture(["vegan"]).map((x) => x.r.name).sort();
  assert.deepEqual(names, [
    "Askatu",
    "Building-Mapped Vegan Kitchen",
    "Mendocino Farms",
    "Voodoo Doughnut",
  ]);
});

test("diet:vegan=no, =limited, missing, and vegetarian-only are all excluded", () => {
  const names = fromFixture(["vegan"]).map((x) => x.r.name);
  for (const excluded of [
    "Explicitly Not Vegan",
    "Only Limited Vegan Options",
    "Untagged Diner",
    "Vegetarian But Not Vegan",
  ]) {
    assert.ok(!names.includes(excluded), `${excluded} should not appear`);
  }
});

test("way elements survive — they were invisible under the old query", () => {
  const types = fromFixture(["vegan"]).map((x) => x.r.osmType);
  assert.ok(types.includes("way"));
});

test("multi-need filtering intersects correctly", () => {
  const names = fromFixture(["vegan", "gluten-free"]).map((x) => x.r.name).sort();
  assert.deepEqual(names, ["Askatu", "Mendocino Farms", "Voodoo Doughnut"]);
});

test("end-to-end ordering is byte-identical across runs", () => {
  const a = JSON.stringify(fromFixture(["vegan"]));
  const b = JSON.stringify(fromFixture(["vegan"]));
  assert.equal(a, b);
});

test("a recently-checked 'only' place outranks a stale 'yes' place", () => {
  const ranked = fromFixture(["vegan"]);
  const askatu = ranked.findIndex((x) => x.r.name === "Askatu");
  const stale = ranked.findIndex(
    (x) => x.r.name === "Building-Mapped Vegan Kitchen"
  );
  assert.ok(askatu < stale, `Askatu ${askatu} should outrank stale ${stale}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
