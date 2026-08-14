"""Export recommendations as JSON, plain text or CSV.

Deliberately carries no ratings, review counts or prices: OpenStreetMap has
none, so exporting them would re-introduce the fabrication this app removed.
"""

from __future__ import annotations

import csv
import io
import json
import time
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

from ..types import Recommendation

ExportFormat = Literal["json", "text", "csv"]


@dataclass
class ExportResult:
    format: ExportFormat
    content: str
    filename: str

    def to_json(self) -> dict[str, str]:
        return {
            "format": self.format,
            "content": self.content,
            "filename": self.filename,
        }


class ExportService:
    async def process(
        self, recommendations: list[Recommendation], fmt: ExportFormat = "json"
    ) -> ExportResult:
        """Serialize recommendations; never includes ratings, reviews or prices."""
        if fmt == "text":
            return self._export_text(recommendations)
        if fmt == "csv":
            return self._export_csv(recommendations)
        return self._export_json(recommendations)

    def _stamp(self) -> int:
        return int(time.time() * 1000)

    def _maps_url(self, rec: Recommendation) -> str:
        loc = rec.restaurant.location
        address = quote(rec.restaurant.address, safe="")
        return (
            "https://www.google.com/maps/dir/?api=1"
            f"&destination={loc.lat},{loc.lng}&destination_place_id={address}"
        )

    def _export_json(self, recommendations: list[Recommendation]) -> ExportResult:
        data = [
            {
                "name": rec.restaurant.name,
                "address": rec.restaurant.address,
                "cuisine": rec.restaurant.cuisine,
                "osmUrl": (
                    "https://www.openstreetmap.org/"
                    f"{rec.restaurant.osmType}/{rec.restaurant.osmId}"
                ),
                "dietTags": rec.restaurant.dietTags,
                "lastChecked": rec.restaurant.lastCheckedISO,
                "confidence": round(rec.confidence.overall * 100),
                "dietaryOptions": rec.restaurant.dietaryOptions,
                "matchReasons": rec.matchReasons,
                "warnings": rec.warnings,
                "googleMapsUrl": self._maps_url(rec),
            }
            for rec in recommendations
        ]
        return ExportResult(
            format="json",
            content=json.dumps(data, indent=2),
            filename=f"dietary-recommendations-{self._stamp()}.json",
        )

    def _export_text(self, recommendations: list[Recommendation]) -> ExportResult:
        lines: list[str] = []
        for index, rec in enumerate(recommendations, start=1):
            r = rec.restaurant
            lines.append(f"{index}. {r.name}")
            lines.append(f"   Address: {r.address}")
            lines.append(f"   Cuisine: {', '.join(r.cuisine)}")
            lines.append(
                f"   Verification: {round(rec.confidence.overall * 100)}% (OpenStreetMap)"
            )
            lines.append(f"   Dietary: {', '.join(r.dietaryOptions)}")
            lines.append(f"   Why: {'; '.join(rec.matchReasons)}")
            if rec.warnings:
                lines.append(f"   ! {'; '.join(rec.warnings)}")
            lines.append(f"   Directions: {self._maps_url(rec)}")
            lines.append("")
        return ExportResult(
            format="text",
            content="\n".join(lines),
            filename=f"dietary-recommendations-{self._stamp()}.txt",
        )

    def _export_csv(self, recommendations: list[Recommendation]) -> ExportResult:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "Rank",
                "Name",
                "Address",
                "Cuisine",
                "Verification",
                "Dietary Options",
                "Match Reasons",
                "Warnings",
                "Directions",
            ]
        )
        for index, rec in enumerate(recommendations, start=1):
            r = rec.restaurant
            writer.writerow(
                [
                    index,
                    r.name,
                    r.address,
                    ", ".join(r.cuisine),
                    f"{round(rec.confidence.overall * 100)}%",
                    ", ".join(r.dietaryOptions),
                    "; ".join(rec.matchReasons),
                    "; ".join(rec.warnings),
                    self._maps_url(rec),
                ]
            )
        return ExportResult(
            format="csv",
            content=buffer.getvalue(),
            filename=f"dietary-recommendations-{self._stamp()}.csv",
        )
