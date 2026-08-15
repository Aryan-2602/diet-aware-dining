"use client";

/**
 * Marketing landing. CTAs call `setPage("search")` / `setPage("saved")` —
 * still the same Next.js route.
 *
 * Copy here is held to the same standard as the results: it may only claim
 * what the pipeline actually does. Earlier versions advertised "Our AI
 * validates menus" and "menu evidence and certification checks", neither of
 * which exists — `menuConfirmed` is hardcoded false at every construction site
 * in api/_lib/agents/evidence_verification.py, because OpenStreetMap never
 * confirms a menu. An app that refuses to guess about someone's dietary needs
 * cannot open by overstating what it checked.
 */
import { ArrowUpRight, Gauge, Globe, ShieldCheck } from "lucide-react";
import { useAppStore } from "@/store";
import { EXAMPLE_PROMPTS } from "@/lib/prompts";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ICON_LG, ICON_SM, iconProps } from "@/lib/icons";

const PIPELINE_STEPS = [
  {
    title: "Read your request",
    desc: "Pulls out dietary needs, cuisine, location and constraints from plain language.",
  },
  {
    title: "Geocode the location",
    desc: "Resolves your city or address to coordinates via Nominatim.",
  },
  {
    title: "Search OpenStreetMap",
    desc: "Queries Overpass for places tagged with the diet:* keys your needs map to.",
  },
  {
    title: "Check the tags",
    desc: "Re-asserts every dietary filter against the returned tags, and says so when a need has no tag at all.",
  },
  {
    title: "Score and rank",
    desc: "Weighs tag strength, coverage, how recently a mapper confirmed it, and listing completeness.",
  },
];

const TRUST_POINTS = [
  {
    Icon: ShieldCheck,
    title: "Filtered, not guessed",
    desc: "A place only appears if its OpenStreetMap diet:* tags satisfy every need we can express as a tag.",
  },
  {
    Icon: Gauge,
    title: "Scores you can audit",
    desc: "Every match shows its evidence, its confidence breakdown, and a link to the exact OSM object.",
  },
  {
    Icon: Globe,
    title: "Anywhere OSM is mapped",
    desc: "Useful for dietary constraints in unfamiliar cities, with the same rules everywhere.",
  },
];

/** Hero, how-it-works, and trust sections; navigates via `setPage`. */
export function LandingPage() {
  const setPage = useAppStore((s) => s.setPage);
  const setSearchSeed = useAppStore((s) => s.setSearchSeed);

  /** Carries the prompt into the form instead of discarding it. */
  const startSearchWith = (query: string) => {
    setSearchSeed({ query });
    setPage("search");
  };

  return (
    <div className="space-y-16">
      {/* Hero. Single column: the old two-column layout's right half was a
          mock product screenshot with an invented "92% confidence" stat over a
          🗺️ placeholder — fabricated data on the first screen of an app whose
          selling point is not fabricating data. */}
      <section className="max-w-2xl py-8">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-gray-900 sm:text-4xl">
          Find restaurants that match your dietary needs.
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Describe what you need in plain language. We filter OpenStreetMap&apos;s
          community dietary tags, show the evidence behind every match, and hand
          off to Google Maps.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => setPage("search")}>
            Start searching
          </Button>
          <Button variant="secondary" onClick={() => setPage("saved")}>
            Recent &amp; saved
          </Button>
        </div>
      </section>

      {/* Try Natural Language */}
      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-gray-900">
          Try natural language requests
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              onClick={() => startSearchWith(example)}
              className="group flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900"
            >
              {example}
              <ArrowUpRight
                size={ICON_SM}
                className="mt-0.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500"
                {...iconProps}
              />
            </button>
          ))}
        </div>
      </section>

      {/* What a search actually does */}
      <section>
        <h2 className="mb-6 text-xl font-semibold tracking-tight text-gray-900">
          What a search actually does
        </h2>
        <ol className="divide-y divide-gray-200 border-y border-gray-200">
          {PIPELINE_STEPS.map((item, i) => (
            <li key={item.title} className="flex gap-4 py-4">
              <span className="w-5 shrink-0 text-sm tabular-nums text-gray-400">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900">{item.title}</p>
                <p className="mt-0.5 text-sm text-gray-600">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Why Trust */}
      <section>
        <h2 className="mb-6 text-xl font-semibold tracking-tight text-gray-900">
          Why trust these results
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TRUST_POINTS.map(({ Icon, title, desc }) => (
            <Card key={title}>
              {/* Neutral: these are category markers, not verification states,
                  and colour in this app is reserved for the latter. */}
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
                <Icon size={ICON_LG} className="text-gray-700" {...iconProps} />
              </div>
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              <p className="mt-1.5 text-sm text-gray-600">{desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* The limits, stated up front. This replaces a green "Ready to find your
          perfect meal?" band -- filler on a product whose actual differentiator
          is that it will tell you when it has nothing. */}
      <section className="rounded-xl bg-gray-900 p-8 text-center lg:p-12">
        <h2 className="text-xl font-semibold tracking-tight text-white">
          What we will not do
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-300">
          We only show places whose OpenStreetMap dietary tags we can verify, so
          sometimes we show you nothing. OpenStreetMap holds no allergen or
          cross-contamination data at all — for allergies, we surface contact
          details so you can call ahead, and we say so every time.
        </p>
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => setPage("search")}>
            Start searching
          </Button>
        </div>
      </section>

      {/* Moved out of the deleted marketing footer, where it was chrome. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Data sources</h2>
        <ul className="space-y-1 text-sm text-gray-600">
          <li>Places and dietary tags: OpenStreetMap, via the Overpass API</li>
          <li>Location lookup: Nominatim</li>
          <li>
            Dietary tags are added and confirmed by local OpenStreetMap mappers
          </li>
        </ul>
      </section>
    </div>
  );
}
