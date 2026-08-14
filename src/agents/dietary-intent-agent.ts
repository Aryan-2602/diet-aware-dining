import { DietaryRequest, ParsedIntent } from "@/types";
import {
  callLLM,
  parseJSONResponse,
  LLMUnavailableError,
} from "@/lib/llm-client";

/** Raw, untrusted shape returned by the LLM before validation. */
interface LLMExtractedIntent {
  dietaryNeeds?: unknown;
  location?: unknown;
  cuisineType?: unknown;
  mealType?: unknown;
  priceRange?: unknown;
}

/**
 * Dietary Intent Agent
 * First agent in the pipeline. Parses user's free-text dietary request
 * into structured intent, identifying dietary needs, restrictions,
 * location, cuisine preferences, and meal type.
 *
 * Extraction is LLM-based (OpenAI Chat Completions). If the LLM is
 * unavailable — no API key, network failure, timeout, unparseable output —
 * it falls back to the original deterministic keyword/regex parser so the
 * request still completes.
 */
export class DietaryIntentAgent {
  private readonly DIETARY_KEYWORDS: Record<string, string[]> = {
    vegan: ["vegan", "plant-based", "no animal"],
    vegetarian: ["vegetarian", "veggie", "no meat"],
    "gluten-free": ["gluten-free", "gluten free", "celiac", "no gluten"],
    "dairy-free": ["dairy-free", "dairy free", "lactose", "no dairy"],
    keto: ["keto", "ketogenic", "low-carb", "low carb"],
    halal: ["halal"],
    kosher: ["kosher"],
    paleo: ["paleo", "paleolithic"],
    "nut-free": ["nut-free", "nut free", "no nuts", "peanut-free"],
  };

  private readonly CUISINE_KEYWORDS = [
    "italian",
    "mexican",
    "chinese",
    "japanese",
    "indian",
    "thai",
    "korean",
    "mediterranean",
    "american",
    "french",
    "vietnamese",
    "greek",
    "middle eastern",
    "ethiopian",
    "caribbean",
  ];

  private readonly MEAL_TYPES = [
    "breakfast",
    "brunch",
    "lunch",
    "dinner",
    "late-night",
    "snack",
  ];

  async process(request: DietaryRequest): Promise<ParsedIntent> {
    try {
      return await this.processWithLLM(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[DietaryIntentAgent] LLM extraction unavailable, falling back to rule-based parser: ${message}`
      );
      return this.processWithRules(request);
    }
  }

  // --- LLM-based extraction ------------------------------------------------

  private async processWithLLM(
    request: DietaryRequest
  ): Promise<ParsedIntent> {
    const vocabulary = Object.keys(this.DIETARY_KEYWORDS);

    const system = [
      "You extract structured dining intent from a diner's free-text request.",
      "Return ONLY a JSON object. No prose, no explanation, no markdown code fences.",
      "",
      "The object must have exactly this shape:",
      "{",
      '  "dietaryNeeds": string[],',
      '  "location": string,',
      '  "cuisineType": string|null,',
      '  "mealType": string|null,',
      '  "priceRange": "budget"|"moderate"|"premium"|"any"',
      "}",
      "",
      `"dietaryNeeds" may only contain values from this list: ${JSON.stringify(
        vocabulary
      )}.`,
      'Infer them from phrasing rather than exact wording — "can\'t have gluten" is "gluten-free",',
      '"no animal products" is "vegan", "lactose intolerant" is "dairy-free".',
      "Never invent a category outside the list. Use [] when none apply.",
      "",
      `"cuisineType" must be exactly one of ${JSON.stringify(
        this.CUISINE_KEYWORDS
      )}, or null if the diner did not indicate one.`,
      `"mealType" must be exactly one of ${JSON.stringify(
        this.MEAL_TYPES
      )}, or null if the diner did not indicate one.`,
      '"priceRange" must be exactly one of "budget", "moderate", "premium", or "any".',
      'Use "any" when the diner said nothing about price.',
      "",
      '"location" is the place the diner wants to eat, copied as plainly as it appears',
      'in the query (a neighborhood, city, or landmark). Use "" if no location is stated.',
      "Do not guess a location and do not judge whether it is specific enough.",
    ].join("\n");

    const user = [
      `Query: ${request.query}`,
      `Dietary preferences already on file: ${JSON.stringify(
        request.dietaryPreferences
      )}`,
    ].join("\n");

    const raw = await callLLM({ system, user, jsonMode: true });

    let parsed: LLMExtractedIntent;
    try {
      parsed = parseJSONResponse<LLMExtractedIntent>(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMUnavailableError(
        `Could not parse JSON from LLM response: ${message}`
      );
    }

    // Every field below is validated before use — the model's output is not
    // trusted to stay inside the controlled vocabularies.
    const needs = new Set<string>(request.dietaryPreferences);
    if (Array.isArray(parsed.dietaryNeeds)) {
      for (const need of parsed.dietaryNeeds) {
        if (typeof need === "string" && vocabulary.includes(need)) {
          needs.add(need);
        }
      }
    }

    // A caller-supplied location always wins, matching the rule-based path.
    const extractedLocation =
      typeof parsed.location === "string" ? parsed.location.trim() : "";
    const location = request.location ? request.location : extractedLocation;

    const cuisineType =
      typeof parsed.cuisineType === "string" &&
      this.CUISINE_KEYWORDS.includes(parsed.cuisineType)
        ? parsed.cuisineType
        : undefined;

    const mealType =
      typeof parsed.mealType === "string" &&
      this.MEAL_TYPES.includes(parsed.mealType)
        ? parsed.mealType
        : undefined;

    const priceRange =
      parsed.priceRange === "budget" ||
      parsed.priceRange === "moderate" ||
      parsed.priceRange === "premium" ||
      parsed.priceRange === "any"
        ? parsed.priceRange
        : "any";

    return {
      dietaryNeeds: Array.from(needs),
      restrictions: this.extractRestrictions(request),
      location,
      // Ambiguity stays deterministic — the LLM is not asked to judge it.
      isLocationAmbiguous: this.isLocationAmbiguous(location),
      cuisineType,
      mealType,
      priceRange,
    };
  }

  // --- Deterministic fallback ----------------------------------------------

  private processWithRules(request: DietaryRequest): ParsedIntent {
    const query = request.query.toLowerCase();

    const dietaryNeeds = this.extractDietaryNeedsRuleBased(query, request);
    const restrictions = this.extractRestrictions(request);
    const location = this.extractLocationRuleBased(query, request);
    const cuisineType = this.extractCuisineRuleBased(query);
    const mealType = this.extractMealTypeRuleBased(query);
    const priceRange = this.extractPriceRangeRuleBased(query);

    return {
      dietaryNeeds,
      restrictions,
      location: location.value,
      isLocationAmbiguous: location.isAmbiguous,
      cuisineType,
      mealType,
      priceRange,
    };
  }

  private extractDietaryNeedsRuleBased(
    query: string,
    request: DietaryRequest
  ): string[] {
    const needs = new Set<string>(request.dietaryPreferences);

    for (const [need, keywords] of Object.entries(this.DIETARY_KEYWORDS)) {
      if (keywords.some((kw) => query.includes(kw))) {
        needs.add(need);
      }
    }

    return Array.from(needs);
  }

  private extractRestrictions(request: DietaryRequest): string[] {
    return [...request.allergies];
  }

  private extractLocationRuleBased(
    query: string,
    request: DietaryRequest
  ): { value: string; isAmbiguous: boolean } {
    if (request.location) {
      return {
        value: request.location,
        isAmbiguous: this.isLocationAmbiguous(request.location),
      };
    }

    // Try to extract location from query
    const locationPatterns = [
      /(?:in|near|around|close to)\s+(.+?)(?:\s+that|\s+with|\s+for|$)/i,
      /(?:restaurants?\s+in)\s+(.+?)(?:\s+that|\s+with|\s+for|$)/i,
    ];

    for (const pattern of locationPatterns) {
      const match = query.match(pattern);
      if (match) {
        const loc = match[1].trim();
        return { value: loc, isAmbiguous: this.isLocationAmbiguous(loc) };
      }
    }

    return { value: "", isAmbiguous: true };
  }

  private isLocationAmbiguous(location: string): boolean {
    // A location is ambiguous if it's too vague or could refer to multiple places
    const ambiguousTerms = [
      "downtown",
      "near me",
      "nearby",
      "around here",
      "close",
    ];
    const lowered = location.toLowerCase();

    if (ambiguousTerms.some((term) => lowered.includes(term))) return true;
    if (location.trim().length < 3) return true; // Too short to be a real location

    return false;
  }

  private extractCuisineRuleBased(query: string): string | undefined {
    return this.CUISINE_KEYWORDS.find((c) => query.includes(c));
  }

  private extractMealTypeRuleBased(query: string): string | undefined {
    return this.MEAL_TYPES.find((m) => query.includes(m));
  }

  private extractPriceRangeRuleBased(
    query: string
  ): "budget" | "moderate" | "premium" | "any" {
    if (query.match(/cheap|budget|affordable|inexpensive/)) return "budget";
    if (query.match(/moderate|mid-range|reasonable/)) return "moderate";
    if (query.match(/upscale|fine dining|expensive|premium|fancy/))
      return "premium";
    return "any";
  }
}
