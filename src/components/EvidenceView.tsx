"use client";

/**
 * Per-restaurant evidence breakdown. Also requires `selectedRestaurant`.
 * Score chips map 1:1 to `ConfidenceScore` fields (dietTagStrength,
 * coverage, tagRecency, dataCompleteness) — not a separate scoring UI.
 */
import { useAppStore } from "@/store";

/** Evidence + confidence breakdown for `selectedRestaurant`. */
export function EvidenceView() {
  const selectedRestaurant = useAppStore((s) => s.selectedRestaurant);
  const setPage = useAppStore((s) => s.setPage);

  if (!selectedRestaurant) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No restaurant selected.</p>
        <button
          onClick={() => setPage("results")}
          className="mt-4 text-primary-600 hover:text-primary-700 font-medium"
        >
          ← Back to Results
        </button>
      </div>
    );
  }

  const { restaurant, confidence, evidence, warnings } = selectedRestaurant;

  const verifiedEvidence = evidence.filter((e) => e.verified);
  const unverifiedEvidence = evidence.filter((e) => !e.verified);
  const menuEvidence = evidence.filter((e) => e.menuConfirmed);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Back buttons */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setPage("results")}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Map
        </button>
        <button
          onClick={() => setPage("details")}
          className="text-sm text-gray-500 hover:text-gray-700 font-medium"
        >
          View Restaurant →
        </button>
      </div>

      {/* Header */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">
          Evidence & Confidence
        </h1>
        <p className="text-gray-500 text-sm">{restaurant.name}</p>

        {/* Overall score */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-shrink-0 w-20 h-20 rounded-full border-4 border-primary-500 flex items-center justify-center">
            <span className="text-2xl font-bold text-primary-700">
              {Math.round(confidence.overall * 100)}%
            </span>
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-600">
              Based on {evidence.length} facts recorded by OpenStreetMap
              contributors
            </p>
            {/* These four percentages are the ConfidenceScore fields, not a new formula. */}
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-primary-500" />
                Diet tags: {Math.round(confidence.dietTagStrength * 100)}%
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                Needs covered: {Math.round(confidence.coverage * 100)}%
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                Listing detail: {Math.round(confidence.dataCompleteness * 100)}%
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                Last checked: {Math.round(confidence.tagRecency * 100)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Evidence Sources */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Evidence Sources
        </h2>

        {/* Menu verification */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-green-100 flex items-center justify-center text-xs">📋</span>
            Menu Verification ({menuEvidence.length})
          </h3>
          {menuEvidence.length > 0 ? (
            <div className="space-y-1.5">
              {menuEvidence.map((e, i) => (
                <div key={i} className="text-sm text-gray-700 p-2 bg-green-50 rounded-lg flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {e.claim} — {Math.round(e.confidence * 100)}% confident
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic p-2">
              No menu data available for verification.
            </p>
          )}
        </div>

        {/* Verified claims */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-primary-100 flex items-center justify-center text-xs">✓</span>
            Verified Claims ({verifiedEvidence.length})
          </h3>
          <div className="space-y-1.5">
            {verifiedEvidence.map((e, i) => (
              <div key={i} className="text-sm text-gray-700 p-2 bg-primary-50 rounded-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {e.claim}
                </span>
                <span className="text-xs text-gray-500">OpenStreetMap</span>
              </div>
            ))}
          </div>
        </div>

        {/* Unverified claims */}
        {unverifiedEvidence.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-amber-100 flex items-center justify-center text-xs">?</span>
              Unverified Claims ({unverifiedEvidence.length})
            </h3>
            <div className="space-y-1.5">
              {unverifiedEvidence.map((e, i) => (
                <div key={i} className="text-sm text-gray-700 p-2 bg-amber-50 rounded-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {e.claim}
                  </span>
                  <span className="text-xs text-gray-500">{Math.round(e.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200">
          <h2 className="text-lg font-semibold text-amber-800 mb-3">
            ⚠️ Important Warnings
          </h2>
          <ul className="space-y-2">
            {warnings.map((warning, i) => (
              <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                <span>•</span>
                {warning}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-amber-600">
            Always confirm dietary accommodations directly with the restaurant
            before visiting, especially for severe allergies.
          </p>
        </div>
      )}

      {/* Report inaccuracy */}
      <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
        <p className="text-sm text-gray-600 mb-2">
          Found inaccurate information?
        </p>
        <button className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
          Report Inaccuracy
        </button>
      </div>
    </div>
  );
}
