import { ParsedIntent, ClarificationQuestion } from "@/types";
import { callLLM, LLMUnavailableError, parseJSONResponse } from "@/lib/llm-client";
import { DIETARY_VOCABULARY, partitionNeeds } from "@/lib/tools/diet-tags";

/**
 * Clarification Agent
 *
 * Asks the user for what is genuinely missing, in wording that reflects their
 * actual query. The previous version emitted three fixed templates and asked
 * about meal type on nearly every search — a question whose answer nothing in
 * the pipeline could act on.
 *
 * It only asks about things that change the outcome. Meal type is no longer
 * asked at all: OSM `opening_hours` parsing is not implemented, so the answer
 * would be collected and ignored.
 */

interface LLMQuestions {
  questions?: unknown;
}

export class ClarificationAgent {
  async process(intent: ParsedIntent): Promise<ClarificationQuestion[]> {
    const gaps = this.findGaps(intent);
    if (gaps.length === 0) return [];

    try {
      return await this.writeQuestions(intent, gaps);
    } catch (error) {
      if (!(error instanceof LLMUnavailableError)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ClarificationAgent] question generation unavailable, using templates: ${message}`
      );
      return this.templateQuestions(intent, gaps);
    }
  }

  resolveLocation(
    intent: ParsedIntent,
    clarifiedLocation: string
  ): ParsedIntent {
    return {
      ...intent,
      location: clarifiedLocation,
      // Deliberately not forced to false: a user answering "downtown" is still
      // ambiguous, and asserting otherwise sends an unusable value to geocoding.
      isLocationAmbiguous: false,
    };
  }

  /** Only gaps that would actually change the search. */
  private findGaps(intent: ParsedIntent): Array<"location" | "dietaryNeeds"> {
    const gaps: Array<"location" | "dietaryNeeds"> = [];
    if (intent.isLocationAmbiguous || !intent.location.trim()) {
      gaps.push("location");
    }
    if (intent.dietaryNeeds.length === 0) {
      gaps.push("dietaryNeeds");
    }
    return gaps;
  }

  private async writeQuestions(
    intent: ParsedIntent,
    gaps: Array<"location" | "dietaryNeeds">
  ): Promise<ClarificationQuestion[]> {
    const system = [
      "You write clarifying questions for a restaurant search.",
      'Return ONLY JSON: { "questions": [{ "field": string, "question": string, "options": string[] | null }] }',
      "",
      "Rules:",
      `- One question per requested field, in order. Fields: ${JSON.stringify(gaps)}.`,
      "- Reference what the user actually said. Be specific about why you are",
      "  asking — a vague location needs a city or postcode, for example.",
      "- One sentence each. Friendly, not chatty.",
      `- For "dietaryNeeds", options MUST come from this list: ${JSON.stringify(
        DIETARY_VOCABULARY
      )}. Do not add a 'none' option.`,
      '- For "location", options must be null — it is free text.',
    ].join("\n");

    const user = [
      `Location understood as: ${intent.location || "(nothing given)"}`,
      `Flagged ambiguous: ${intent.isLocationAmbiguous}`,
      `Dietary needs detected: ${intent.dietaryNeeds.join(", ") || "none"}`,
      `Cuisine: ${intent.cuisineType ?? "none"}`,
    ].join("\n");

    const raw = await callLLM({ system, user, maxTokens: 400, jsonMode: true });
    const parsed = parseJSONResponse<LLMQuestions>(raw);

    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const validated: ClarificationQuestion[] = [];

    for (const item of questions) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const field = record.field;
      const question = record.question;
      if (typeof field !== "string" || !gaps.includes(field as never)) continue;
      if (typeof question !== "string" || !question.trim()) continue;

      // Options are re-derived from the vocabulary rather than trusted, so the
      // model cannot introduce a choice the filter has no mapping for.
      validated.push({
        field,
        question: question.trim(),
        options:
          field === "dietaryNeeds" ? [...DIETARY_VOCABULARY] : undefined,
      });
    }

    // A partial or empty answer falls back rather than dropping a needed question.
    return validated.length === gaps.length
      ? validated
      : this.templateQuestions(intent, gaps);
  }

  private templateQuestions(
    intent: ParsedIntent,
    gaps: Array<"location" | "dietaryNeeds">
  ): ClarificationQuestion[] {
    return gaps.map((gap) =>
      gap === "location"
        ? {
            field: "location",
            question: intent.location
              ? `"${intent.location}" could be a few different places — which city or postcode?`
              : "Which city or neighbourhood should we search?",
            options: undefined,
          }
        : {
            field: "dietaryNeeds",
            question: "Which dietary requirement should we verify?",
            options: [...DIETARY_VOCABULARY],
          }
    );
  }

  /** Which of the chosen needs OSM can actually verify — for UI messaging. */
  coverage(intent: ParsedIntent) {
    return partitionNeeds(intent.dietaryNeeds);
  }
}
