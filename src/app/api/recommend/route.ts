import { NextRequest, NextResponse } from "next/server";
import { AgentPipeline } from "@/agents/pipeline";
import { DietaryRequest } from "@/types";
import { respondWithPipeline } from "../_shared/respond";

// The pipeline makes an LLM call plus geocoding and Overpass requests. Without
// this, the platform default (10s on Vercel Hobby) kills the run mid-flight and
// the client receives an HTML error page where it expects JSON.
export const maxDuration = 60;

/** Coerces untrusted JSON into the shape the pipeline expects. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<DietaryRequest>;

    if (typeof body.query !== "string" || !body.query.trim()) {
      return NextResponse.json(
        { status: "error", code: "bad_request", message: "Query is required" },
        { status: 400 }
      );
    }

    // Previously these were passed through unchecked, so a non-array value
    // reached `[...request.allergies]` and threw a 500.
    const dietaryRequest: DietaryRequest = {
      query: body.query,
      location: typeof body.location === "string" ? body.location : "",
      dietaryPreferences: toStringArray(body.dietaryPreferences),
      allergies: toStringArray(body.allergies),
      cuisinePreferences: toStringArray(body.cuisinePreferences),
    };

    const pipeline = new AgentPipeline();
    await pipeline.run(dietaryRequest);
    return respondWithPipeline(pipeline);
  } catch (error) {
    console.error("Pipeline error:", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal",
        message: "Something went wrong running the search",
      },
      { status: 500 }
    );
  }
}
