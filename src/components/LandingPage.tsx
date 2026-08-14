"use client";

/**
 * Marketing landing. CTAs call `setPage("search")` / `setPage("saved")` —
 * still the same Next.js route.
 */
import { useAppStore } from "@/store";

/** Hero, how-it-works, and trust sections; navigates via `setPage`. */
export function LandingPage() {
  const setPage = useAppStore((s) => s.setPage);

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-8">
        <div>
          <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-4">
            Find restaurants that{" "}
            <span className="text-primary-500">truly match</span> your dietary
            needs.
          </h1>
          <p className="text-lg text-gray-500 mb-8 max-w-lg">
            Tell us what you need in plain language. Our AI validates menus,
            scores confidence, and opens directions in Google Maps — instantly.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setPage("search")}
              className="px-8 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-full transition-colors text-base"
            >
              Start Searching Now
            </button>
            <button
              onClick={() => setPage("saved")}
              className="px-8 py-3 bg-white hover:bg-gray-50 text-gray-700 font-semibold rounded-full border border-gray-200 transition-colors text-base"
            >
              Recent & Saved
            </button>
          </div>
        </div>

        {/* Demo Preview */}
        <div className="bg-gray-900 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
            <span className="text-sm font-bold text-white">Dietary Maps AI</span>
          </div>
          <div className="bg-gray-800 rounded-lg px-4 py-4 mb-4">
            <p className="text-sm text-gray-300">
              {`"Halal food with gluten-free options near USC"`}
            </p>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-primary-500 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm text-gray-200">
              3 restaurants found • 92% confidence
            </span>
          </div>
          <div className="bg-gray-800 rounded-lg h-32 flex items-center justify-center">
            <span className="text-gray-500 text-sm">🗺️ Map Preview</span>
          </div>
        </div>
      </section>

      {/* Try Natural Language */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Try natural language requests
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            "Halal food with gluten-free options near USC",
            "Vegan restaurants with high-protein meals",
            "Nut-free dessert places within 5 miles",
          ].map((example) => (
            <button
              key={example}
              onClick={() => setPage("search")}
              className="text-left px-5 py-4 bg-primary-50 border border-primary-200 rounded-xl text-sm text-gray-700 hover:bg-primary-100 hover:border-primary-300 transition-colors"
            >
              {`"${example}"`}
            </button>
          ))}
        </div>
      </section>

      {/* How the AI Works */}
      <section className="bg-white rounded-2xl p-8 lg:p-12 shadow-sm border border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">
          How the AI works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {[
            { step: 1, title: "Understand your request", desc: "Parses dietary needs, cuisine, location, and constraints" },
            { step: 2, title: "Discover restaurants", desc: "Searches nearby options via OpenStreetMap data" },
            { step: 3, title: "Validate dietary evidence", desc: "Checks menus, tags, and certifications for proof" },
            { step: 4, title: "Rank by confidence", desc: "Scores each restaurant based on evidence strength" },
            { step: 5, title: "Open directions", desc: "One tap to navigate in Google Maps instantly" },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center mx-auto mb-3">
                <span className="text-sm font-bold text-white">{item.step}</span>
              </div>
              <p className="text-sm font-semibold text-gray-800 mb-1">{item.title}</p>
              <p className="text-xs text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Trust */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Why trust our results
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: "🛡️", title: "Dietary Validation", desc: "Every recommendation is backed by menu evidence and certification checks from OpenStreetMap data" },
            { icon: "📊", title: "Confidence Scoring", desc: "Transparent scores so you know how reliable each match is — no hidden algorithms" },
            { icon: "🌍", title: "Traveler-Friendly", desc: "Perfect for navigating dietary restrictions in unfamiliar cities worldwide" },
          ].map((item) => (
            <div key={item.title} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-primary-50 flex items-center justify-center text-2xl mb-4">
                {item.icon}
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">{item.title}</h3>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-500 rounded-2xl p-8 lg:p-12 text-center">
        <h3 className="text-2xl font-bold text-white mb-3">
          Ready to find your perfect meal?
        </h3>
        <p className="text-primary-100 mb-6 max-w-md mx-auto">
          Describe your dietary needs and discover trusted restaurants near you.
        </p>
        <button
          onClick={() => setPage("search")}
          className="px-8 py-3 bg-white text-primary-600 font-semibold rounded-full hover:bg-primary-50 transition-colors"
        >
          Start Searching
        </button>
      </section>
    </div>
  );
}
