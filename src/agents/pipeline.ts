import { DietaryRequest, PipelineState, Recommendation } from "@/types";
import { DietaryIntentAgent } from "./dietary-intent-agent";
import { ClarificationAgent } from "./clarification-agent";
import { RestaurantDiscoveryAgent } from "./restaurant-discovery-agent";
import { EvidenceVerificationAgent } from "./evidence-verification-agent";
import { MapGenerationAgent, MapData } from "./map-generation-agent";
import { ExportAgent, ExportResult, ExportFormat } from "./export-agent";
import { RecommendationAgent } from "./recommendation-agent";
import { scoreRestaurants } from "@/lib/confidence-scorer";
import { DiscoveryError } from "@/lib/errors";
import { isKnownNeed } from "@/lib/tools/diet-tags";

/** What the run produced, beyond the recommendations themselves. */
export interface PipelineMeta {
  enforceableNeeds: string[];
  /** Needs OSM cannot express — surfaced to the user, never silently dropped. */
  unenforceableNeeds: string[];
  effectiveRadiusM: number;
  radiusSearchedM: number;
  candidatesScanned: number;
  resolvedLocation: string;
}

/**
 * Agent Pipeline Orchestrator
 * Coordinates the full workflow from user request to recommendations,
 * following the exact flow defined in the Trojans board:
 *
 * Start → Mobile UI → Dietary Intent Agent → [Clarification?] →
 * Restaurant Discovery → Evidence Verification → Trust & Confidence →
 * [Too few results? → Relax constraints] → Recommendation → End
 */
export class AgentPipeline {
  private dietaryIntentAgent = new DietaryIntentAgent();
  private clarificationAgent = new ClarificationAgent();
  private discoveryAgent = new RestaurantDiscoveryAgent();
  private evidenceAgent = new EvidenceVerificationAgent();
  private mapAgent = new MapGenerationAgent();
  private exportAgent = new ExportAgent();
  private recommendationAgent = new RecommendationAgent();

  private state: PipelineState = {
    status: "idle",
    currentAgent: null,
    request: null,
    parsedIntent: null,
    clarificationNeeded: null,
    restaurants: [],
    evidence: [],
    confidenceScores: [],
    recommendations: [],
    mapData: null,
    exportResult: null,
    error: null,
  };

  private meta: PipelineMeta | null = null;
  private onStateChange?: (state: PipelineState) => void;

  constructor(onStateChange?: (state: PipelineState) => void) {
    this.onStateChange = onStateChange;
  }

  getState(): PipelineState {
    return { ...this.state };
  }

  getMeta(): PipelineMeta | null {
    return this.meta;
  }

  /** Set when the failure was an upstream service rather than a bad request. */
  getErrorCode(): string | null {
    return this.errorCode;
  }

  private errorCode: string | null = null;

  /**
   * Start the pipeline with a user request
   */
  async run(request: DietaryRequest): Promise<Recommendation[]> {
    try {
      this.updateState({ status: "processing", request, error: null });

      // Step 1: Parse dietary intent
      this.updateState({ currentAgent: "dietary_intent" });
      const parsedIntent = await this.dietaryIntentAgent.process(request);
      this.updateState({ parsedIntent });

      // Step 2: Check if clarification is needed.
      // A missing location is as blocking as an ambiguous one — without it
      // there is nothing to geocode.
      if (parsedIntent.isLocationAmbiguous || !parsedIntent.location.trim()) {
        this.updateState({ currentAgent: "clarification" });
        const questions =
          await this.clarificationAgent.process(parsedIntent);

        if (questions.length > 0) {
          this.updateState({
            status: "awaiting_clarification",
            clarificationNeeded: questions,
          });
          return []; // Wait for user response
        }
      }

      // Step 3-6: Continue with discovery and verification
      return await this.continueAfterClarification();
    } catch (error) {
      // Errors are recorded with a machine-readable code so the API route can
      // distinguish "your location does not exist" from "OpenStreetMap is down"
      // from "nothing matched". Previously all three returned an empty array
      // and were reported to the user as "no restaurants found".
      const message =
        error instanceof Error ? error.message : "Pipeline error";
      this.errorCode =
        error instanceof DiscoveryError ? error.code : "internal";
      this.updateState({ status: "error", error: message });
      return [];
    }
  }

  /**
   * Resume pipeline after user provides clarification
   */
  async resumeWithClarification(
    answers: Record<string, string>
  ): Promise<Recommendation[]> {
    if (!this.state.parsedIntent) {
      throw new Error("No pending intent to clarify");
    }

    let intent = this.state.parsedIntent;

    // Apply clarification answers
    if (answers.location) {
      intent = this.clarificationAgent.resolveLocation(
        intent,
        answers.location
      );
    }

    // Clarification answers are user input and get the same vocabulary check as
    // everything else. The dietary question offers "No specific requirements",
    // which would otherwise be pushed in verbatim as a dietary need.
    if (answers.dietaryNeeds) {
      const value = answers.dietaryNeeds.trim().toLowerCase();
      if (isKnownNeed(value) && !intent.dietaryNeeds.includes(value)) {
        intent = {
          ...intent,
          dietaryNeeds: [...intent.dietaryNeeds, value],
        };
      }
    }

    if (answers.mealType) {
      intent = { ...intent, mealType: answers.mealType };
    }

    this.updateState({
      parsedIntent: intent,
      clarificationNeeded: null,
      status: "processing",
    });

    return await this.continueAfterClarification();
  }

  private async continueAfterClarification(): Promise<Recommendation[]> {
    const intent = this.state.parsedIntent!;

    // Step 3: Restaurant Discovery. Throws a typed DiscoveryError rather than
    // returning [] when geocoding or Overpass fails.
    this.updateState({ currentAgent: "restaurant_discovery" });
    const discovery = await this.discoveryAgent.process(intent);
    const { restaurants, enforceableNeeds, unenforceableNeeds } = discovery;
    this.updateState({ restaurants });

    this.meta = {
      enforceableNeeds,
      unenforceableNeeds,
      effectiveRadiusM: discovery.effectiveRadiusM,
      radiusSearchedM: discovery.radiusSearchedM,
      candidatesScanned: discovery.candidatesScanned,
      resolvedLocation: discovery.geocoded.displayName,
    };

    // Steps 4 and 5 are independent of each other, so they run concurrently.
    this.updateState({ currentAgent: "evidence_verification" });
    const [evidence, scores] = await Promise.all([
      this.evidenceAgent.process(
        restaurants,
        intent,
        enforceableNeeds,
        unenforceableNeeds
      ),
      Promise.resolve(
        scoreRestaurants(restaurants, enforceableNeeds, intent.dietaryNeeds)
      ),
    ]);
    this.updateState({ evidence, confidenceScores: scores });

    // There is deliberately no confidence-threshold filter here any more. The
    // hard dietary filter is the safety gate; dropping *verified* matches for
    // scoring below an arbitrary 0.5 removed correct results silently.

    // Step 6: Map Generation
    this.updateState({ currentAgent: "map_generation" });
    const confidenceMap = new Map(scores.map((s) => [s.restaurantId, s.overall]));
    const mapData = await this.mapAgent.process(restaurants, intent, confidenceMap);
    this.updateState({ mapData });

    // Step 7: Generate Recommendations
    this.updateState({ currentAgent: "recommendation" });
    const recommendations = await this.recommendationAgent.process(
      restaurants,
      scores,
      evidence,
      intent,
      enforceableNeeds,
      unenforceableNeeds
    );

    // Step 8: Export
    this.updateState({ currentAgent: "export" });
    const exportResult = await this.exportAgent.process(recommendations, "json");
    this.updateState({
      recommendations,
      exportResult,
      status: "complete",
      currentAgent: null,
    });

    return recommendations;
  }

  /**
   * Export recommendations in a specific format
   */
  async export(format: ExportFormat): Promise<ExportResult> {
    return this.exportAgent.process(this.state.recommendations, format);
  }

  /**
   * Get map data from the pipeline state
   */
  getMapData(): MapData | null {
    return this.state.mapData;
  }

  private updateState(partial: Partial<PipelineState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.getState());
  }
}
