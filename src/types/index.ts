/**
 * Shared domain types. Field names stay camelCase to match the Python API
 * JSON contract — renaming them would silently break every component that
 * reads a recommendation payload.
 */

/** What SearchForm POSTs to `/api/recommend`. */
export interface DietaryRequest {
  query: string;
  location?: string;
  dietaryPreferences: string[];
  allergies: string[];
  cuisinePreferences: string[];
}

/** Structured intent after DietaryIntentAgent. `restrictions` are allergies. */
export interface ParsedIntent {
  dietaryNeeds: string[];
  restrictions: string[];
  location: string;
  isLocationAmbiguous: boolean;
  cuisineType?: string;
  mealType?: string;
  priceRange?: "budget" | "moderate" | "premium" | "any";
}

/** Follow-up shown in ClarificationDialog. `field` is the answer key. */
export interface ClarificationQuestion {
  field: string;
  question: string;
  options?: string[];
}

/**
 * Every field here comes from OpenStreetMap. There is deliberately no `rating`,
 * `reviewCount`, `priceLevel` or `source`: OSM has none of those, and the
 * previous version synthesized them from how many tags a place happened to
 * have, then displayed the result as if it came from Google or Yelp.
 */
export interface Restaurant {
  id: string;
  name: string;
  address: string;
  cuisine: string[];
  /** Vocabulary needs this place positively satisfies. */
  dietaryOptions: string[];
  /** Raw `diet:*` tags, so evidence can quote the source verbatim. */
  dietTags: Record<string, string>;
  location: {
    lat: number;
    lng: number;
  };
  osmType: OsmElementType;
  osmId: number;
  distance?: number;
  openingHours?: string;
  website?: string;
  phone?: string;
  /** OSM `check_date` — when a mapper last confirmed this listing. */
  lastCheckedISO?: string;
}

export type OsmElementType = "node" | "way" | "relation";

export interface Evidence {
  restaurantId: string;
  claim: string;
  /** Whether the underlying OSM tag exists. A fact, not a judgement. */
  verified: boolean;
  /** Belief the tag is still accurate, derived from its check date. */
  confidence: number;
  menuConfirmed: boolean;
}

export interface ConfidenceScore {
  restaurantId: string;
  overall: number;
  /** `only` outranks `yes`: whole-establishment beats some-options. */
  dietTagStrength: number;
  /** Share of the user's needs OSM can express at all. */
  coverage: number;
  /** Derived from OSM check_date. */
  tagRecency: number;
  /** Listing completeness — explicitly not a popularity signal. */
  dataCompleteness: number;
}

/** One ranked result: the OSM place plus score, evidence, reasons, warnings. */
export interface Recommendation {
  restaurant: Restaurant;
  confidence: ConfidenceScore;
  evidence: Evidence[];
  matchReasons: string[];
  warnings: string[];
}

export interface MapMarkerData {
  restaurantId: string;
  name: string;
  lat: number;
  lng: number;
  confidence: number;
  dietaryOptions: string[];
  googleMapsUrl: string;
}

export interface MapData {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarkerData[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface ExportResultData {
  format: "json" | "text" | "csv";
  content: string;
  filename: string;
}

/**
 * Snapshot of one AgentPipeline run. The React app does not hold this object;
 * it consumes the JSON fields the API copies out of it (`recommendations`,
 * `mapData`, `parsedIntent`, `meta`).
 */
export interface PipelineState {
  status: AgentStatus;
  currentAgent: AgentName | null;
  request: DietaryRequest | null;
  parsedIntent: ParsedIntent | null;
  clarificationNeeded: ClarificationQuestion[] | null;
  restaurants: Restaurant[];
  evidence: Evidence[];
  confidenceScores: ConfidenceScore[];
  recommendations: Recommendation[];
  mapData: MapData | null;
  exportResult: ExportResultData | null;
  error: string | null;
}

export type AgentStatus =
  | "idle"
  | "processing"
  | "awaiting_clarification"
  | "complete"
  | "error";

/** Step ids for InterpretationView. Some names are historical (e.g. `trust_confidence` is now the deterministic scorer). */
export type AgentName =
  | "dietary_intent"
  | "clarification"
  | "restaurant_discovery"
  | "evidence_verification"
  | "trust_confidence"
  | "map_generation"
  | "export"
  | "recommendation";
