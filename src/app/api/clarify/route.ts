import { NextRequest, NextResponse } from "next/server";
import { AgentPipeline } from "@/agents/pipeline";
import { DietaryRequest } from "@/types";
import { respondWithPipeline } from "../_shared/respond";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalRequest, answers } = body as {
      originalRequest: DietaryRequest;
      answers: Record<string, string>;
    };

    if (!originalRequest || !answers) {
      return NextResponse.json(
        {
          status: "error",
          code: "bad_request",
          message: "originalRequest and answers are required",
        },
        { status: 400 }
      );
    }

    // Every answer is merged, not just the location. The clarification agent
    // asks about dietary needs and meal type too, and the dialog lets the user
    // answer them — those answers used to be dropped on the floor here, so the
    // re-run was byte-identical to the request that had just asked for them.
    const clarifiedRequest: DietaryRequest = {
      ...originalRequest,
      location: answers.location?.trim() || originalRequest.location,
      dietaryPreferences: [
        ...originalRequest.dietaryPreferences,
        ...(answers.dietaryNeeds ? [answers.dietaryNeeds] : []),
      ],
    };

    const pipeline = new AgentPipeline();
    await pipeline.run(clarifiedRequest);

    // Shares the responder with /recommend, so a still-ambiguous location comes
    // back as another question instead of a false "complete" with zero results.
    return respondWithPipeline(pipeline);
  } catch (error) {
    console.error("Clarification error:", error);
    return NextResponse.json(
      {
        status: "error",
        code: "internal",
        message: "Something went wrong applying your answer",
      },
      { status: 500 }
    );
  }
}
