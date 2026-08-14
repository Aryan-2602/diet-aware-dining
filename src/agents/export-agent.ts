import { Recommendation } from "@/types";

/**
 * Export Agent
 * Formats recommendation results into various export formats
 * (JSON, text summary, shareable link data).
 */
export type ExportFormat = "json" | "text" | "csv";

export interface ExportResult {
  format: ExportFormat;
  content: string;
  filename: string;
}

export class ExportAgent {
  async process(
    recommendations: Recommendation[],
    format: ExportFormat = "json"
  ): Promise<ExportResult> {
    switch (format) {
      case "json":
        return this.exportJSON(recommendations);
      case "text":
        return this.exportText(recommendations);
      case "csv":
        return this.exportCSV(recommendations);
      default:
        return this.exportJSON(recommendations);
    }
  }

  private exportJSON(recommendations: Recommendation[]): ExportResult {
    const data = recommendations.map((rec) => ({
      name: rec.restaurant.name,
      address: rec.restaurant.address,
      cuisine: rec.restaurant.cuisine,
      osmUrl: `https://www.openstreetmap.org/${rec.restaurant.osmType}/${rec.restaurant.osmId}`,
      dietTags: rec.restaurant.dietTags,
      lastChecked: rec.restaurant.lastCheckedISO ?? null,
      confidence: Math.round(rec.confidence.overall * 100),
      dietaryOptions: rec.restaurant.dietaryOptions,
      matchReasons: rec.matchReasons,
      warnings: rec.warnings,
      googleMapsUrl: this.buildMapsUrl(rec),
    }));

    return {
      format: "json",
      content: JSON.stringify(data, null, 2),
      filename: `dietary-recommendations-${Date.now()}.json`,
    };
  }

  private exportText(recommendations: Recommendation[]): ExportResult {
    const lines = recommendations.map((rec, index) => {
      const r = rec.restaurant;
      return [
        `${index + 1}. ${r.name}`,
        `   Address: ${r.address}`,
        `   Cuisine: ${r.cuisine.join(", ")}`,
        `   Verification: ${Math.round(rec.confidence.overall * 100)}% (OpenStreetMap)`,
        `   Confidence: ${Math.round(rec.confidence.overall * 100)}%`,
        `   Dietary: ${r.dietaryOptions.join(", ")}`,
        `   Why: ${rec.matchReasons.join("; ")}`,
        rec.warnings.length > 0
          ? `   ⚠️ ${rec.warnings.join("; ")}`
          : null,
        `   Maps: ${this.buildMapsUrl(rec)}`,
        "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    const content = [
      "🥗 DietaryAI Recommendations",
      `Generated: ${new Date().toLocaleString()}`,
      "─".repeat(50),
      "",
      ...lines,
    ].join("\n");

    return {
      format: "text",
      content,
      filename: `dietary-recommendations-${Date.now()}.txt`,
    };
  }

  private exportCSV(recommendations: Recommendation[]): ExportResult {
    const headers = [
      "Rank",
      "Name",
      "Address",
      "Cuisine",
      "Verification",
      "Dietary Options",
      "Match Reasons",
      "Warnings",
      "Google Maps URL",
    ];

    const rows = recommendations.map((rec, index) => {
      const r = rec.restaurant;
      return [
        index + 1,
        `"${r.name}"`,
        `"${r.address}"`,
        `"${r.cuisine.join(", ")}"`,
        `${Math.round(rec.confidence.overall * 100)}%`,
        `"${r.dietaryOptions.join(", ")}"`,
        `"${rec.matchReasons.join("; ")}"`,
        `"${rec.warnings.join("; ")}"`,
        this.buildMapsUrl(rec),
      ];
    });

    const content = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n"
    );

    return {
      format: "csv",
      content,
      filename: `dietary-recommendations-${Date.now()}.csv`,
    };
  }

  private buildMapsUrl(rec: Recommendation): string {
    const { lat, lng } = rec.restaurant.location;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
}
